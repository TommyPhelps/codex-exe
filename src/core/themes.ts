/**
 * Game themes. Colours, fonts, materials and ornaments live in
 * src/styles/themes/<id>.css; this file holds what code needs: navigation
 * style, wording, variants and map colouring. All artwork is original -
 * nothing here is copied from the games.
 */
import type { ThemeId } from "./games.ts";

export type SectionId =
  | "resume"
  | "map"
  | "quests"
  | "people"
  | "journal"
  | "discoveries"
  | "character"
  | "travel"
  | "delves"
  | "ledger"
  | "settings";

export const SECTIONS: SectionId[] = ["resume", "map", "quests", "people", "journal", "discoveries", "character", "travel", "delves", "ledger", "settings"];

export type NavStyle = "ribbons" | "stone" | "chapters" | "nordic" | "terminal" | "datapad" | "iron" | "pda";

export interface MapStyle {
  /** Sea colour and deeper sea colour. */
  water: string;
  deep: string;
  /** Land colour ramp as [height (units/8), colour]. */
  land: [number, string][];
  /** 0..1 strength of hill shading. */
  shade: number;
  coast: string;
  /** Contour spacing in units/8 (0 = none). */
  contour: number;
  contourColor: string;
  grid: string;
  fog: string;
  trail: string;
  player: string;
  label: string;
  /** Background behind the map (outside the world). */
  void: string;
}

export interface Variant {
  id: string;
  label: string;
  dark: boolean;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  nav: NavStyle;
  /** Side navigation or a bar across the top/bottom. */
  navPlacement: "side" | "top" | "bottom";
  variants: Variant[];
  terms: Partial<Record<TermKey, string>>;
  /** Optional grouping of sections into top-level tabs (e.g. a wrist-terminal layout). */
  groups?: { label: string; sections: SectionId[] }[];
  map: Record<string, MapStyle>;
  /** Small decorative mark used in headings ("*" style fleuron). */
  fleuron: string;
}

export type TermKey =
  | SectionId
  | "quickNote"
  | "marker"
  | "session"
  | "nextTime"
  | "brand"
  | "diary"
  | "notes"
  | "timeline"
  | "people.one";

export const DEFAULT_TERMS: Record<TermKey, string> = {
  resume: "Where Was I?",
  map: "Map",
  quests: "Quests",
  people: "People",
  journal: "Journal",
  discoveries: "Discoveries",
  character: "Character",
  travel: "Travel",
  delves: "Dungeons",
  ledger: "Ledger",
  settings: "Settings",
  quickNote: "Quick note",
  marker: "Marker",
  session: "Session",
  nextTime: "Next time",
  brand: "CODEX",
  diary: "Diary",
  notes: "Notes",
  timeline: "Timeline",
  "people.one": "person",
};

const parchmentMap = (overrides: Partial<MapStyle> = {}): MapStyle => ({
  water: "#b9b08f",
  deep: "#a59b7a",
  land: [
    [-20, "#d9cba4"],
    [40, "#d4c296"],
    [300, "#c9b283"],
    [900, "#b39a6c"],
    [1800, "#9a8059"],
  ],
  shade: 0.55,
  coast: "#4a3a26",
  contour: 160,
  contourColor: "rgba(84,64,40,0.22)",
  grid: "rgba(84,64,40,0.14)",
  fog: "rgba(60,46,30,0.55)",
  trail: "#7b2f1f",
  player: "#6b1d12",
  label: "#3b2d1c",
  void: "#a59b7a",
  ...overrides,
});

