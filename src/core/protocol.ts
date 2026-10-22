/**
 * The CODEX bridge protocol (version 1).
 *
 * Both bridges speak the same JSON shape:
 *   { protocol: "codex-bridge", v: 1, engine, session, seq, state?, events? }
 *
 *  - MWSE writes the whole document to Data Files\MWSE\codex_live.json,
 *    keeping the most recent events in a ring buffer.
 *  - OpenMW cannot write files from Lua, so its bridge prints one document
 *    per line to openmw.log, prefixed with BRIDGE_LINE_PREFIX.
 *
 * Everything that arrives is untrusted: this module validates types, sizes
 * and ranges and drops anything it does not recognise. Nothing here is ever
 * executed or rendered as HTML.
 */

export const PROTOCOL = "codex-bridge";
export const PROTOCOL_VERSION = 1;
export const BRIDGE_LINE_PREFIX = "CODEXBRIDGE1 ";
export const MAX_DOCUMENT_BYTES = 2_000_000;

export type Engine = "mwse" | "openmw";

/** Capabilities a bridge can announce. The UI only shows what is announced. */
export const KNOWN_CAPS = [
  "cell",
  "position",
  "time",
  "journal",
  "quests",
  "character",
  "stats",
  "equipment",
  "spell",
  "effects",
  "inventory",
  "events",
] as const;
export type Cap = (typeof KNOWN_CAPS)[number];

export interface LiveCell {
  name: string;
  exterior: boolean;
  gx?: number;
  gy?: number;
  region?: string;
}

export interface LivePos {
  x: number;
  y: number;
  z: number;
  /** Radians, game convention (0 = north, clockwise). */
  yaw?: number;
}

export interface LiveTime {
  year?: number;
  /** 1-based month. */
  month?: number;
  day?: number;
  hour?: number;
  daysPassed?: number;
}

export interface LiveStat {
  base: number;
  current: number;
}

export interface LiveCharacter {
  name: string;
  race?: string;
  class?: string;
  birthsign?: string;
  level?: number;
  attributes?: Record<string, LiveStat>;
  skills?: Record<string, LiveStat>;
  health?: LiveStat;
  magicka?: LiveStat;
  fatigue?: LiveStat;
  gold?: number;
  equipped?: string[];
  spell?: string | null;
  effects?: string[];
  inventory?: { name: string; count: number }[];
}

export interface LiveState {
  /** True while a menu is open or the game is paused. */
  menu: boolean;
  cell?: LiveCell;
  pos?: LivePos;
  time?: LiveTime;
  character?: LiveCharacter;
}

export interface QuestSnapshot {
  questId: string;
  questName?: string;
  index: number;
  finished?: boolean;
  text?: string;
}

export type BridgeEvent =
  | { kind: "hello"; engineVersion?: string; apiRevision?: number; caps: Cap[] }
  | { kind: "loaded"; save?: string; newGame?: boolean }
  | { kind: "saved"; save?: string }
  | { kind: "cell"; cell: LiveCell; previous?: LiveCell }
  | { kind: "journal"; questId: string; questName?: string; index: number; text?: string; finished?: boolean; isNew?: boolean }
  | { kind: "quests"; list: QuestSnapshot[] }
  | { kind: "levelUp"; level: number }
  | { kind: "skillRaised"; skill: string; level: number }
  | { kind: "teleport" };

export interface SeqEvent {
  seq: number;
  event: BridgeEvent;
}

export interface BridgeMessage {
  engine: Engine;
  session: string;
  seq: number;
  /** Capabilities announced by the bridge (top-level, repeated in every document). */
  caps?: Cap[];
  engineVersion?: string;
  apiRevision?: number;
  state?: LiveState;
  events: SeqEvent[];
  /** Number of events that failed validation and were dropped. */
  dropped: number;
}

export type ParseResult = { ok: true; msg: BridgeMessage } | { ok: false; error: string };

