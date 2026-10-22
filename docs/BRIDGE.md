# Morrowind live bridge

CODEX.EXE works fully without any bridge (manual mode). The bridge is an optional, read-only
script that runs inside Morrowind and reports where you are, your journal and your character
sheet, so CODEX.EXE can follow along on your second monitor.

There are two bridges, because original Morrowind and OpenMW are different engines with
different scripting systems. MWSE does **not** work with OpenMW and vice versa.

| | Original engine (Morrowind.exe) | OpenMW |
|---|---|---|
| Requires | [MWSE 2.1](https://github.com/MWSE/MWSE) (MWSE-Lua; included with MGE XE) | OpenMW 0.49 or newer (journal text needs 0.50+) |
| How data reaches CODEX | Script writes `Data Files\MWSE\codex_live.json` | Script prints lines to `openmw.log`; CODEX reads the new lines |
| Files added | `Data Files\MWSE\mods\codex\bridge\main.lua` | `codex_bridge.omwscripts` + `scripts\codex_bridge\player.lua` in a folder you choose |
| Config changes | none | two lines in `openmw.cfg` (`data=` and `content=`), backed up first |
| Saves touched | never | never (no `onSave` handler) |

## What is reported

Both bridges announce their capabilities; CODEX only shows what was announced.

| Data | MWSE | OpenMW | Notes |
|---|---|---|---|
| Current cell, exterior grid, region | yes | yes | Interiors never get a world-map position. |
| Position and facing | yes | yes | Sampled every 1.5 s of *game* time, so nothing is recorded in menus, loading screens or while paused. |
| In-game date and time | yes | yes (needs `openmw_aux.calendar`) | |
| Journal updates (new entries, with the game's own text) | yes | yes (quest stage); journal text needs a newer OpenMW Lua API | Imported as "synced" quests, kept apart from your own quests. |
| Quest list on load | yes | yes (OpenMW 0.49+) | |
| Name, race, class, birthsign, level | yes | yes | |
| Attributes, skills, health/magicka/fatigue, gold | yes | yes | |
| Equipped items, selected spell, active effects | yes | yes | |
| Inventory (names and counts, max 300) | yes | yes | Refreshed after menus (MWSE) or every 60 s (OpenMW). |
| Save loaded / game saved | yes | loaded only | |
| Level-ups, skill increases | yes (events) | yes (detected by comparing stats) | |
| Teleport / fast travel | via cell change | yes (`onTeleported`) | CODEX breaks the travel trail instead of drawing a straight line. |
| Container contents, NPC dialogue, map markers | no | no | Not exposed safely; CODEX never pretends to know them. |

## Install from CODEX.EXE (recommended)

1. Open **Settings → Game & bridge**.
2. Choose **Original engine + MWSE** or **OpenMW**.
3. MWSE: pick the folder containing `Morrowind.exe` and `Data Files`. OpenMW: CODEX fills in
   `Documents\My Games\OpenMW\openmw.cfg`, `openmw.log` and a bridge folder
   (`Documents\My Games\OpenMW\CODEX bridge`); change them if yours live elsewhere.
4. Press **Install bridge**. CODEX lists every file it wrote.
5. Start the game and load a save. The status pill in the header changes to
   **Connected — live** (or **Connected — limited information** if your version reports less).

For OpenMW you can untick "Add it to openmw.cfg for me" and enable `codex_bridge.omwscripts` in the
OpenMW launcher's *Data Files* tab yourself.

## Install by hand

The release includes `CODEX_<version>_morrowind-bridges.zip` with the same scripts.

**MWSE:** copy `mwse/codex` into `Morrowind\Data Files\MWSE\mods\` so that the file ends up at
`Data Files\MWSE\mods\codex\bridge\main.lua`. In CODEX, choose *Original engine + MWSE* and
point it at your Morrowind folder.

**OpenMW:** copy the `openmw` folder somewhere permanent (for example
`Documents\My Games\OpenMW\CODEX bridge`), then add to the end of your user `openmw.cfg`:

```
data="C:/Users/<you>/Documents/My Games/OpenMW/CODEX bridge"
content=codex_bridge.omwscripts
```

In CODEX, choose *OpenMW* and set the log path (default `Documents\My Games\OpenMW\openmw.log`).

## Uninstall

From CODEX: **Settings → Game & bridge → Remove bridge**. It removes exactly the files it
installed (and, for OpenMW, the two `openmw.cfg` lines, after backing the file up as
`openmw.cfg.codex-backup`).

By hand: delete `Data Files\MWSE\mods\codex` and `Data Files\MWSE\codex_live.json` (MWSE), or
remove the two lines from `openmw.cfg` and delete the bridge folder (OpenMW).

Saves made with the bridge installed load normally without it: neither bridge stores anything in
a save.

## Safety

- No memory reading, no executable patching, no DLL injection.
- Save files are never opened, read or written by the bridge or by CODEX.
- The bridges make no network connections (OpenMW's sandbox has none; the MWSE script uses none).
- CODEX treats everything the bridge sends as untrusted: it validates types, sizes and ranges
  (`src/core/protocol.ts`), never executes it, and never renders it as HTML.
- CODEX reads the bridge file or log; it never writes to the game folder except when you press
  Install/Uninstall.

## Verification status (read this)

The bridges were written against the MWSE-Lua and OpenMW Lua API documentation, and they are
tested by running the real Lua scripts inside a Lua VM with simulated game objects
(`tests/lua.test.ts`) and by replaying recorded protocol traffic through the app
(`tests/telemetry.test.ts`, *Settings → Replay test session*).

**They have not yet been run inside a real copy of Morrowind or OpenMW.** Every game call is
wrapped in `pcall`, so an API difference makes a field disappear rather than breaking the game,
but expect the first real session to be the true test. If something looks wrong, check
`MWSE.log` (original engine) or `openmw.log` (OpenMW) for lines containing `CODEX`.

## Protocol (version 1)

Both bridges send the same JSON document:

```json
{
  "protocol": "codex-bridge", "v": 1, "engine": "mwse" | "openmw",
  "session": "mw67…", "seq": 42, "caps": ["cell", "position", …],
  "engineVersion": "MWSE 1234",
  "state": {
    "menu": false,
    "cell": { "name": "Balmora", "exterior": true, "gx": -3, "gy": -2, "region": "West Gash Region" },
    "pos": { "x": -21500, "y": -14600, "z": 300, "yaw": 0.6 },
    "time": { "year": 427, "month": 8, "day": 17, "hour": 10.5 },
    "character": { "name": "…", "level": 5, "skills": { "Long Blade": { "base": 40, "current": 40 } }, … }
  },
  "events": [ { "seq": 7, "kind": "journal", "questId": "…", "index": 10, "text": "…" } ]
}
```

- MWSE rewrites the whole document (with the last 120 events) to `codex_live.json`.
- OpenMW prints one document per line to `openmw.log`, prefixed with `CODEXBRIDGE1 `.
- `seq` increases per document and events carry their own `seq`, so CODEX applies each event once
  even if the file is read twice. A new `session` id means the game was restarted.
- Event kinds: `hello`, `loaded`, `saved`, `cell`, `journal`, `quests`, `levelUp`, `skillRaised`,
  `teleport`. Unknown kinds and fields are ignored.
