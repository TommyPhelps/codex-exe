/**
 * Game adapters: everything CODEX.EXE knows about a supported game lives in
 * one manifest entry. Adding a game means adding an entry here, a theme in
 * themes.ts and a stylesheet in src/styles/themes. See docs/ADDING_GAMES.md.
 *
 * Support levels are deliberately conservative:
 *  - enhanced: an optional bridge can stream verified game data (Morrowind).
 *  - partial:  some live data is available.
 *  - manual:   every companion tool works, but nothing is read from the game
 *              beyond detecting that its executable is running.
 */

export type ThemeId =
  | "morrowind"
  | "daggerfall"
  | "oblivion"
  | "skyrim"
  | "falloutnv"
  | "kotor"
  | "gothic"
  | "stalker";

export type SupportLevel = "enhanced" | "partial" | "manual";
export type BridgeEngine = "mwse" | "openmw";

export interface MarkerCategory {
  id: string;
  label: string;
  color: string;
}

export interface CharacterTemplate {
  /** Short labelled fields shown at the top of the sheet. */
  fields: string[];
  attributes: string[];
  skills: string[];
  /** Label used for the attribute block (e.g. "S.P.E.C.I.A.L."). */
  attributeLabel: string;
  skillLabel: string;
}

export interface GameAdapter {
  id: string;
  name: string;
  short: string;
  theme: ThemeId;
  released: number;
  support: SupportLevel;
  supportNote: string;
  /** Lower-case executable names used for "is the game running?" detection. */
  executables: string[];
  /** Folder names looked for inside Steam / GOG libraries. */
  installFolders: string[];
  bridges: BridgeEngine[];
  map: {
    provider: "tes3-atlas" | "image";
    worldName: string;
    /** World units per exterior cell for engines with a cell grid. */
    cellSize?: number;
  };
  markerCategories: MarkerCategory[];
  discoveryCategories: string[];
  travelModes: string[];
  character: CharacterTemplate;
  /** Where the game usually keeps screenshots, relative hints only. */
  screenshotHint: string;
  /** Real place names used only in placeholder examples ("@ Balmora"). */
  examples: { town: string; town2: string; goal: string };
}

export const MARKER_CATEGORIES: MarkerCategory[] = [
  { id: "quest", label: "Quest location", color: "#b5832a" },
  { id: "dungeon", label: "Dungeon", color: "#6b4a2b" },
  { id: "merchant", label: "Merchant", color: "#3f6b3a" },
  { id: "trainer", label: "Trainer", color: "#365a7a" },
  { id: "npc", label: "Interesting NPC", color: "#7a3d6b" },
  { id: "treasure", label: "Treasure", color: "#a8862a" },
  { id: "danger", label: "Dangerous area", color: "#8f2e22" },
  { id: "home", label: "Home or storage", color: "#5b5b2e" },
  { id: "revisit", label: "Place to revisit", color: "#2e6b6b" },
  { id: "custom", label: "Custom", color: "#555049" },
];

const BASE_DISCOVERY = [
  "Places",
  "NPCs",
  "Factions",
  "Creatures",
  "Items",
  "Quests",
  "Books",
  "Spells",
  "Skills",
  "Dungeons",
  "Rumors",
  "History",
  "Personal",
];

const TES_ATTRIBUTES = ["Strength", "Intelligence", "Willpower", "Agility", "Speed", "Endurance", "Personality", "Luck"];

export const MORROWIND_SKILLS = [
  "Block",
  "Armorer",
  "Medium Armor",
  "Heavy Armor",
  "Blunt Weapon",
  "Long Blade",
  "Axe",
  "Spear",
  "Athletics",
  "Enchant",
  "Destruction",
  "Alteration",
  "Illusion",
  "Conjuration",
  "Mysticism",
  "Restoration",
  "Alchemy",
  "Unarmored",
  "Security",
  "Sneak",
  "Acrobatics",
  "Light Armor",
  "Short Blade",
  "Marksman",
  "Mercantile",
  "Speechcraft",
  "Hand-to-hand",
];