// ---------------------------------------------------------------- validators

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, max = 200): string | undefined {
  if (typeof v !== "string") return undefined;
  // Strip control characters except tab/newline; cap length.
  const clean = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return clean.length > max ? clean.slice(0, max) : clean;
}

function num(v: unknown, lo = -1e9, hi = 1e9): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < lo || v > hi) return undefined;
  return v;
}

function int(v: unknown, lo = -1e9, hi = 1e9): number | undefined {
  const n = num(v, lo, hi);
  return n === undefined ? undefined : Math.trunc(n);
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function stat(v: unknown): LiveStat | undefined {
  if (!isObj(v)) return undefined;
  const base = num(v.base, -1e6, 1e6);
  const current = num(v.current, -1e6, 1e6);
  if (base === undefined || current === undefined) return undefined;
  return { base: Math.round(base * 10) / 10, current: Math.round(current * 10) / 10 };
}

function statMap(v: unknown, maxKeys = 64): Record<string, LiveStat> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, LiveStat> = {};
  let n = 0;
  for (const [k, raw] of Object.entries(v)) {
    if (n >= maxKeys) break;
    const key = str(k, 60);
    const s = stat(raw);
    if (key && s) {
      out[key] = s;
      n++;
    }
  }
  return n ? out : undefined;
}

function strList(v: unknown, maxItems: number, maxLen = 120): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v.slice(0, maxItems)) {
    const s = str(item, maxLen);
    if (s) out.push(s);
  }
  return out;
}

function parseCaps(v: unknown): Cap[] {
  return (strList(v, 32, 40) ?? []).filter((c): c is Cap => (KNOWN_CAPS as readonly string[]).includes(c));
}

export function parseCell(v: unknown): LiveCell | undefined {
  if (!isObj(v)) return undefined;
  const name = str(v.name, 200);
  const exterior = bool(v.exterior);
  if (name === undefined || exterior === undefined) return undefined;
  const cell: LiveCell = { name, exterior };
  if (exterior) {
    const gx = int(v.gx, -10000, 10000);
    const gy = int(v.gy, -10000, 10000);
    if (gx === undefined || gy === undefined) return undefined;
    cell.gx = gx;
    cell.gy = gy;
  }
  const region = str(v.region, 200);
  if (region) cell.region = region;
  return cell;
}

function parsePos(v: unknown): LivePos | undefined {
  if (!isObj(v)) return undefined;
  const x = num(v.x, -1e8, 1e8);
  const y = num(v.y, -1e8, 1e8);
  const z = num(v.z, -1e8, 1e8);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  const pos: LivePos = { x, y, z };
  const yaw = num(v.yaw, -100, 100);
  if (yaw !== undefined) pos.yaw = yaw;
  return pos;
}

function parseTime(v: unknown): LiveTime | undefined {
  if (!isObj(v)) return undefined;
  const t: LiveTime = {};
  const year = int(v.year, 0, 100000);
  const month = int(v.month, 1, 12);
  const day = int(v.day, 1, 31);
  const hour = num(v.hour, 0, 24);
  const daysPassed = int(v.daysPassed, 0, 1e7);
  if (year !== undefined) t.year = year;
  if (month !== undefined) t.month = month;
  if (day !== undefined) t.day = day;
  if (hour !== undefined) t.hour = hour;
  if (daysPassed !== undefined) t.daysPassed = daysPassed;
  return Object.keys(t).length ? t : undefined;
}

