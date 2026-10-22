# CODEX.EXE

A local-first, second-monitor companion for classic PC RPGs, starting with
**The Elder Scrolls III: Morrowind**. It is your adventurer's journal, map, quest notebook and
"where was I?" memory — styled to belong to whichever game you are playing, and it never plays
the game for you.

- **Windows 10/11, free, offline.** No accounts, no cloud, no AI required.
- **Download:** [Releases](../../releases) → `CODEX_<version>_x64-setup.exe` (installer),
  `CODEX_<version>_x64_en-US.msi`, or `CODEX_<version>_x64_portable.exe` (no install; keeps its
  data in a `CODEX-data` folder beside it).

## What it does

| Section | What you get |
|---|---|
| **Where was I?** | A rule-based recap built only from what you recorded and what the game reported: where you stopped, your "next time" note, active quests, unfinished dungeons, things you still need, reminders, recent places and discoveries. |
| **Map** | Pan/zoom map with your own markers (10 categories, notes, colours, filters, search). For Morrowind, a relief map is drawn from **your installed game files** (Morrowind.esm plus your load order, so Tamriel Rebuilt and other landmass mods are included). Live position, follow-player, travel trail that breaks on teleports and never records in menus. Import any image as a map and calibrate it with two points. Freehand dungeon sketches. |
| **Quests** | Your own quests (active/paused/completed) with last known information, clues, questions, items needed, next step, linked people and places — plus journal entries synced from the game, kept separate. A five-step hint ladder that only ever shows your notes and the game's own text; a walkthrough is just a web search you have to ask for. |
| **People** | A quick NPC memory: where, faction, services, what they asked, what you promised, and links to quests, places, other people, items and notes. |
| **Journal** | Quick notes (global hotkey, timestamp, live location, tags, checklists, Markdown, screenshots, pinning, turn into marker or clue), an in-character diary saved exactly as written, and a timeline. |
| **Discoveries** | A personal codex of what you found. Reference information from game files is opt-in and always labelled. |
| **Character** | Level, attributes, skills (synced when the bridge runs, manual otherwise), build notes, priorities, roleplay rules, goals, spell/alchemy/enchanting notebooks, faction goals. Never tells you you are playing wrong. |
| **Travel** | Routes you recorded, plus — in reference mode — travel services read from your game files. No invented routes or prices. |
| **Caves & Ruins** | Dungeon notebook: entrances, locked doors, keys, unexplored passages, dangers, loot left behind, return-later reminders, sketch or imported map. |
| **Stores & Stashes** | Where you stored things, merchants worth remembering, things to buy and sell. |

**Spoiler-free by default.** Without reference mode, only places you have visited get map labels
and nothing from the game files is shown to you.

## Supported games

| Game | Theme | Support |
|---|---|---|
| Morrowind (original engine + MWSE, or OpenMW) | Parchment journal (Parchment / Lamplight variants) | **Enhanced:** optional live bridge; relief map and travel data from your game files |
| Daggerfall Unity | Stone and red-ribbon logbook | Manual companion |
| Oblivion | Gilded book chapters | Manual companion |
| Skyrim | Nordic iron and frost | Manual companion |
| Fallout: New Vegas | Pip-Boy-style terminal (green/amber) | Manual companion |
| Knights of the Old Republic | Sci-fi datapad | Manual companion |
| Gothic | Rough iron and dirty parchment | Manual companion |
| S.T.A.L.K.E.R. | Olive PDA | Manual companion |

"Manual companion" means every tool works — notes, quests, people, maps (imported image),
dungeons, travel, recap — and the app detects when the game is running, but nothing is read from
the game itself. Each character has its own journal, map and data; characters are never merged.

## Morrowind live bridge

Optional. Install it from **Settings → Game & bridge**, or by hand. See **[docs/BRIDGE.md](docs/BRIDGE.md)**
for exactly what is reported, how to install/uninstall, and its verification status.

The header pill always tells you where data comes from: **Connected — live**,
**Connected — limited information**, **Manual mode**, or **Game not running**. Live values are
marked as coming from the game; everything else is what you entered.

## Second-monitor use

- Remembers window size, position and monitor. Optional always-on-top.
- Compact sidebar mode for a narrow strip of the second screen; full map and full journal modes.
- Global hotkeys (configurable, checked for conflicts): **Ctrl+Alt+N** quick note,
  **Ctrl+Alt+M** mark current position (does not take focus from the game),
  **Ctrl+Alt+J** compact mode. Inside the app: Ctrl+K search, Ctrl+N note, Ctrl+1…9 sections.
- Never steals focus on its own. Only the quick-note hotkey brings the window forward, because
  you asked to type.
- Light on resources: the bridge file is checked by size/time once a second only while a game is
  running (every 3 s otherwise); the process list every 4 s only when games are configured.
- Decorative effects can be turned off in Settings → Appearance.

## Your data

Everything is stored locally in SQLite. Daily automatic snapshots, full backup/restore, and
Markdown export: **[docs/BACKUP.md](docs/BACKUP.md)**.

## Known limitations

See [CHANGELOG.md](CHANGELOG.md#known-limitations).

## Building from source

Builds run on GitHub Actions (`.github/workflows/windows-build.yml`) on every push to `main` or
on demand. When a build of `main` succeeds with a version (in `src-tauri/tauri.conf.json`) that
has no release yet, the workflow tags it `v<version>` and publishes a GitHub Release with the
matching `CHANGELOG.md` section. Pushing a `v*` tag does the same. Locally you need Node 22.18+ and, for the
desktop shell, Rust with the Tauri 2 prerequisites.

```
npm install
npm test                 # TypeScript tests (node:test + node:sqlite, Lua bridges in fengari)
cargo test --manifest-path src-tauri/core/Cargo.toml   # game-file reader, atlas, load orders
npm run build            # UI bundle (esbuild)
npx tauri build          # Windows installer
node tools/preview.mjs   # browser preview + screenshots (needs Playwright)
```

Adding a game: [docs/ADDING_GAMES.md](docs/ADDING_GAMES.md).

## Legal

CODEX.EXE contains no game assets. All artwork, ornaments and icons are original; fonts are
open-licensed (see `assets/fonts/LICENSES`). Maps and travel data are read at runtime from game
files you own and are stored only on your PC. The Elder Scrolls, Morrowind, Oblivion, Skyrim,
Fallout, Daggerfall, Knights of the Old Republic, Gothic and S.T.A.L.K.E.R. are trademarks of
their respective owners; this project is not affiliated with or endorsed by them.