export const GAMES: GameAdapter[] = [
  {
    id: "morrowind",
    name: "The Elder Scrolls III: Morrowind",
    short: "Morrowind",
    theme: "morrowind",
    released: 2002,
    support: "enhanced",
    supportNote:
      "Optional read-only bridge for MWSE-Lua (original engine) or OpenMW Lua. Without it, every tool works in manual mode. The world map is built from your own installed game files.",
    executables: ["morrowind.exe", "openmw.exe"],
    installFolders: ["Morrowind", "The Elder Scrolls III - Morrowind", "Morrowind GOTY", "OpenMW"],
    bridges: ["mwse", "openmw"],
    map: { provider: "tes3-atlas", worldName: "Vvardenfell", cellSize: 8192 },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: BASE_DISCOVERY,
    travelModes: [
      "Silt Strider",
      "Boat",
      "Guild Guide",
      "Gondola",
      "Propylon",
      "Mark & Recall",
      "Divine Intervention",
      "Almsivi Intervention",
      "On foot",
      "Other",
    ],
    character: {
      fields: ["Race", "Class", "Birthsign", "Level"],
      attributes: TES_ATTRIBUTES,
      skills: MORROWIND_SKILLS,
      attributeLabel: "Attributes",
      skillLabel: "Skills",
    },
    examples: { town: "Balmora", town2: "Caldera", goal: "Become a powerful Telvanni mage" },
    screenshotHint: "Original engine: the Morrowind folder (or MGE XE's screenshot folder). OpenMW: Documents\\My Games\\OpenMW\\screenshots.",
  },
  {
    id: "daggerfall",
    name: "Daggerfall Unity",
    short: "Daggerfall",
    theme: "daggerfall",
    released: 1996,
    support: "manual",
    supportNote:
      "Manual companion. Daggerfall Unity mods are compiled C# bundles; CODEX.EXE does not ship one, so nothing is read from the game. Detection of the running executable only.",
    executables: ["daggerfallunity.exe"],
    installFolders: ["DaggerfallUnity", "Daggerfall Unity"],
    bridges: [],
    map: { provider: "image", worldName: "the Iliac Bay" },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: BASE_DISCOVERY,
    travelModes: ["Fast travel (cautious)", "Fast travel (reckless)", "Ship", "On foot", "Horse or cart", "Other"],
    character: {
      fields: ["Race", "Class", "Level", "Reputation"],
      attributes: TES_ATTRIBUTES,
      skills: [
        "Medical", "Etiquette", "Streetwise", "Jumping", "Orcish", "Harpy", "Giantish", "Dragonish", "Nymph",
        "Daedric", "Spriggan", "Centaurian", "Impish", "Lockpicking", "Mercantile", "Pickpocket", "Stealth",
        "Swimming", "Climbing", "Backstabbing", "Dodging", "Running", "Destruction", "Restoration", "Illusion",
        "Alteration", "Thaumaturgy", "Mysticism", "Short Blade", "Long Blade", "Hand-to-Hand", "Axe",
        "Blunt Weapon", "Archery", "Critical Strike",
      ],
      attributeLabel: "Attributes",
      skillLabel: "Skills",
    },
    examples: { town: "Daggerfall", town2: "Wayrest", goal: "Rise through the Mages Guild" },
    screenshotHint: "Daggerfall Unity's persistent data folder (Screenshots).",
  },
  {
    id: "oblivion",
    name: "The Elder Scrolls IV: Oblivion",
    short: "Oblivion",
    theme: "oblivion",
    released: 2006,
    support: "manual",
    supportNote: "Manual companion. No live data is read from the game; executable detection only.",
    executables: ["oblivion.exe", "obse_loader.exe"],
    installFolders: ["Oblivion", "The Elder Scrolls IV Oblivion"],
    bridges: [],
    map: { provider: "image", worldName: "Cyrodiil" },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: BASE_DISCOVERY,
    travelModes: ["Fast travel", "Horse", "On foot", "Other"],
    character: {
      fields: ["Race", "Class", "Birthsign", "Level"],
      attributes: TES_ATTRIBUTES,
      skills: [
        "Armorer", "Athletics", "Blade", "Block", "Blunt", "Hand to Hand", "Heavy Armor", "Alchemy",
        "Alteration", "Conjuration", "Destruction", "Illusion", "Mysticism", "Restoration", "Acrobatics",
        "Light Armor", "Marksman", "Mercantile", "Security", "Sneak", "Speechcraft",
      ],
      attributeLabel: "Attributes",
      skillLabel: "Skills",
    },
    examples: { town: "Chorrol", town2: "Skingrad", goal: "Become a master alchemist" },
    screenshotHint: "The Oblivion install folder (ScreenShot*.bmp).",
  },
  {
    id: "skyrim",
    name: "The Elder Scrolls V: Skyrim",
    short: "Skyrim",
    theme: "skyrim",
    released: 2011,
    support: "manual",
    supportNote: "Manual companion (theme and tools). No live data is read; executable detection only.",
    executables: ["skyrimse.exe", "tesv.exe", "skse64_loader.exe", "skyrimvr.exe"],
    installFolders: ["Skyrim Special Edition", "Skyrim", "Skyrim Anniversary Edition"],
    bridges: [],
    map: { provider: "image", worldName: "Skyrim" },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: BASE_DISCOVERY,
    travelModes: ["Carriage", "Boat", "Fast travel", "Horse", "On foot", "Other"],
    character: {
      fields: ["Race", "Level", "Standing Stone"],
      attributes: ["Health", "Magicka", "Stamina"],
      skills: [
        "Illusion", "Conjuration", "Destruction", "Restoration", "Alteration", "Enchanting", "Smithing",
        "Heavy Armor", "Block", "Two-Handed", "One-Handed", "Archery", "Light Armor", "Sneak", "Lockpicking",
        "Pickpocket", "Speech", "Alchemy",
      ],
      attributeLabel: "Attributes",
      skillLabel: "Skills",
    },
    examples: { town: "Whiterun", town2: "Riften", goal: "Join the Companions and lead them one day" },
    screenshotHint: "Steam's screenshot folder, or the game folder if in-game screenshots are enabled.",
  },
  {
    id: "falloutnv",
    name: "Fallout: New Vegas",
    short: "New Vegas",
    theme: "falloutnv",
    released: 2010,
    support: "manual",
    supportNote: "Manual companion (theme and tools). No live data is read; executable detection only.",
    executables: ["falloutnv.exe", "nvse_loader.exe"],
    installFolders: ["Fallout New Vegas", "FalloutNV"],
    bridges: [],
    map: { provider: "image", worldName: "the Mojave Wasteland" },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: ["Locations", "People", "Factions", "Creatures", "Items", "Quests", "Notes", "Perks", "Recipes", "Rumors", "Personal"],
    travelModes: ["Fast travel", "On foot", "Other"],
    character: {
      fields: ["Level", "Karma", "Traits", "Tagged skills"],
      attributes: ["Strength", "Perception", "Endurance", "Charisma", "Intelligence", "Agility", "Luck"],
      skills: [
        "Barter", "Energy Weapons", "Explosives", "Guns", "Lockpick", "Medicine", "Melee Weapons", "Repair",
        "Science", "Sneak", "Speech", "Survival", "Unarmed",
      ],
      attributeLabel: "S.P.E.C.I.A.L.",
      skillLabel: "Skills",
    },
    examples: { town: "Goodsprings", town2: "Primm", goal: "Make it to the Strip" },
    screenshotHint: "Steam's screenshot folder, or the game folder.",
  },
  {
    id: "kotor",
    name: "Star Wars: Knights of the Old Republic",
    short: "KOTOR",
    theme: "kotor",
    released: 2003,
    support: "manual",
    supportNote: "Manual companion (theme and tools). No live data is read; executable detection only.",
    executables: ["swkotor.exe", "swkotor2.exe"],
    installFolders: ["swkotor", "Star Wars Knights of the Old Republic", "Knights of the Old Republic II"],
    bridges: [],
    map: { provider: "image", worldName: "the galaxy" },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: ["Planets", "People", "Factions", "Creatures", "Items", "Quests", "Datapad", "Powers", "Skills", "Rumors", "Personal"],
    travelModes: ["Ebon Hawk", "Shuttle or elevator", "On foot", "Other"],
    character: {
      fields: ["Class", "Level", "Alignment"],
      attributes: ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
      skills: ["Computer Use", "Demolitions", "Stealth", "Awareness", "Persuade", "Repair", "Security", "Treat Injury"],
      attributeLabel: "Attributes",
      skillLabel: "Skills",
    },
    examples: { town: "Taris", town2: "Dantooine", goal: "Finish my Jedi training" },
    screenshotHint: "The game folder (Screenshots).",
  },
  {
    id: "gothic",
    name: "Gothic",
    short: "Gothic",
    theme: "gothic",
    released: 2001,
    support: "manual",
    supportNote: "Manual companion (theme and tools). No live data is read; executable detection only.",
    executables: ["gothic.exe", "gothic2.exe", "gothicmod.exe"],
    installFolders: ["Gothic", "Gothic II", "Gothic 2 Gold Edition"],
    bridges: [],
    map: { provider: "image", worldName: "the Valley of Mines" },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: BASE_DISCOVERY,
    travelModes: ["Teleport rune or scroll", "On foot", "Other"],
    character: {
      fields: ["Guild", "Level", "Experience"],
      attributes: ["Strength", "Dexterity", "Mana", "Hit Points"],
      skills: ["One-handed", "Two-handed", "Bow", "Crossbow", "Lock picking", "Pickpocketing", "Sneaking", "Acrobatics", "Magic circle"],
      attributeLabel: "Attributes",
      skillLabel: "Talents",
    },
    examples: { town: "the Old Camp", town2: "the New Camp", goal: "Earn a place in one of the camps" },
    screenshotHint: "The game's system folder or your capture tool's folder.",
  },
  {
    id: "stalker",
    name: "S.T.A.L.K.E.R.",
    short: "S.T.A.L.K.E.R.",
    theme: "stalker",
    released: 2007,
    support: "manual",
    supportNote: "Manual companion (theme and tools). No live data is read; executable detection only.",
    executables: ["xr_3da.exe", "xrengine.exe", "anomalydx11.exe", "anomalydx11avx.exe", "anomalydx9.exe"],
    installFolders: ["S.T.A.L.K.E.R. Shadow of Chernobyl", "S.T.A.L.K.E.R. Call of Pripyat", "S.T.A.L.K.E.R. Clear Sky", "Anomaly"],
    bridges: [],
    map: { provider: "image", worldName: "the Zone" },
    markerCategories: MARKER_CATEGORIES,
    discoveryCategories: ["Locations", "Stalkers", "Factions", "Mutants", "Artifacts", "Anomalies", "Tasks", "Items", "Rumors", "Personal"],
    travelModes: ["Guide", "On foot", "Other"],
    character: {
      fields: ["Faction", "Rank", "Reputation"],
      attributes: [],
      skills: [],
      attributeLabel: "",
      skillLabel: "",
    },
    examples: { town: "Rookie Village", town2: "the Bar", goal: "Reach the center of the Zone" },
    screenshotHint: "Documents\\STALKER-* or the game's screenshots folder.",
  },
];