function parseCharacter(v: unknown): LiveCharacter | undefined {
  if (!isObj(v)) return undefined;
  const name = str(v.name, 120);
  if (!name) return undefined;
  const c: LiveCharacter = { name };
  const race = str(v.race, 80);
  const klass = str(v["class"], 80);
  const birthsign = str(v.birthsign, 80);
  const level = int(v.level, 0, 10000);
  if (race) c.race = race;
  if (klass) c.class = klass;
  if (birthsign) c.birthsign = birthsign;
  if (level !== undefined) c.level = level;
  const attributes = statMap(v.attributes, 16);
  const skills = statMap(v.skills, 64);
  if (attributes) c.attributes = attributes;
  if (skills) c.skills = skills;
  const health = stat(v.health);
  const magicka = stat(v.magicka);
  const fatigue = stat(v.fatigue);
  if (health) c.health = health;
  if (magicka) c.magicka = magicka;
  if (fatigue) c.fatigue = fatigue;
  const gold = int(v.gold, 0, 1e9);
  if (gold !== undefined) c.gold = gold;
  const equipped = strList(v.equipped, 40);
  if (equipped) c.equipped = equipped;
  if (v.spell === null) c.spell = null;
  else {
    const spell = str(v.spell, 120);
    if (spell) c.spell = spell;
  }
  const effects = strList(v.effects, 60);
  if (effects) c.effects = effects;
  if (Array.isArray(v.inventory)) {
    const inv: { name: string; count: number }[] = [];
    for (const it of v.inventory.slice(0, 500)) {
      if (!isObj(it)) continue;
      const n = str(it.name, 120);
      const count = int(it.count, -1e6, 1e7);
      if (n && count !== undefined) inv.push({ name: n, count });
    }
    c.inventory = inv;
  }
  return c;
}

export function parseState(v: unknown): LiveState | undefined {
  if (!isObj(v)) return undefined;
  const state: LiveState = { menu: bool(v.menu) ?? false };
  const cell = parseCell(v.cell);
  const pos = parsePos(v.pos);
  const time = parseTime(v.time);
  const character = parseCharacter(v.character);
  if (cell) state.cell = cell;
  if (pos) state.pos = pos;
  if (time) state.time = time;
  if (character) state.character = character;
  return state;
}

function parseQuestSnapshot(v: unknown): QuestSnapshot | undefined {
  if (!isObj(v)) return undefined;
  const questId = str(v.questId, 120);
  const index = int(v.index, -1, 100000);
  if (!questId || index === undefined) return undefined;
  const q: QuestSnapshot = { questId, index };
  const questName = str(v.questName, 200);
  const text = str(v.text, 4000);
  const finished = bool(v.finished);
  if (questName) q.questName = questName;
  if (text) q.text = text;
  if (finished !== undefined) q.finished = finished;
  return q;
}

export function parseEvent(v: unknown): BridgeEvent | undefined {
  if (!isObj(v)) return undefined;
  switch (v.kind) {
    case "hello": {
      const caps = parseCaps(v.caps);
      const ev: BridgeEvent = { kind: "hello", caps };
      const engineVersion = str(v.engineVersion, 60);
      const apiRevision = int(v.apiRevision, 0, 1e6);
      if (engineVersion) ev.engineVersion = engineVersion;
      if (apiRevision !== undefined) ev.apiRevision = apiRevision;
      return ev;
    }
    case "loaded": {
      const ev: BridgeEvent = { kind: "loaded" };
      const save = str(v.save, 260);
      const newGame = bool(v.newGame);
      if (save) ev.save = save;
      if (newGame !== undefined) ev.newGame = newGame;
      return ev;
    }
    case "saved": {
      const save = str(v.save, 260);
      return save ? { kind: "saved", save } : { kind: "saved" };
    }
    case "cell": {
      const cell = parseCell(v.cell);
      if (!cell) return undefined;
      const previous = parseCell(v.previous);
      return previous ? { kind: "cell", cell, previous } : { kind: "cell", cell };
    }
    case "journal": {
      const q = parseQuestSnapshot(v);
      if (!q) return undefined;
      const ev: BridgeEvent = { kind: "journal", questId: q.questId, index: q.index };
      if (q.questName) ev.questName = q.questName;
      if (q.text) ev.text = q.text;
      if (q.finished !== undefined) ev.finished = q.finished;
      const isNew = bool(v.isNew);
      if (isNew !== undefined) ev.isNew = isNew;
      return ev;
    }
    case "quests": {
      if (!Array.isArray(v.list)) return undefined;
      const list: QuestSnapshot[] = [];
      for (const raw of v.list.slice(0, 2000)) {
        const q = parseQuestSnapshot(raw);
        if (q) list.push(q);
      }
      return { kind: "quests", list };
    }
    case "levelUp": {
      const level = int(v.level, 0, 10000);
      return level === undefined ? undefined : { kind: "levelUp", level };
    }
    case "skillRaised": {
      const skill = str(v.skill, 60);
      const level = int(v.level, 0, 10000);
      return skill && level !== undefined ? { kind: "skillRaised", skill, level } : undefined;
    }
    case "teleport":
      return { kind: "teleport" };
    default:
      return undefined;
  }
}

