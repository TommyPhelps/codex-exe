/** One-line quick entry parsing and hotkey validation. */

/** "Ajira @ Balmora - sells alchemy gear" -> name, place, note. */
export function parseNpcQuick(input: string): { name: string; place: string; note: string } {
  let rest = input.trim();
  let note = "";
  const dash = /\s+[-–—]\s+|:\s+/.exec(rest);
  if (dash) {
    note = rest.slice(dash.index + dash[0].length).trim();
    rest = rest.slice(0, dash.index).trim();
  }
  let place = "";
  const at = rest.indexOf("@");
  if (at >= 0) {
    place = rest.slice(at + 1).trim();
    rest = rest.slice(0, at).trim();
  }
  return { name: rest, place, note };
}

/** "Extra armor in a chest @ Balmora" -> title + place. */
export function parseAtPlace(input: string): { title: string; place: string } {
  const at = input.lastIndexOf("@");
  if (at < 0) return { title: input.trim(), place: "" };
  return { title: input.slice(0, at).trim(), place: input.slice(at + 1).trim() };
}

/** Pulls #tags out of free text (they stay in the text as written). */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu)) {
    const t = m[2].toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// ----------------------------------------------------------------- hotkeys

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Super"] as const;
const KEY_ALIASES: Record<string, string> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Super",
  win: "Super",
  meta: "Super",
  cmd: "Super",
};

/** Keys games commonly bind; using them unmodified or with only Shift is refused. */
const GAME_KEYS = new Set([
  "W", "A", "S", "D", "Q", "E", "R", "F", "C", "Z", "X", "Space", "Tab", "Escape", "Enter",
  "F5", "F9", "Up", "Down", "Left", "Right", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
]);

export type HotkeyCheck = { ok: true; normalized: string; warning?: string } | { ok: false; error: string };

export function normalizeHotkey(input: string): HotkeyCheck {
  const parts = input
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { ok: false, error: "Press or type a key combination, e.g. Ctrl+Alt+N." };
  const mods = new Set<string>();
  let key = "";
  for (const p of parts) {
    const alias = KEY_ALIASES[p.toLowerCase()];
    if (alias) {
      mods.add(alias);
      continue;
    }
    if (key) return { ok: false, error: "Use one main key plus modifiers." };
    key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
    if (/^f([1-9]|1[0-2])$/i.test(p)) key = p.toUpperCase();
    if (/^esc$/i.test(p)) key = "Escape";
  }
  if (!key) return { ok: false, error: "Add a main key, e.g. Ctrl+Alt+N." };
  if (!/^([A-Z0-9]|F([1-9]|1[0-2])|Space|Tab|Escape|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/.test(key)) {
    return { ok: false, error: `"${key}" is not a supported key.` };
  }
  const ordered = MODIFIERS.filter((m) => mods.has(m));
  const normalized = [...ordered, key].join("+");
  const strong = mods.has("Ctrl") || mods.has("Alt") || mods.has("Super");
  if (!strong) {
    return { ok: false, error: "Global hotkeys need Ctrl, Alt or Win, so they never steal keys from the game." };
  }
  if (normalized === "Alt+F4" || normalized === "Ctrl+Alt+Delete") return { ok: false, error: "That combination is reserved by Windows." };
  if (mods.size === 1 && mods.has("Alt") && GAME_KEYS.has(key)) {
    return { ok: true, normalized, warning: "Some games use Alt with this key. Ctrl+Alt is safer." };
  }
  if (mods.size === 1 && mods.has("Ctrl") && GAME_KEYS.has(key)) {
    return { ok: true, normalized, warning: "Many games bind Ctrl with this key (crouch, quick actions). Ctrl+Alt is safer." };
  }
  return { ok: true, normalized };
}

export interface HotkeyConfig {
  quickNote: string;
  markHere: string;
  toggleCompact: string;
}

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  quickNote: "Ctrl+Alt+N",
  markHere: "Ctrl+Alt+M",
  toggleCompact: "Ctrl+Alt+J",
};

export function hotkeyConflicts(cfg: HotkeyConfig): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const [name, combo] of Object.entries(cfg)) {
    if (!combo) continue;
    const prev = seen.get(combo);
    if (prev) out.push(`${prev} and ${name} both use ${combo}.`);
    seen.set(combo, name);
  }
  return out;
}
