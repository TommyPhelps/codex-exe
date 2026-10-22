# CODEX.EXE Morrowind bridges

Optional, read-only scripts that let CODEX.EXE follow your game on a second monitor.
CODEX.EXE can install and remove these for you (Settings → Game & bridge). This zip is for
installing by hand.

- `mwse/` — original Morrowind with MWSE 2.1. Copy `mwse/codex` into
  `Morrowind\Data Files\MWSE\mods\` (result: `Data Files\MWSE\mods\codex\bridge\main.lua`).
- `openmw/` — OpenMW 0.49+. Copy the folder somewhere permanent and add to your `openmw.cfg`:

  ```
  data="C:/path/to/that/folder"
  content=codex_bridge.omwscripts
  ```

Neither script changes the game, writes to saves, or connects to the network. To uninstall,
delete the files (and the two `openmw.cfg` lines). Saves load fine afterwards.

Full guide, what is reported, and the protocol: `docs/BRIDGE.md` in the CODEX.EXE repository.