export const THEMES: Record<ThemeId, ThemeDef> = {
  morrowind: {
    id: "morrowind",
    name: "Morrowind — Vvardenfell journal",
    nav: "ribbons",
    navPlacement: "side",
    variants: [
      { id: "parchment", label: "Parchment", dark: false },
      { id: "lamplight", label: "Lamplight", dark: true },
    ],
    terms: { brand: "Journal", resume: "Where Was I?", delves: "Caves & Ruins", ledger: "Stores & Stashes", discoveries: "Discoveries" },
    map: {
      parchment: parchmentMap(),
      lamplight: parchmentMap({
        water: "#2c3436",
        deep: "#20282a",
        land: [
          [-20, "#5a4a33"],
          [60, "#6a573b"],
          [400, "#7b6544"],
          [1000, "#8c7550"],
          [1800, "#a08a63"],
        ],
        coast: "#e3cf9c",
        contourColor: "rgba(232,210,160,0.18)",
        grid: "rgba(232,210,160,0.10)",
        fog: "rgba(8,8,6,0.6)",
        trail: "#e0a050",
        player: "#f2c66d",
        label: "#f0dfb2",
        void: "#20282a",
      }),
    },
    fleuron: "❦",
  },
  daggerfall: {
    id: "daggerfall",
    name: "Daggerfall — Iliac Bay logbook",
    nav: "stone",
    navPlacement: "top",
    variants: [
      { id: "parchment", label: "Parchment", dark: false },
      { id: "dungeon", label: "Dungeon", dark: true },
    ],
    terms: { brand: "Logbook", quests: "Quest Log", journal: "Notebook", character: "Character Sheet", delves: "Dungeons", ledger: "Inventory & Stores" },
    map: {
      parchment: parchmentMap({ coast: "#5a2418", trail: "#8a1f14", player: "#8a1f14", label: "#3a1d14" }),
      dungeon: parchmentMap({ water: "#1d2226", deep: "#15191c", land: [[-20, "#3d3a34"], [400, "#4d4840"], [1500, "#615a4e"]], coast: "#c9a24a", trail: "#d0503a", player: "#e0c060", label: "#e2d2a8", grid: "rgba(220,200,150,0.1)", contourColor: "rgba(220,200,150,0.15)", void: "#15191c" }),
    },
    fleuron: "✠",
  },
  oblivion: {
    id: "oblivion",
    name: "Oblivion — Cyrodiil chronicle",
    nav: "chapters",
    navPlacement: "side",
    variants: [
      { id: "day", label: "Day", dark: false },
      { id: "night", label: "Night", dark: true },
    ],
    terms: { brand: "Chronicle", character: "Stats", ledger: "Inventory", delves: "Dungeons", resume: "Where Was I?" },
    map: {
      day: parchmentMap({ water: "#c4b38c", deep: "#b3a27c", coast: "#6b4f2a", trail: "#8c5a1c", player: "#7a3b12", label: "#4a3418" }),
      night: parchmentMap({ water: "#262019", deep: "#1c1813", land: [[-20, "#4a3d2c"], [400, "#5c4c37"], [1500, "#75613f"]], coast: "#d8b46a", trail: "#e3b463", player: "#f0cd7a", label: "#ecd9ab", grid: "rgba(236,217,171,0.1)", contourColor: "rgba(236,217,171,0.14)", void: "#1c1813" }),
    },
    fleuron: "❧",
  },
  skyrim: {
    id: "skyrim",
    name: "Skyrim — Nordic iron",
    nav: "nordic",
    navPlacement: "top",
    variants: [
      { id: "night", label: "Night", dark: true },
      { id: "frost", label: "Frost", dark: false },
    ],
    terms: { brand: "", character: "Skills", ledger: "Items", delves: "Dungeons", journal: "Journal", resume: "Where Was I?" },
    map: {
      night: {
        water: "#1c2329", deep: "#141a1f", land: [[-20, "#3b4046"], [400, "#545a60"], [1200, "#7d838a"], [2000, "#c9ced3"]], shade: 0.7,
        coast: "#d9dee3", contour: 0, contourColor: "transparent", grid: "rgba(220,226,232,0.08)", fog: "rgba(0,0,0,0.6)",
        trail: "#e8e2cf", player: "#ffffff", label: "#e8ecef", void: "#101418",
      },
      frost: {
        water: "#b7c2c9", deep: "#a3afb7", land: [[-20, "#e2e4e3"], [400, "#cfd2d2"], [1200, "#aeb3b5"], [2000, "#ffffff"]], shade: 0.6,
        coast: "#2f363b", contour: 0, contourColor: "transparent", grid: "rgba(40,48,54,0.1)", fog: "rgba(240,244,246,0.65)",
        trail: "#3a2f22", player: "#1d2327", label: "#1d2327", void: "#a3afb7",
      },
    },
    fleuron: "◆",
  },
  falloutnv: {
    id: "falloutnv",
    name: "New Vegas — wasteland terminal",
    nav: "terminal",
    navPlacement: "top",
    variants: [
      { id: "green", label: "Green phosphor", dark: true },
      { id: "amber", label: "Amber phosphor", dark: true },
    ],
    terms: { brand: "CODEX // TERMINAL", resume: "STATUS", map: "MAP", quests: "QUESTS", people: "CONTACTS", journal: "NOTES", discoveries: "DATA", character: "STAT", travel: "ROUTES", delves: "VAULTS & CAVES", ledger: "INV", settings: "SYS" },
    groups: [
      { label: "STAT", sections: ["resume", "character"] },
      { label: "INV", sections: ["ledger"] },
      { label: "DATA", sections: ["quests", "journal", "people", "discoveries", "delves"] },
      { label: "MAP", sections: ["map", "travel"] },
      { label: "SYS", sections: ["settings"] },
    ],
    map: {
      green: {
        water: "#06140b", deep: "#041008", land: [[-20, "#0d2a16"], [400, "#14421f"], [1500, "#1f6b33"]], shade: 0.8,
        coast: "#5cff8a", contour: 200, contourColor: "rgba(92,255,138,0.16)", grid: "rgba(92,255,138,0.10)", fog: "rgba(0,8,3,0.7)",
        trail: "#a6ffbf", player: "#d6ffe2", label: "#7dffa3", void: "#030a05",
      },
      amber: {
        water: "#160d03", deep: "#100902", land: [[-20, "#2e1d07"], [400, "#4a2f0b"], [1500, "#7a4e12"]], shade: 0.8,
        coast: "#ffb642", contour: 200, contourColor: "rgba(255,182,66,0.16)", grid: "rgba(255,182,66,0.10)", fog: "rgba(8,4,0,0.7)",
        trail: "#ffd08a", player: "#fff0d0", label: "#ffc160", void: "#0a0601",
      },
    },
    fleuron: "■",
  },
  kotor: {
    id: "kotor",
    name: "KOTOR — datapad",
    nav: "datapad",
    navPlacement: "side",
    variants: [
      { id: "blue", label: "Republic blue", dark: true },
      { id: "crimson", label: "Crimson", dark: true },
    ],
    terms: { brand: "DATAPAD", resume: "Mission Status", quests: "Quests", people: "Contacts", journal: "Journal", discoveries: "Galactic Records", travel: "Navigation", delves: "Installations", ledger: "Equipment & Stores" },
    map: {
      blue: {
        water: "#06101c", deep: "#040b14", land: [[-20, "#0f2236"], [400, "#173454"], [1500, "#2a5c8a"]], shade: 0.7,
        coast: "#7fd4ff", contour: 220, contourColor: "rgba(127,212,255,0.14)", grid: "rgba(127,212,255,0.12)", fog: "rgba(2,6,12,0.7)",
        trail: "#b8ecff", player: "#ffffff", label: "#a8e2ff", void: "#03080f",
      },
      crimson: {
        water: "#160606", deep: "#100404", land: [[-20, "#2e0f10"], [400, "#4d1719"], [1500, "#8a2a2c"]], shade: 0.7,
        coast: "#ff8a7f", contour: 220, contourColor: "rgba(255,138,127,0.14)", grid: "rgba(255,138,127,0.12)", fog: "rgba(12,2,2,0.7)",
        trail: "#ffc4bc", player: "#ffffff", label: "#ffb0a8", void: "#0d0303",
      },
    },
    fleuron: "◇",
  },
  gothic: {
    id: "gothic",
    name: "Gothic — colony diary",
    nav: "iron",
    navPlacement: "side",
    variants: [
      { id: "torch", label: "Torchlight", dark: true },
      { id: "ash", label: "Ash", dark: false },
    ],
    terms: { brand: "Diary", quests: "Missions", journal: "Diary", discoveries: "General Information", people: "Folk", delves: "Mines & Caves", ledger: "Belongings" },
    map: {
      torch: parchmentMap({ water: "#2a2a24", deep: "#1f1f1a", land: [[-20, "#5a4c34"], [400, "#6b5a3d"], [1500, "#857250"]], coast: "#d9b86a", trail: "#e08a3a", player: "#ffcf70", label: "#ecd8a8", grid: "rgba(236,216,168,0.1)", contourColor: "rgba(236,216,168,0.14)", void: "#1a1a16" }),
      ash: parchmentMap({ water: "#9a958a", deep: "#8a857a", land: [[-20, "#c7bda8"], [400, "#b5a98f"], [1500, "#9a8c70"]], coast: "#2e2618", trail: "#6e2a14", player: "#4a1a0c", label: "#2a2216", void: "#8a857a" }),
    },
    fleuron: "†",
  },
  stalker: {
    id: "stalker",
    name: "S.T.A.L.K.E.R. — field PDA",
    nav: "pda",
    navPlacement: "bottom",
    variants: [
      { id: "olive", label: "Olive", dark: true },
      { id: "night", label: "Night", dark: true },
    ],
    terms: { brand: "PDA", resume: "Status", quests: "Tasks", people: "Contacts", journal: "Diary", discoveries: "Encyclopedia", character: "Statistics", travel: "Routes", delves: "Underground", ledger: "Stash" },
    map: {
      olive: {
        water: "#3c4236", deep: "#33392e", land: [[-20, "#5f634e"], [400, "#6e7259"], [1500, "#878a6c"]], shade: 0.6,
        coast: "#1f2219", contour: 180, contourColor: "rgba(20,24,16,0.25)", grid: "rgba(20,24,16,0.18)", fog: "rgba(20,22,16,0.6)",
        trail: "#c7c27a", player: "#f0e48a", label: "#e6e6cf", void: "#2b3027",
      },
      night: {
        water: "#151a15", deep: "#101410", land: [[-20, "#25302a"], [400, "#2f3d35"], [1500, "#3f5246"]], shade: 0.6,
        coast: "#9fc8a8", contour: 180, contourColor: "rgba(159,200,168,0.15)", grid: "rgba(159,200,168,0.1)", fog: "rgba(4,6,4,0.7)",
        trail: "#c8e0a0", player: "#e8ffd0", label: "#b8dcc0", void: "#0b0e0b",
      },
    },
    fleuron: "▪",
  },
};

export function themeOf(id: ThemeId): ThemeDef {
  return THEMES[id] ?? THEMES.morrowind;
}

export function term(theme: ThemeDef, key: TermKey): string {
  return theme.terms[key] ?? DEFAULT_TERMS[key];
}

export function mapStyle(theme: ThemeDef, variant: string): MapStyle {
  return theme.map[variant] ?? Object.values(theme.map)[0];
}

export function defaultVariant(theme: ThemeDef): string {
  return theme.variants[0].id;
}
