//! Load orders for the two Morrowind engines.
//!
//! Original engine: Morrowind.ini `[Game Files]` lists `GameFileN=` entries;
//! the engine loads masters (.esm) before plugins (.esp), each group ordered by
//! file modification time.
//! OpenMW: openmw.cfg lists `data=` folders and `content=` files in order.

use std::path::{Path, PathBuf};

/// Plugin names from Morrowind.ini, in GameFileN order.
pub fn parse_morrowind_ini(text: &str) -> Vec<String> {
    let mut in_section = false;
    let mut items: Vec<(u32, String)> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('[') {
            in_section = line.eq_ignore_ascii_case("[game files]");
            continue;
        }
        if !in_section || line.starts_with(';') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        let k = k.trim();
        if k.len() > 8 && k[..8].eq_ignore_ascii_case("gamefile") {
            if let Ok(n) = k[8..].parse::<u32>() {
                let v = v.trim();
                if !v.is_empty() {
                    items.push((n, v.to_string()));
                }
            }
        }
    }
    items.sort_by_key(|(n, _)| *n);
    let mut out: Vec<String> = Vec::new();
    for (_, v) in items {
        if !out.iter().any(|o| o.eq_ignore_ascii_case(&v)) {
            out.push(v);
        }
    }
    out
}

/// Orders plugins the way the original engine does: .esm first, then by mtime.
pub fn order_original(mut files: Vec<(String, u64)>) -> Vec<String> {
    files.sort_by(|a, b| {
        let am = !a.0.to_ascii_lowercase().ends_with(".esm");
        let bm = !b.0.to_ascii_lowercase().ends_with(".esm");
        am.cmp(&bm).then(a.1.cmp(&b.1))
    });
    files.into_iter().map(|(n, _)| n).collect()
}

#[derive(Debug, Default, PartialEq)]
pub struct OpenMwCfg {
    pub data: Vec<String>,
    pub content: Vec<String>,
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    if v.len() >= 2 && v.starts_with('"') {
        // OpenMW uses & as the escape character inside quoted paths.
        let inner = &v[1..];
        let mut out = String::new();
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            match c {
                '&' => {
                    if let Some(n) = chars.next() {
                        out.push(n);
                    }
                }
                '"' => break,
                c => out.push(c),
            }
        }
        out
    } else {
        v.to_string()
    }
}

/// Parses one openmw.cfg. Later files (user config) extend earlier ones; pass
/// the previous result in `base` to merge.
pub fn parse_openmw_cfg(text: &str, mut base: OpenMwCfg) -> OpenMwCfg {
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        match k.trim() {
            "data" => base.data.push(unquote(v)),
            "content" => {
                let c = v.trim().to_string();
                if !c.is_empty() && !base.content.iter().any(|x| x.eq_ignore_ascii_case(&c)) {
                    base.content.push(c);
                }
            }
            "replace" => match v.trim() {
                "content" => base.content.clear(),
                "data" => base.data.clear(),
                _ => {}
            },
            _ => {}
        }
    }
    base
}

/// Expands OpenMW path tokens (?userdata?, ?local?, ?global?).
pub fn resolve_token(path: &str, userdata: &Path, local: &Path, global: &Path) -> PathBuf {
    for (tok, base) in [("?userdata?", userdata), ("?local?", local), ("?global?", global)] {
        if let Some(rest) = path.strip_prefix(tok) {
            return base.join(rest.trim_start_matches(['/', '\\']));
        }
    }
    PathBuf::from(path)
}

/// Finds each content file in the data folders. Later folders win, like OpenMW.
/// Returns (name, path or None if not found).
pub fn locate_content(cfg: &OpenMwCfg, data_dirs: &[PathBuf]) -> Vec<(String, Option<PathBuf>)> {
    cfg.content
        .iter()
        .map(|name| {
            let found = data_dirs.iter().rev().find_map(|d| find_case_insensitive(d, name));
            (name.clone(), found)
        })
        .collect()
}

