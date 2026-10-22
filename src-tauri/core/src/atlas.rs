//! Builds a world atlas from the player's own TES3 content files.
//!
//! Output:
//!  - a height image (`CDXA` binary): terrain heights sampled from LAND records,
//!    so the app can draw a relief map without bundling any game artwork;
//!  - JSON with exterior cell names and regions, door links between interiors
//!    and the outside world, travel-service destinations (NPC DODT/DNAM data),
//!    and intervention markers.
//!
//! Files are processed in load order; later records override earlier ones by
//! id (NPCs, classes, regions), by grid (exterior cells, land) or by name
//! (interiors). References from every file are kept (refs are additive).

use crate::json::{self, Obj};
use crate::tes3::{self, decode_vhgt, f32_at, i32_at, subrecords, u32_at, FLAG_DELETED};
use crate::text::zstring;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

pub const STORE: usize = 32; // samples kept per cell edge while parsing
pub const NODATA: i16 = i16::MIN;
pub const DEFAULT_MAX_DIM: u32 = 3072;
const CELL_SIZE: f64 = 8192.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Pos {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
struct NpcDef {
    name: String,
    class_id: String,
    dests: Vec<(Pos, String)>,
}

#[derive(Clone, Debug, Default)]
struct ExtCell {
    name: String,
    region_id: String,
}

#[derive(Clone, Debug)]
pub struct TravelNpc {
    pub npc_id: String,
    pub npc: String,
    pub class_name: String,
    pub cell: String,
    pub interior: bool,
    pub pos: Pos,
    pub dests: Vec<TravelDest>,
}

#[derive(Clone, Debug)]
pub struct TravelDest {
    pub pos: Pos,
    pub cell: String,
    pub near: bool,
}

#[derive(Clone, Debug)]
pub struct Exit {
    pub pos: Pos,
    pub via: String,
}

#[derive(Default)]
pub struct Builder {
    land: HashMap<(i32, i32), Vec<i16>>,
    npcs: HashMap<String, NpcDef>,
    classes: HashMap<String, String>,
    regions: HashMap<String, String>,
    ext_cells: HashMap<(i32, i32), ExtCell>,
    interiors: HashMap<String, String>, // lower -> display name
    /// Exterior doors into interiors: (door position, interior display name).
    ext_doors: Vec<(Pos, String)>,
    /// Interior -> interior door links (lower-case names).
    int_links: HashMap<String, Vec<String>>,
    /// Interior (lower) -> exterior arrival point of a door leading outside.
    direct_exits: HashMap<String, Pos>,
    /// Where travel NPCs stand: npc id -> (cell display name, interior?, pos).
    npc_refs: HashMap<String, (String, bool, Pos)>,
    markers: Vec<(String, Pos)>,
    pub warnings: Vec<String>,
    pub plugins: Vec<(String, u64)>,
    refs: u64,
}

pub struct Atlas {
    pub json: String,
    pub heights: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub spc: u32,
}

fn lower(s: &str) -> String {
    s.to_lowercase()
}

fn pos6(data: &[u8]) -> Option<Pos> {
    if data.len() < 24 {
        return None;
    }
    let x = f32_at(data, 0)? as f64;
    let y = f32_at(data, 4)? as f64;
    if !x.is_finite() || !y.is_finite() {
        return None;
    }
    Some(Pos { x, y })
}

impl Builder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Pass 1: objects (NPC_, CREA, CLAS, REGN) and terrain (LAND).
    pub fn pass_objects(&mut self, name: &str, buf: &[u8]) {
        if !tes3::is_tes3(buf) {
            self.warnings.push(format!("{name} is not a TES3 content file; skipped."));
            return;
        }
        self.plugins.push((name.to_string(), buf.len() as u64));
        for rec in tes3::records(buf) {
            let rec = match rec {
                Ok(r) => r,
                Err(e) => {
                    self.warnings.push(format!("{name}: {e}; the rest of this file was skipped."));
                    break;
                }
            };
            match &rec.tag {
                b"LAND" => self.read_land(rec),
                b"NPC_" | b"CREA" => self.read_actor(rec),
                b"CLAS" | b"REGN" => self.read_named(rec),
                _ => {}
            }
        }
    }

    /// Pass 2: cells and their references.
    pub fn pass_cells(&mut self, name: &str, buf: &[u8]) {
        if !tes3::is_tes3(buf) {
            return;
        }
        for rec in tes3::records(buf) {
            let rec = match rec {
                Ok(r) => r,
                Err(_) => break, // already reported in pass 1
            };
            if &rec.tag == b"CELL" {
                if let Err(e) = self.read_cell(rec) {
                    self.warnings.push(format!("{name}: a CELL record could not be read ({e})."));
                }
            }
        }
    }

    fn read_land(&mut self, rec: tes3::Record) {
        let mut xy: Option<(i32, i32)> = None;
        let mut flags = 0u32;
        let mut vhgt: Option<&[u8]> = None;
        let mut deleted = rec.flags & FLAG_DELETED != 0;
        for sub in subrecords(rec.data) {
            let Ok(sub) = sub else { break };
            match &sub.tag {
                b"INTV" => {
                    if let (Some(x), Some(y)) = (i32_at(sub.data, 0), i32_at(sub.data, 4)) {
                        xy = Some((x, y));
                    }
                }
                b"DATA" => flags = u32_at(sub.data, 0).unwrap_or(0),
                b"VHGT" => vhgt = Some(sub.data),
                b"DELE" => deleted = true,
                _ => {}
            }
        }
        let Some(key) = xy else { return };
        if deleted {
            self.land.remove(&key);
            return;
        }
        // Heights are only valid when the "heights/normals" flag is set.
        if flags & 1 == 0 {
            return;
        }
        let Some(h) = vhgt.and_then(decode_vhgt) else { return };
        let mut store = vec![0i16; STORE * STORE];
        let step = 64 / STORE;
        for sy in 0..STORE {
            for sx in 0..STORE {
                let v = h[(sy * step) * 65 + sx * step];
                store[sy * STORE + sx] = v.clamp(i16::MIN as i32 + 1, i16::MAX as i32) as i16;
            }
        }
        self.land.insert(key, store);
    }

    fn read_actor(&mut self, rec: tes3::Record) {
        let mut id = String::new();
        let mut name = String::new();
        let mut class_id = String::new();
        let mut dests: Vec<(Pos, String)> = Vec::new();
        let mut deleted = rec.flags & FLAG_DELETED != 0;
        for sub in subrecords(rec.data) {
            let Ok(sub) = sub else { break };
            match &sub.tag {
                b"NAME" => id = lower(&zstring(sub.data)),
                b"FNAM" => name = zstring(sub.data),
                b"CNAM" => class_id = lower(&zstring(sub.data)),
                b"DODT" => {
                    if let Some(p) = pos6(sub.data) {
                        dests.push((p, String::new()));
                    }
                }
                b"DNAM" => {
                    if let Some(last) = dests.last_mut() {
                        last.1 = zstring(sub.data);
                    }
                }
                b"DELE" => deleted = true,
                _ => {}
            }
        }
        if id.is_empty() {
            return;
        }
        if deleted || dests.is_empty() {
            // A later plugin may remove travel services from an NPC.
            self.npcs.remove(&id);
            return;
        }
        self.npcs.insert(id, NpcDef { name, class_id, dests });
    }

    fn read_named(&mut self, rec: tes3::Record) {
        let mut id = String::new();
        let mut name = String::new();
        for sub in subrecords(rec.data) {
            let Ok(sub) = sub else { break };
            match &sub.tag {
                b"NAME" => id = lower(&zstring(sub.data)),
                b"FNAM" => name = zstring(sub.data),
                _ => {}
            }
        }
        if id.is_empty() {
            return;
        }
        let map = if &rec.tag == b"CLAS" { &mut self.classes } else { &mut self.regions };
        map.insert(id, name);
    }

    fn read_cell(&mut self, rec: tes3::Record) -> Result<(), String> {
        let mut name = String::new();
        let mut flags = 0u32;
        let mut grid = (0i32, 0i32);
        let mut region = String::new();
        let mut have_data = false;
        let mut deleted = rec.flags & FLAG_DELETED != 0;

        struct RefAcc {
            id: String,
            pos: Option<Pos>,
            door: Option<Pos>,
            dest_cell: Option<String>,
            deleted: bool,
        }
        let mut refs: Vec<RefAcc> = Vec::new();
        let mut in_refs = false;

        for sub in subrecords(rec.data) {
            let sub = sub?;
            if !in_refs {
                match &sub.tag {
                    b"NAME" => name = zstring(sub.data),
                    b"DATA" if !have_data => {
                        flags = u32_at(sub.data, 0).ok_or("short DATA")?;
                        grid = (i32_at(sub.data, 4).ok_or("short DATA")?, i32_at(sub.data, 8).ok_or("short DATA")?);
                        have_data = true;
                    }
                    b"RGNN" => region = lower(&zstring(sub.data)),
                    b"DELE" => deleted = true,
                    b"FRMR" | b"MVRF" => in_refs = true,
                    _ => {}
                }
                if !in_refs {
                    continue;
                }
            }
            match &sub.tag {
                b"FRMR" => refs.push(RefAcc { id: String::new(), pos: None, door: None, dest_cell: None, deleted: false }),
                b"MVRF" | b"CNDT" => {}
                tag => {
                    if let Some(r) = refs.last_mut() {
                        match tag {
                            b"NAME" => r.id = lower(&zstring(sub.data)),
                            b"DATA" => r.pos = pos6(sub.data),
                            b"DODT" => r.door = pos6(sub.data),
                            b"DNAM" => r.dest_cell = Some(zstring(sub.data)),
                            b"DELE" => r.deleted = true,
                            _ => {}
                        }
                    }
                }
            }
        }
        if !have_data {
            return Err("missing DATA".into());
        }
        let interior = flags & 1 != 0;
        if interior {
            if name.is_empty() {
                return Ok(());
            }
            let key = lower(&name);
            if deleted {
                self.interiors.remove(&key);
                return Ok(());
            }
            self.interiors.insert(key, name.clone());
        } else {
            let e = self.ext_cells.entry(grid).or_default();
            // Later files override the name/region of the same grid square.
            e.name = name.clone();
            if !region.is_empty() {
                e.region_id = region.clone();
            }
        }
        let display = if interior { name.clone() } else { name.clone() };
        let key = lower(&name);
        for r in refs {
            if r.deleted || r.id.is_empty() {
                continue;
            }
            self.refs += 1;
            if let Some(door) = r.door {
                match (interior, r.dest_cell.as_ref().filter(|s| !s.is_empty())) {
                    (false, Some(dest)) => {
                        if let Some(p) = r.pos.clone() {
                            self.ext_doors.push((p, dest.clone()));
                        }
                    }
                    (true, Some(dest)) => self.int_links.entry(key.clone()).or_default().push(lower(dest)),
                    (true, None) => {
                        self.direct_exits.entry(key.clone()).or_insert(door);
                    }
                    (false, None) => {}
                }
            }
            if self.npcs.contains_key(&r.id) {
                if let Some(p) = r.pos.clone() {
                    let cell_name = if interior { display.clone() } else { self.ext_label(grid) };
                    self.npc_refs.insert(r.id.clone(), (cell_name, interior, p));
                }
            }
            if !interior && (r.id == "divinemarker" || r.id == "templemarker") {
                if let Some(p) = r.pos.clone() {
                    self.markers.push((if r.id == "divinemarker" { "divine".into() } else { "almsivi".into() }, p));
                }
            }
        }
        Ok(())
    }

    fn region_name(&self, id: &str) -> String {
        self.regions.get(id).cloned().unwrap_or_default()
    }

    /// Display label for an exterior grid square: its name, else its region.
    fn ext_label(&self, g: (i32, i32)) -> String {
        match self.ext_cells.get(&g) {
            Some(c) if !c.name.is_empty() => c.name.clone(),
            Some(c) => {
                let r = self.region_name(&c.region_id);
                if r.is_empty() {
                    format!("Wilderness ({}, {})", g.0, g.1)
                } else {
                    format!("{r} ({}, {})", g.0, g.1)
                }
            }
            None => format!("Wilderness ({}, {})", g.0, g.1),
        }
    }

    /// Name of the exterior place at a position: exact cell name, else the
    /// nearest named neighbour within one cell (flagged as "near").
    fn place_at(&self, p: &Pos) -> (String, bool) {
        let g = ((p.x / CELL_SIZE).floor() as i32, (p.y / CELL_SIZE).floor() as i32);
        if let Some(c) = self.ext_cells.get(&g) {
            if !c.name.is_empty() {
                return (c.name.clone(), false);
            }
        }
        let mut best: Option<(f64, String)> = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                if let Some(c) = self.ext_cells.get(&(g.0 + dx, g.1 + dy)) {
                    if c.name.is_empty() {
                        continue;
                    }
                    let cx = (g.0 + dx) as f64 * CELL_SIZE + CELL_SIZE / 2.0;
                    let cy = (g.1 + dy) as f64 * CELL_SIZE + CELL_SIZE / 2.0;
                    let d = (cx - p.x).hypot(cy - p.y);
                    if best.as_ref().map(|b| d < b.0).unwrap_or(true) {
                        best = Some((d, c.name.clone()));
                    }
                }
            }
        }
        match best {
            Some((_, n)) => (n, true),
            None => (self.ext_label(g), true),
        }
    }

    pub fn travel(&self) -> Vec<TravelNpc> {
        let mut out = Vec::new();
        let mut ids: Vec<&String> = self.npcs.keys().collect();
        ids.sort();
        for id in ids {
            let def = &self.npcs[id];
            let Some((cell, interior, pos)) = self.npc_refs.get(id) else { continue };
            let dests = def
                .dests
                .iter()
                .map(|(p, dnam)| {
                    if !dnam.is_empty() {
                        let display = self.interiors.get(&lower(dnam)).cloned().unwrap_or_else(|| dnam.clone());
                        TravelDest { pos: p.clone(), cell: display, near: false }
                    } else {
                        let (cell, near) = self.place_at(p);
                        TravelDest { pos: p.clone(), cell, near }
                    }
                })
                .collect();
            out.push(TravelNpc {
                npc_id: id.clone(),
                npc: if def.name.is_empty() { id.clone() } else { def.name.clone() },
                class_name: self.classes.get(&def.class_id).cloned().unwrap_or_else(|| def.class_id.clone()),
                cell: cell.clone(),
                interior: *interior,
                pos: pos.clone(),
                dests,
            });
        }
        out
    }

    /// Nearest way out for every interior: multi-source BFS from interiors
    /// that have a door leading outside, over reversed interior door links.
    pub fn exits(&self) -> HashMap<String, Exit> {
        let mut out: HashMap<String, Exit> = HashMap::new();
        let mut rev: HashMap<&str, Vec<&str>> = HashMap::new();
        for (from, tos) in &self.int_links {
            for to in tos {
                rev.entry(to.as_str()).or_default().push(from.as_str());
            }
        }
        let mut queue: VecDeque<&str> = VecDeque::new();
        let mut keys: Vec<&String> = self.direct_exits.keys().collect();
        keys.sort();
        for k in keys {
            let via = self.interiors.get(k).cloned().unwrap_or_else(|| k.clone());
            out.insert(k.clone(), Exit { pos: self.direct_exits[k].clone(), via });
            queue.push_back(k.as_str());
        }
        let mut seen: HashSet<&str> = queue.iter().copied().collect();
        while let Some(cur) = queue.pop_front() {
            let exit = out[cur].clone();
            if let Some(prevs) = rev.get(cur) {
                for &p in prevs {
                    if seen.insert(p) {
                        out.insert(p.to_string(), exit.clone());
                        queue.push_back(p);
                    }
                }
            }
        }
        // Interiors reached only from outside: use the outdoor door position.
        for (p, dest) in &self.ext_doors {
            let k = lower(dest);
            out.entry(k).or_insert_with(|| Exit { pos: p.clone(), via: dest.clone() });
        }
        out
    }

    pub fn choose_spc(&self, max_dim: u32) -> Option<(i32, i32, i32, i32, u32)> {
        if self.land.is_empty() {
            return None;
        }
        let (mut min_x, mut max_x, mut min_y, mut max_y) = (i32::MAX, i32::MIN, i32::MAX, i32::MIN);
        for &(x, y) in self.land.keys() {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
        let cells = ((max_x - min_x + 1).max(max_y - min_y + 1)) as u32;
        let spc = [32u32, 16, 8, 4, 2, 1].into_iter().find(|s| cells * s <= max_dim).unwrap_or(1);
        Some((min_x, max_x, min_y, max_y, spc))
    }

    pub fn finish(&self, game_id: &str, built_at: &str, max_dim: u32) -> Result<Atlas, String> {
        let (min_x, max_x, min_y, max_y, spc) = self
            .choose_spc(max_dim)
            .ok_or("No terrain (LAND records) was found in the selected files. Check the load order includes Morrowind.esm.")?;
        let w = ((max_x - min_x + 1) as u32) * spc;
        let h = ((max_y - min_y + 1) as u32) * spc;
        let f = STORE / spc as usize;
        let mut heights = Vec::with_capacity(28 + (w * h * 2) as usize);
        heights.extend_from_slice(b"CDXA");
        heights.extend_from_slice(&1u32.to_le_bytes());
        heights.extend_from_slice(&min_x.to_le_bytes());
        heights.extend_from_slice(&min_y.to_le_bytes());
        heights.extend_from_slice(&w.to_le_bytes());
        heights.extend_from_slice(&h.to_le_bytes());
        heights.extend_from_slice(&spc.to_le_bytes());
        for row in 0..h {
            let gy = max_y - (row / spc) as i32;
            let sy = (spc - 1 - row % spc) as usize;
            for col in 0..w {
                let gx = min_x + (col / spc) as i32;
                let sx = (col % spc) as usize;
                let v = match self.land.get(&(gx, gy)) {
                    Some(cell) => cell[(sy * f) * STORE + sx * f],
                    None => NODATA,
                };
                heights.extend_from_slice(&v.to_le_bytes());
            }
        }

        // Cells: every exterior grid square with land or a name.
        let mut grids: Vec<(i32, i32)> = self.ext_cells.keys().copied().collect();
        for k in self.land.keys() {
            if !self.ext_cells.contains_key(k) {
                grids.push(*k);
            }
        }
        grids.sort();
        let cells: Vec<String> = grids
            .iter()
            .map(|g| {
                let c = self.ext_cells.get(g).cloned().unwrap_or_default();
                Obj::new().int("gx", g.0 as i64).int("gy", g.1 as i64).str("name", &c.name).str("region", &self.region_name(&c.region_id)).build()
            })
            .collect();

        let mut doors: Vec<&(Pos, String)> = self.ext_doors.iter().collect();
        doors.sort_by(|a, b| a.1.cmp(&b.1));
        let doors_json: Vec<String> = doors.iter().map(|(p, to)| Obj::new().num("x", p.x).num("y", p.y).str("to", to).build()).collect();

        let mut exits: Vec<(String, Exit)> = self.exits().into_iter().collect();
        exits.sort_by(|a, b| a.0.cmp(&b.0));
        let exits_json = format!(
            "{{{}}}",
            exits
                .iter()
                .map(|(k, e)| format!("{}:{}", json::escape(k), Obj::new().num("x", e.pos.x).num("y", e.pos.y).str("via", &e.via).build()))
                .collect::<Vec<_>>()
                .join(",")
        );

        let travel_json: Vec<String> = self
            .travel()
            .iter()
            .map(|t| {
                let dests: Vec<String> = t
                    .dests
                    .iter()
                    .map(|d| Obj::new().num("x", d.pos.x).num("y", d.pos.y).str("cell", &d.cell).bool("near", d.near).build())
                    .collect();
                Obj::new()
                    .str("npcId", &t.npc_id)
                    .str("npc", &t.npc)
                    .str("className", &t.class_name)
                    .str("cell", &t.cell)
                    .bool("interior", t.interior)
                    .num("x", t.pos.x)
                    .num("y", t.pos.y)
                    .raw("dest", json::array(dests))
                    .build()
            })
            .collect();

        let markers_json: Vec<String> = self.markers.iter().map(|(k, p)| Obj::new().str("kind", k).num("x", p.x).num("y", p.y).build()).collect();
        let plugins_json: Vec<String> = self.plugins.iter().map(|(n, b)| Obj::new().str("name", n).int("bytes", *b as i64).build()).collect();
        let warnings_json: Vec<String> = self.warnings.iter().map(|w| json::escape(w)).collect();

        let grid = Obj::new()
            .int("minX", min_x as i64)
            .int("maxX", max_x as i64)
            .int("minY", min_y as i64)
            .int("maxY", max_y as i64)
            .int("spc", spc as i64)
            .int("cellSize", CELL_SIZE as i64)
            .build();
        let stats = Obj::new()
            .int("landCells", self.land.len() as i64)
            .int("cells", self.ext_cells.len() as i64)
            .int("interiors", self.interiors.len() as i64)
            .int("refs", self.refs as i64)
            .int("npcs", self.npc_refs.len() as i64)
            .build();
        let json = Obj::new()
            .int("version", 1)
            .str("builtAt", built_at)
            .str("gameId", game_id)
            .raw("plugins", json::array(plugins_json))
            .raw("warnings", json::array(warnings_json))
            .raw("grid", grid)
            .str("heights", "atlas.bin")
            .raw("cells", json::array(cells))
            .raw("doors", json::array(doors_json))
            .raw("exits", exits_json)
            .raw("travel", json::array(travel_json))
            .raw("markers", json::array(markers_json))
            .raw("stats", stats)
            .build();
        Ok(Atlas { json, heights, width: w, height: h, spc })
    }
}

