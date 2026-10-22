/**
 * Data extracted from the player's own TES3 content files (Morrowind.esm and
 * any plugins in their load order) by the Rust atlas builder. Nothing here is
 * bundled with CODEX.EXE: if no atlas has been built, the map is a blank
 * cartographer's grid and travel shows only routes the player recorded.
 */
import type { AtlasGrid, Pt } from "./mapmath.ts";
import { normKey } from "./util.ts";

export interface AtlasCell {
  gx: number;
  gy: number;
  name: string;
  region: string;
}

export interface AtlasTravelDest {
  x: number;
  y: number;
  /** Destination cell name (interior name, or the named exterior cell at that spot). */
  cell: string;
}

export interface AtlasTravelNpc {
  npcId: string;
  npc: string;
  className: string;
  cell: string;
  interior: boolean;
  x: number;
  y: number;
  dest: AtlasTravelDest[];
}

export interface AtlasMarker {
  kind: "divine" | "almsivi";
  x: number;
  y: number;
}

export interface AtlasDoor {
  /** Where the door stands in the exterior world. */
  x: number;
  y: number;
  /** Interior it leads to. */
  to: string;
}

export interface AtlasData {
  version: number;
  builtAt: string;
  gameId: string;
  plugins: { name: string; bytes: number }[];
  warnings: string[];
  grid: AtlasGrid;
  /** File name of the height image next to atlas.json. */
  heights: string;
  cells: AtlasCell[];
  doors: AtlasDoor[];
  /** Interior (lower-case name) -> nearest exterior arrival point via its doors. */
  exits: Record<string, { x: number; y: number; via: string }>;
  travel: AtlasTravelNpc[];
  markers: AtlasMarker[];
  stats: { landCells: number; cells: number; interiors: number; refs: number; npcs: number };
}

export interface AtlasIndex {
  data: AtlasData;
  byGrid: Map<string, AtlasCell>;
  named: AtlasCell[];
}

export function indexAtlas(data: AtlasData): AtlasIndex {
  const byGrid = new Map<string, AtlasCell>();
  for (const c of data.cells) byGrid.set(`${c.gx},${c.gy}`, c);
  const named = data.cells.filter((c) => c.name.trim() !== "");
  return { data, byGrid, named };
}

export function cellAt(idx: AtlasIndex, w: Pt): AtlasCell | undefined {
  const cs = idx.data.grid.cellSize;
  return idx.byGrid.get(`${Math.floor(w.x / cs)},${Math.floor(w.y / cs)}`);
}

/** Named places, one label per name: the centre of all cells sharing that name. */
export function placeLabels(idx: AtlasIndex): { name: string; x: number; y: number; cells: number }[] {
  const groups = new Map<string, { name: string; sx: number; sy: number; n: number }>();
  const cs = idx.data.grid.cellSize;
  for (const c of idx.named) {
    const k = normKey(c.name);
    const g = groups.get(k) ?? { name: c.name, sx: 0, sy: 0, n: 0 };
    g.sx += (c.gx + 0.5) * cs;
    g.sy += (c.gy + 0.5) * cs;
    g.n += 1;
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({ name: g.name, x: g.sx / g.n, y: g.sy / g.n, cells: g.n }));
}

/** "Balmora, Guild of Mages" -> "Balmora". Exterior names are returned as-is. */
export function settlementOf(cellName: string): string {
  const i = cellName.indexOf(",");
  return (i > 0 ? cellName.slice(0, i) : cellName).trim();
}

/** Travel mode label from the service NPC's class name (falls back to the class itself). */
export function modeForClass(className: string): string {
  const k = className.toLowerCase();
  if (k.includes("caravan")) return "Silt Strider";
  if (k.includes("shipmaster") || k.includes("captain")) return "Boat";
  if (k.includes("guild guide")) return "Guild Guide";
  if (k.includes("gondol")) return "Gondola";
  return className || "Travel service";
}

export interface TravelEdge {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  mode: string;
  source: "mine" | "game";
  via?: string;
  notes?: string;
}