/// Looks up a file name in a folder ignoring case (Windows behaviour, also on Linux).
pub fn find_case_insensitive(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for e in entries.flatten() {
        if e.file_name().to_string_lossy().eq_ignore_ascii_case(name) && e.path().is_file() {
            return Some(e.path());
        }
    }
    None
}

/// Content-file names that are TES3 data (scripts-only .omwscripts are skipped).
pub fn is_tes3_content(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l.ends_with(".esm") || l.ends_with(".esp") || l.ends_with(".omwaddon") || l.ends_with(".omwgame")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn morrowind_ini_game_files() {
        let ini = "[General]\nGameFile0=nope\n[Game Files]\nGameFile1=Tribunal.esm\r\nGameFile0=Morrowind.esm\n;GameFile5=Commented.esp\nGameFile2=Bloodmoon.esm\nGameFile3=\nGameFile10=TR_Mainland.esm\ngamefile4=morrowind.esm\n[Archives]\nArchive 0=Tribunal.bsa\n";
        assert_eq!(parse_morrowind_ini(ini), vec!["Morrowind.esm", "Tribunal.esm", "Bloodmoon.esm", "TR_Mainland.esm"]);
    }

    #[test]
    fn original_engine_order() {
        let files = vec![("Mod.esp".into(), 5), ("Bloodmoon.esm".into(), 3), ("Morrowind.esm".into(), 1), ("Early.esp".into(), 2), ("Tribunal.esm".into(), 2)];
        assert_eq!(order_original(files), vec!["Morrowind.esm", "Tribunal.esm", "Bloodmoon.esm", "Early.esp", "Mod.esp"]);
    }

    #[test]
    fn openmw_cfg_merge_and_replace() {
        let global = "data=\"?global?data\"\ncontent=Morrowind.esm\n# comment\n";
        let user = "data=\"C:/Games/Mods/TR&\"quoted&\"\"\ndata=C:/Plain Path\ncontent=Tribunal.esm\ncontent=TR_Mainland.esm\ncontent=codex_bridge.omwscripts\ncontent=morrowind.esm\n";
        let cfg = parse_openmw_cfg(user, parse_openmw_cfg(global, OpenMwCfg::default()));
        assert_eq!(cfg.data, vec!["?global?data", "C:/Games/Mods/TR\"quoted\"", "C:/Plain Path"]);
        assert_eq!(cfg.content, vec!["Morrowind.esm", "Tribunal.esm", "TR_Mainland.esm", "codex_bridge.omwscripts"]);
        let replaced = parse_openmw_cfg("replace=content\ncontent=Only.esm\n", cfg);
        assert_eq!(replaced.content, vec!["Only.esm"]);
        assert!(is_tes3_content("TR_Mainland.ESM"));
        assert!(!is_tes3_content("codex_bridge.omwscripts"));
    }

    #[test]
    fn tokens_and_locating_files() {
        let p = resolve_token("?userdata?data", Path::new("/u"), Path::new("/l"), Path::new("/g"));
        assert_eq!(p, PathBuf::from("/u/data"));
        assert_eq!(resolve_token("D:/x", Path::new("/u"), Path::new("/l"), Path::new("/g")), PathBuf::from("D:/x"));
        let base = std::env::temp_dir().join(format!("codex_lo_{}", std::process::id()));
        let a = base.join("a");
        let b = base.join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("Morrowind.esm"), b"x").unwrap();
        std::fs::write(a.join("Mod.esp"), b"old").unwrap();
        std::fs::write(b.join("mod.ESP"), b"new").unwrap();
        let cfg = OpenMwCfg { data: vec![], content: vec!["Morrowind.esm".into(), "Mod.esp".into(), "Missing.esp".into()] };
        let found = locate_content(&cfg, &[a.clone(), b.clone()]);
        assert_eq!(found[0].1.as_ref().unwrap(), &a.join("Morrowind.esm"));
        assert!(found[1].1.as_ref().unwrap().starts_with(&b));
        assert!(found[2].1.is_none());
        let _ = std::fs::remove_dir_all(&base);
    }
}