/** Validates one bridge document (already JSON-decoded). */
export function validateDocument(doc: unknown): ParseResult {
  if (!isObj(doc)) return { ok: false, error: "not an object" };
  if (doc.protocol !== PROTOCOL) return { ok: false, error: "not a CODEX bridge document" };
  if (doc.v !== PROTOCOL_VERSION) return { ok: false, error: `unsupported protocol version ${String(doc.v)}` };
  const engine = doc.engine === "mwse" || doc.engine === "openmw" ? (doc.engine as Engine) : undefined;
  if (!engine) return { ok: false, error: "unknown engine" };
  const session = str(doc.session, 64);
  if (!session || !/^[A-Za-z0-9_-]+$/.test(session)) return { ok: false, error: "missing session id" };
  const seq = int(doc.seq, 0, 1e12);
  if (seq === undefined) return { ok: false, error: "missing seq" };
  const msg: BridgeMessage = { engine, session, seq, events: [], dropped: 0 };
  if (Array.isArray(doc.caps)) msg.caps = parseCaps(doc.caps);
  const engineVersion = str(doc.engineVersion, 60);
  if (engineVersion) msg.engineVersion = engineVersion;
  const apiRevision = int(doc.apiRevision, 0, 1e6);
  if (apiRevision !== undefined) msg.apiRevision = apiRevision;
  if (doc.state !== undefined) {
    const state = parseState(doc.state);
    if (state) msg.state = state;
  }
  if (Array.isArray(doc.events)) {
    for (const raw of doc.events.slice(0, 500)) {
      const evSeq = isObj(raw) ? int(raw.seq, 0, 1e12) : undefined;
      const ev = parseEvent(raw);
      if (ev && evSeq !== undefined) msg.events.push({ seq: evSeq, event: ev });
      else msg.dropped++;
    }
    msg.events.sort((a, b) => a.seq - b.seq);
  }
  return { ok: true, msg };
}

/** Parses the MWSE bridge file. A half-written file simply fails and is retried. */
export function parseBridgeDocument(text: string): ParseResult {
  if (text.length > MAX_DOCUMENT_BYTES) return { ok: false, error: "document too large" };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: "incomplete or invalid JSON" };
  }
  return validateDocument(doc);
}

/** Extracts bridge documents from openmw.log lines (other log lines are ignored). */
export function parseBridgeLines(lines: string[]): { messages: BridgeMessage[]; errors: number } {
  const messages: BridgeMessage[] = [];
  let errors = 0;
  for (const line of lines) {
    const at = line.indexOf(BRIDGE_LINE_PREFIX);
    if (at < 0) continue;
    const r = parseBridgeDocument(line.slice(at + BRIDGE_LINE_PREFIX.length).trim());
    if (r.ok) messages.push(r.msg);
    else errors++;
  }
  return { messages, errors };
}

/** Stable key for a place, used for visits and fog of war. */
export function placeKey(cell: LiveCell): string {
  return cell.exterior ? `ext:${cell.gx},${cell.gy}` : `int:${cell.name.toLowerCase()}`;
}

export function cellLabel(cell: LiveCell | undefined): string {
  if (!cell) return "";
  if (cell.name) return cell.name;
  if (cell.exterior) return cell.region ? `${cell.region} (${cell.gx}, ${cell.gy})` : `Wilderness (${cell.gx}, ${cell.gy})`;
  return "Unnamed interior";
}
