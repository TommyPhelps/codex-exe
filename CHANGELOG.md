# Changelog

## [1.0.0] — 2026-10-22

First release of CODEX.EXE, a second-monitor companion for classic PC RPGs.

### Downloads

- `CODEX_1.0.0_x64-setup.exe` — installer (per-user, no admin needed)
- `CODEX_1.0.0_x64_en-US.msi` — MSI installer
- `CODEX_1.0.0_x64_portable.exe` — portable, keeps its data in `CODEX-data` beside the exe
- `CODEX_1.0.0_morrowind-bridges.zip` — the optional Morrowind bridge scripts, for installing by hand
- `SHA256SUMS.txt`

Windows 10/11 x64. WebView2 is installed automatically if missing.

### Highlights

- **Game themes that change the whole app**, not just colours: Morrowind (parchment journal with
  ribbon tabs; Parchment and Lamplight variants), Daggerfall Unity (stone logbook), Oblivion
  (gilded chapters), Skyrim (Nordic iron), Fallout: New Vegas (Pip-Boy-style terminal with
  STAT/INV/DATA/MAP/SYS), KOTOR (datapad), Gothic (rough iron), S.T.A.L.K.E.R. (PDA). Each has its
  own fonts, navigation, ornaments, map colouring and vocabulary. All artwork original.
- **Where was I?** recap built only from your notes and genuine game data, with a "next time"
  note when you end a session.
- **Interactive map** with personal markers, filters, search, live position and follow mode,
  travel trail (broken on teleports, never recorded in menus/loading/pause), interior awareness
  (no fake world position indoors), imported and calibrated map images, freehand sketches.
- **Morrowind relief map from your own game files** — reads Morrowind.esm and your load order
  (including Tamriel Rebuilt and other landmass mods), so nothing copyrighted ships with the app.
- **Quests, people, journal, diary, discoveries, character sheet, travel, dungeons, stores** —
  all linkable to each other, all per character.
- **Optional read-only Morrowind bridges** for the original engine (MWSE-Lua) and OpenMW (Lua),
  installed and removed from Settings, with clear connection status.
- **Spoiler-free by default**: hints only show what you recorded and what the game itself wrote;
  reference data from game files is opt-in and labelled.
- **Second-monitor friendly**: compact sidebar, full map/journal modes, always-on-top, remembered
  window and monitor, configurable global hotkeys that do not steal focus (except quick note).
- **Local-first**: SQLite, daily snapshots (20 kept), full backup/restore folder, Markdown export.

### Known limitations

- **The Morrowind bridges have not been run inside a real game yet.** They were written against
  the MWSE-Lua and OpenMW Lua documentation, executed in a Lua VM against simulated game objects,
  and the app was tested with recorded/synthetic bridge traffic. Every game call is guarded, so an
  API mismatch drops a field rather than breaking the game — but the first real session is the
  real test. See [docs/BRIDGE.md](docs/BRIDGE.md#verification-status-read-this).
- OpenMW: quests need OpenMW 0.49+; journal *text* needs a newer Lua API (0.50+). Older versions
  report location and character only ("Connected — limited information").
- OpenMW data arrives through `openmw.log`; if you change OpenMW's log settings so Lua `print`
  output is not written, the bridge cannot be read.
- The relief map covers TES3 exterior land only. Interiors and dungeons have no automatic map;
  use the dungeon notebook, a sketch or an imported image.
- Daggerfall Unity, Oblivion, Skyrim, Fallout: New Vegas, KOTOR, Gothic and S.T.A.L.K.E.R. are
  **manual companions**: themes and all tools work, executables are detected, but no game data is
  read. Their maps are images you import and calibrate.
- No hint database and no built-in walkthroughs, by design. "Full walkthrough" opens a web
  search in your browser only when you ask.
- No optional AI features in this release. Everything is deterministic.
- Installed-game detection checks Steam libraries and common GOG/manual folders only.
- The Windows build is produced and smoke-tested (the portable exe starts and creates its data
  folder) on GitHub's Windows runners. It has not been tested on your PC by the developer.