const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

export function gameById(id: string | null | undefined): GameAdapter {
  return (id && BY_ID.get(id)) || GAMES[0];
}

export function isKnownGame(id: string): boolean {
  return BY_ID.has(id);
}

/** Which adapter (if any) owns a running process name. */
export function gameForExecutable(exe: string, extra: Record<string, string[]> = {}): GameAdapter | null {
  const name = exe.toLowerCase().replace(/^.*[\\/]/, "");
  for (const g of GAMES) {
    if (g.executables.includes(name)) return g;
    if ((extra[g.id] ?? []).map((e) => e.toLowerCase()).includes(name)) return g;
  }
  return null;
}

export const SUPPORT_LABEL: Record<SupportLevel, string> = {
  enhanced: "Enhanced integration (optional bridge)",
  partial: "Partial integration",
  manual: "Manual companion",
};

export function markerCategory(game: GameAdapter, id: string): MarkerCategory {
  return game.markerCategories.find((c) => c.id === id) ?? game.markerCategories[game.markerCategories.length - 1];
}

/** Fills {town}, {town2} and {goal} in placeholder text with the game's own example names. */
export function exampleText(text: string, game: GameAdapter): string {
  return text.replace(/\{town\}/g, game.examples.town).replace(/\{town2\}/g, game.examples.town2).replace(/\{goal\}/g, game.examples.goal);
}