/// Reads every file twice (objects, then cells) so references in early files
/// can point at NPCs defined or changed by later plugins.
pub fn build_from_files(files: &[PathBuf], game_id: &str, built_at: &str, max_dim: u32) -> Result<Atlas, String> {
    let mut b = Builder::new();
    let mut found = Vec::new();
    for path in files {
        let name = display_name(path);
        match std::fs::read(path) {
            Ok(buf) => {
                b.pass_objects(&name, &buf);
                found.push(path.clone());
            }
            Err(e) => b.warnings.push(format!("{name} could not be read ({e}); skipped.")),
        }
    }
    for path in &found {
        if let Ok(buf) = std::fs::read(path) {
            b.pass_cells(&display_name(path), &buf);
        }
    }
    b.finish(game_id, built_at, max_dim)
}

fn display_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tes3::build::*;

    fn land(x: i32, y: i32, f: impl Fn(usize, usize) -> i32) -> Vec<u8> {
        record(b"LAND", 0, &[sub(b"INTV", &ints(&[x, y])), sub(b"DATA", &1u32.to_le_bytes()), sub(b"VNML", &[0u8; 65 * 65 * 3]), sub(b"VHGT", &vhgt(f))])
    }

    fn cell(name: &str, flags: u32, gx: i32, gy: i32, region: &str, refs: Vec<Vec<u8>>) -> Vec<u8> {
        let mut subs = vec![sub(b"NAME", &zstr(name)), sub(b"DATA", &[flags.to_le_bytes(), gx.to_le_bytes(), gy.to_le_bytes()].concat())];
        if !region.is_empty() {
            subs.push(sub(b"RGNN", &zstr(region)));
        }
        for r in refs {
            subs.push(r);
        }
        record(b"CELL", 0, &subs)
    }

    fn reference(index: u32, id: &str, x: f32, y: f32, door: Option<(f32, f32, &str)>) -> Vec<u8> {
        let mut v = sub(b"FRMR", &index.to_le_bytes());
        v.extend(sub(b"NAME", &zstr(id)));
        if let Some((dx, dy, dest)) = door {
            v.extend(sub(b"DODT", &floats(&[dx, dy, 0.0, 0.0, 0.0, 0.0])));
            if !dest.is_empty() {
                v.extend(sub(b"DNAM", &zstr(dest)));
            }
        }
        v.extend(sub(b"DATA", &floats(&[x, y, 0.0, 0.0, 0.0, 0.0])));
        v
    }

    fn npc(id: &str, name: &str, class: &str, dests: &[(f32, f32, &str)]) -> Vec<u8> {
        let mut subs = vec![sub(b"NAME", &zstr(id)), sub(b"FNAM", &zstr(name)), sub(b"CNAM", &zstr(class))];
        for (x, y, d) in dests {
            subs.push(sub(b"DODT", &floats(&[*x, *y, 0.0, 0.0, 0.0, 0.0])));
            if !d.is_empty() {
                subs.push(sub(b"DNAM", &zstr(d)));
            }
        }
        record(b"NPC_", 0, &subs)
    }

    fn master() -> Vec<u8> {
        let mut f = header();
        f.extend(record(b"REGN", 0, &[sub(b"NAME", &zstr("fixture region")), sub(b"FNAM", &zstr("Fixture Region"))]));
        f.extend(record(b"CLAS", 0, &[sub(b"NAME", &zstr("caravaner")), sub(b"FNAM", &zstr("Caravaner"))]));
        f.extend(npc("strider_a", "Driver A", "caravaner", &[(3.5 * 8192.0, 1.5 * 8192.0, ""), (100.0, 200.0, "Fixture Town, Guild")]));
        f.extend(npc("plain_npc", "Nobody", "caravaner", &[]));
        // A 4x2 island: x 0..3, y 0..1, heights rise to the east.
        for x in 0..4 {
            for y in 0..2 {
                f.extend(land(x, y, move |vx, _vy| x * 64 + vx as i32 - 40));
            }
        }
        f.extend(cell("Fixture Town", 0, 0, 0, "fixture region", vec![
            reference(1, "strider_a", 4000.0, 4000.0, None),
            reference(2, "door_x", 3000.0, 3000.0, Some((50.0, 50.0, "Fixture Town, Tower"))),
            reference(3, "DivineMarker", 1000.0, 1000.0, None),
        ]));
        f.extend(cell("", 0, 1, 0, "fixture region", vec![]));
        f.extend(cell("Fixture Port", 0, 3, 1, "fixture region", vec![]));
        f.extend(cell("Fixture Town, Tower", 1, 0, 0, "", vec![
            reference(4, "door_in", 10.0, 10.0, Some((3100.0, 2900.0, ""))),
            reference(5, "door_up", 20.0, 20.0, Some((0.0, 0.0, "Fixture Town, Tower Top"))),
        ]));
        f.extend(cell("Fixture Town, Tower Top", 1, 0, 0, "", vec![reference(6, "door_down", 0.0, 0.0, Some((20.0, 20.0, "Fixture Town, Tower")))]));
        f.extend(cell("Fixture Town, Guild", 1, 0, 0, "", vec![]));
        f
    }

    fn build(files: Vec<Vec<u8>>, max_dim: u32) -> (Builder, Atlas) {
        let mut b = Builder::new();
        for (i, f) in files.iter().enumerate() {
            b.pass_objects(&format!("f{i}.esm"), f);
        }
        for (i, f) in files.iter().enumerate() {
            b.pass_cells(&format!("f{i}.esm"), f);
        }
        let a = b.finish("morrowind", "2026-10-20T00:00:00Z", max_dim).unwrap();
        (b, a)
    }

    fn height_at(a: &Atlas, col: u32, row: u32) -> i16 {
        let i = 28 + ((row * a.width + col) * 2) as usize;
        i16::from_le_bytes([a.heights[i], a.heights[i + 1]])
    }

    #[test]
    fn heights_are_oriented_north_up_and_west_left() {
        let (_, a) = build(vec![master()], 3072);
        assert_eq!(a.spc, 32);
        assert_eq!((a.width, a.height), (4 * 32, 2 * 32));
        assert_eq!(&a.heights[0..4], b"CDXA");
        // West edge of cell x=0 is the lowest point; heights rise eastwards.
        assert_eq!(height_at(&a, 0, 63), -40);
        assert!(height_at(&a, 127, 0) > height_at(&a, 0, 0));
        assert_eq!(height_at(&a, 32, 10), 64 - 40);
        assert_eq!(a.heights.len(), 28 + (4 * 32 * 2 * 32 * 2) as usize);
    }

    #[test]
    fn samples_per_cell_shrink_for_large_worlds() {
        let (_, a) = build(vec![master()], 70);
        assert_eq!(a.spc, 16);
        assert_eq!(a.width, 64);
        let (_, b) = build(vec![master()], 5);
        assert_eq!(b.spc, 1);
    }

    #[test]
    fn json_lists_cells_doors_exits_travel_and_markers() {
        let (_, a) = build(vec![master()], 3072);
        let j = &a.json;
        assert!(j.contains("\"name\":\"Fixture Town\",\"region\":\"Fixture Region\""));
        assert!(j.contains("\"to\":\"Fixture Town, Tower\""));
        // The tower exits directly; the tower top exits through the tower.
        assert!(j.contains("\"fixture town, tower\":{\"x\":3100,\"y\":2900,\"via\":\"Fixture Town, Tower\"}"));
        assert!(j.contains("\"fixture town, tower top\":{\"x\":3100,\"y\":2900,\"via\":\"Fixture Town, Tower\"}"));
        assert!(j.contains("\"className\":\"Caravaner\""));
        assert!(j.contains("\"cell\":\"Fixture Port\",\"near\":false"));
        assert!(j.contains("\"cell\":\"Fixture Town, Guild\",\"near\":false"));
        assert!(j.contains("\"kind\":\"divine\""));
        assert!(!j.contains("plain_npc"));
    }

    #[test]
    fn later_plugins_override_and_delete() {
        let mut plugin = header();
        // Renames the wilderness cell, removes travel from the driver, deletes one land square.
        plugin.extend(cell("Fixture Ford", 0, 1, 0, "", vec![]));
        plugin.extend(npc("strider_a", "Driver A", "caravaner", &[]));
        plugin.extend(record(b"LAND", 0, &[sub(b"INTV", &ints(&[3, 1])), sub(b"DATA", &0u32.to_le_bytes()), sub(b"DELE", &[0, 0, 0, 0])]));
        let (b, a) = build(vec![master(), plugin], 3072);
        assert!(a.json.contains("\"gx\":1,\"gy\":0,\"name\":\"Fixture Ford\",\"region\":\"Fixture Region\""));
        assert!(b.travel().is_empty());
        assert_eq!(b.land.len(), 7);
        assert_eq!(b.plugins.len(), 2);
    }

    #[test]
    fn destination_in_an_unnamed_cell_is_labelled_near_its_neighbour() {
        let mut f = master();
        f.extend(npc("boat_b", "Captain", "shipmaster", &[(1.5 * 8192.0, 0.5 * 8192.0, "")]));
        f.extend(cell("Fixture Port", 0, 3, 1, "fixture region", vec![reference(9, "boat_b", 3.2 * 8192.0, 1.5 * 8192.0, None)]));
        let (b, _) = build(vec![f], 3072);
        let boat = b.travel().into_iter().find(|t| t.npc_id == "boat_b").unwrap();
        assert_eq!(boat.cell, "Fixture Port");
        assert_eq!(boat.class_name, "shipmaster");
        assert!(boat.dests[0].near);
        assert_eq!(boat.dests[0].cell, "Fixture Town");
    }

    #[test]
    fn non_tes3_and_truncated_files_warn_without_failing() {
        let mut cut = master();
        cut.truncate(cut.len() - 10);
        let mut b = Builder::new();
        b.pass_objects("notes.txt", b"hello world, not a plugin");
        b.pass_objects("cut.esm", &cut);
        b.pass_cells("cut.esm", &cut);
        assert_eq!(b.warnings.len(), 2);
        assert!(b.finish("morrowind", "x", 3072).is_ok());
        let empty = Builder::new();
        assert!(empty.finish("morrowind", "x", 3072).is_err());
    }

    #[test]
    fn build_from_files_reads_disk_and_reports_missing() {
        let dir = std::env::temp_dir().join(format!("codex_atlas_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("Fixture.esm");
        std::fs::write(&p, master()).unwrap();
        let a = build_from_files(&[p, dir.join("Missing.esp")], "morrowind", "t", 3072).unwrap();
        assert!(a.json.contains("Missing.esp could not be read"));
        assert!(a.json.contains("\"name\":\"Fixture.esm\""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