export function gameTravelEdges(data: AtlasData | null): TravelEdge[] {
  if (!data) return [];
  const out: TravelEdge[] = [];
  const seen = new Set<string>();
  for (const npc of data.travel) {
    const mode = modeForClass(npc.className);
    for (const d of npc.dest) {
      if (!d.cell) continue;
      const from = settlementOf(npc.cell);
      const to = settlementOf(d.cell);
      const key = `${normKey(npc.cell)}>${normKey(d.cell)}>${mode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from, to, fromLabel: npc.cell, toLabel: d.cell, mode, source: "game", via: npc.npc });
    }
  }
  return out;
}

/** Fewest-hops route over the given edges (directed). Returns null when unreachable. */
export function findRoute(edges: TravelEdge[], from: string, to: string, maxHops = 8): TravelEdge[] | null {
  const start = normKey(from);
  const goal = normKey(to);
  if (!start || !goal) return null;
  if (start === goal) return [];
  const adj = new Map<string, TravelEdge[]>();
  for (const e of edges) {
    const k = normKey(e.from);
    const list = adj.get(k) ?? [];
    list.push(e);
    adj.set(k, list);
  }
  const prev = new Map<string, TravelEdge>();
  const visited = new Set<string>([start]);
  let frontier = [start];
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      // Prefer the player's own routes, then game routes, for stable results.
      const out = (adj.get(node) ?? []).slice().sort((a, b) => (a.source === b.source ? 0 : a.source === "mine" ? -1 : 1));
      for (const e of out) {
        const k = normKey(e.to);
        if (visited.has(k)) continue;
        visited.add(k);
        prev.set(k, e);
        if (k === goal) {
          const path: TravelEdge[] = [];
          let cur = k;
          while (cur !== start) {
            const edge = prev.get(cur)!;
            path.unshift(edge);
            cur = normKey(edge.from);
          }
          return path;
        }
        next.push(k);
      }
    }
    frontier = next;
  }
  return null;
}

export function placesFromEdges(edges: TravelEdge[]): string[] {
  const names = new Map<string, string>();
  for (const e of edges) {
    names.set(normKey(e.from), e.from);
    names.set(normKey(e.to), e.to);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** Where to draw an "entrance" hint for an interior, if the game files say. */
export function exitFor(data: AtlasData | null, interiorName: string): { x: number; y: number; via: string } | null {
  if (!data || !interiorName) return null;
  return data.exits[interiorName.toLowerCase()] ?? null;
}

// ----------------------------------------------------------- height image

export interface HeightImage {
  width: number;
  height: number;
  /** Heights in game units / 8, row-major from the north-west corner. NODATA = no land record. */
  data: Int16Array;
}

export const NODATA = -32768;
const MAGIC = 0x41584443; // "CDXA" little-endian

/** Parses atlas.bin: 'CDXA', u32 version, i32 minX, i32 minY, u32 w, u32 h, u32 spc, i16 data... */
export function parseHeights(buf: ArrayBuffer): { grid: Pick<AtlasGrid, "minX" | "minY" | "spc">; image: HeightImage } {
  const v = new DataView(buf);
  if (buf.byteLength < 28 || v.getUint32(0, true) !== MAGIC) throw new Error("Not a CODEX atlas height file.");
  const version = v.getUint32(4, true);
  if (version !== 1) throw new Error(`Unsupported atlas height version ${version}.`);
  const minX = v.getInt32(8, true);
  const minY = v.getInt32(12, true);
  const width = v.getUint32(16, true);
  const height = v.getUint32(20, true);
  const spc = v.getUint32(24, true);
  const expected = 28 + width * height * 2;
  if (width === 0 || height === 0 || width > 8192 || height > 8192 || buf.byteLength < expected) {
    throw new Error("Atlas height file is truncated or has invalid dimensions.");
  }
  const data = new Int16Array(buf.slice(28, expected));
  return { grid: { minX, minY, spc }, image: { width, height, data } };
}
