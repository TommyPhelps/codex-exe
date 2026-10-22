# Adding a game

Every supported game is one manifest entry plus one theme. Nothing else in the app has to change:
navigation, the map, quests, people, notes, dungeons, travel, the ledger and "Where was I?" all read
from the manifest.

## 1. Manifest entry — `src/core/games.ts`

Add an object to `GAMES`:

| Field | Purpose |
|---|---|
| `id`, `name`, `short` | Identifier and display names. `id` is stored with each character; never change it once shipped. |
| `theme` | Which theme to use (step 2). |
| `support` | `"enhanced"`, `"partial"` or `"manual"`. Be conservative: `manual` unless a bridge streams verified data. |
| `supportNote` | One honest sentence shown in Settings and the welcome screen. |
| `executables` | Lower-case `.exe` names for running-game detection (`tasklist`, every 4 s, only while games are configured). |
| `installFolders` | Folder names looked for in Steam libraries and common GOG/manual locations. |
| `bridges` | Live bridges for this game (`[]` for none). |
| `map` | `provider: "image"` (player-imported map, calibrated by two points) or `"tes3-atlas"` (relief built from TES3 content files). |
| `markerCategories`, `discoveryCategories`, `travelModes` | Game vocabulary. Reuse `MARKER_CATEGORIES` / `BASE_DISCOVERY` where sensible. |
| `character` | Fields, attributes and skills for the character sheet. Use the game's real names only. |
| `screenshotHint` | Where the game usually saves screenshots (shown as help text). |

## 2. Theme — `src/core/themes.ts` and `src/styles/themes/<id>.css`

`themes.ts` holds what code needs: the navigation style (`ribbons`, `stone`, `chapters`, `nordic`,
`terminal`, `datapad`, `iron`, `pda`), the section names in the game's own vocabulary
("Quest Log", "DATA", "Missions"…), light/dark variants, and map colouring.

The stylesheet holds colour tokens, fonts, materials (CSS/SVG textures), borders and ornaments.
Fonts must be open-licensed and live in `assets/fonts` with their licence in
`assets/fonts/LICENSES`. **Do not add game textures, logos, fonts or artwork.**

## 3. Live data (optional)

A live bridge must:

- use only the game's supported modding API (no memory reading, no patching);
- speak the protocol in [BRIDGE.md](BRIDGE.md) and announce only capabilities it really provides;
- never write to saves.

Add its engine name to `BridgeEngine`, a reader in `src-tauri/src/telemetry.rs` (file or log tail),
and tests that run the script against simulated game objects (see `tests/lua.test.ts`).

## 4. Tests

Add the game to the profile tests in `tests/data.test.ts` (separate characters, no merging) and,
if it has a coordinate system, to `tests/maps.test.ts`. Run `npm test` and
`node tools/preview.mjs` to capture screenshots of the new theme.
