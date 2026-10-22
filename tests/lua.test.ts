// Runs the real bridge scripts (bridge/mwse and bridge/openmw) inside a Lua VM
// (fengari, Lua 5.3) against mocks of the documented MWSE and OpenMW APIs.
//
// These tests prove that the scripts run, use only the read-only API calls
// we expect, and produce documents CODEX.EXE accepts. They do NOT prove that a
// real game build exposes these APIs exactly as mocked - see docs/BRIDGE.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseBridgeDocument, parseBridgeLines } from "../src/core/protocol.ts";
import { ingest, newTracker } from "../src/core/live.ts";

const require = createRequire(import.meta.url);
const fengari = require("fengari");
const { lua, lauxlib, lualib, to_luastring } = fengari;

const ROOT = new URL("..", import.meta.url).pathname;

function vm() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const out: { name: string; text: string }[] = [];
  const lines: string[] = [];
  lua.lua_pushjsfunction(L, (s: unknown) => {
    out.push({ name: lua.lua_tojsstring(s, 1), text: lua.lua_tojsstring(s, 2) });
    return 0;
  });
  lua.lua_setglobal(L, to_luastring("__emit"));
  lua.lua_pushjsfunction(L, (s: unknown) => {
    const n = lua.lua_gettop(s);
    const parts: string[] = [];
    for (let i = 1; i <= n; i++) parts.push(lauxlib.luaL_tolstring(s, i) ? lua.lua_tojsstring(s, -1) : "");
    lines.push(parts.join("\t"));
    return 0;
  });
  lua.lua_setglobal(L, to_luastring("__print"));
  const run = (code: string, name: string) => {
    const st = lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name));
    if (st !== 0) throw new Error(`load ${name}: ${lua.lua_tojsstring(L, -1)}`);
    const r = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
    if (r !== 0) throw new Error(`run ${name}: ${lua.lua_tojsstring(L, -1)}`);
  };
  return { L, out, lines, run };
}

const JSON_ENCODER = `
local function esc(s) return (s:gsub('[%c"\\\\]', function(c) return string.format('\\\\u%04x', c:byte()) end)) end
function __encode(v)
  local t = type(v)
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then
    if math.type and math.type(v) == 'integer' then return tostring(v) end
    if v == math.floor(v) then return string.format('%d', v) end
    return string.format('%.6f', v)
  end
  if t == 'string' then return '"' .. esc(v) .. '"' end
  if t == 'table' then
    local parts = {}
    if next(v) == nil then return '[]' end  -- like dkjson, empty tables become arrays
    if v[1] ~= nil then
      for i = 1, #v do parts[#parts+1] = __encode(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    for k, x in pairs(v) do parts[#parts+1] = '"' .. esc(tostring(k)) .. '":' .. __encode(x) end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  error('cannot encode ' .. t)
end
`;

const MWSE_MOCK = `
${JSON_ENCODER}
local listeners = {}
event = { register = function(name, fn) listeners[name] = listeners[name] or {}; table.insert(listeners[name], fn) end }
function __fire(name, data) for _, fn in ipairs(listeners[name] or {}) do fn(data or {}) end end
local timers = {}
timer = { simulate = 1, real = 2, game = 3, start = function(p)
  assert(p.persist == false, 'bridge timers must not persist into saves'); table.insert(timers, p); return p end }
function __tick(kind) for _, p in ipairs(timers) do if p.type == kind then p.callback() end end end
function __timerCount() return #timers end
mwse = { buildNumber = 4321, log = function() end }
json = { savefile = function(name, obj) __emit(name, __encode(obj)) end }
__menu = false

local function stat(b, c) return { base = b, current = c or b } end
local ATTR = { 'strength', 'intelligence', 'willpower', 'agility', 'speed', 'endurance', 'personality', 'luck' }
local attributes, skills = {}, {}
for i = 1, 8 do attributes[i] = stat(40 + i) end
for i = 1, 27 do skills[i] = stat(10 + i) end

local balmora = { name = 'Fixture Town', isInterior = false, gridX = -3, gridY = -2, region = { name = 'Fixture Region' } }
local tower = { name = 'Fixture Town, Tower', isInterior = true }
local quasi = { name = 'Fixture Quasi', isInterior = true, behavesAsExterior = true, gridX = 0, gridY = 0 }
__cells = { balmora = balmora, tower = tower, quasi = quasi }

local playerData = setmetatable({}, { __newindex = function() error('bridge wrote to tes3.player.data') end })
local player = {
  object = {
    name = 'Fixture Hero', level = 3, race = { name = 'Fixture Race' }, class = { name = 'Fixture Class' },
    equipment = { { object = { name = 'Fixture Saber' } }, { object = { name = 'Fixture Robe' } } },
    inventory = { { object = { name = 'Gold' }, count = 5 }, { object = { name = 'Fixture Potion' }, count = 2 } },
  },
  cell = balmora,
  position = { x = -22000.5, y = -15000, z = 600 },
  orientation = { z = 1.5 },
  data = playerData,
}
__player = player
local dialogue = {
  id = 'codex_fixture_q', type = 4, journalIndex = 10,
  getJournalInfo = function(self) return { text = 'Fixture journal text', isQuestFinished = false } end,
  loadQuestName = function(self) return 'Fixture Quest' end,
}
local api = {
  dialogueType = { journal = 4 },
  menuMode = function() return __menu end,
  getAttributeName = function(i) return ATTR[i + 1] end,
  getSkillName = function(i) return 'Skill' .. tostring(i) end,
  getPlayerGold = function() return 123 end,
  getMagicEffectName = function(p) return 'Effect ' .. tostring(p.effect) end,
  player = player,
  mobilePlayer = {
    health = stat(50, 40), magicka = stat(80), fatigue = stat(200, 150),
    attributes = attributes, skills = skills, birthsign = { name = 'Fixture Sign' },
    currentSpell = { name = 'Fixture Spark' },
    getActiveMagicEffects = function(self) return { { effectId = 7, attributeId = -1, skillId = -1 } } end,
  },
  worldController = { year = { value = 427 }, month = { value = 7 }, day = { value = 16 }, hour = { value = 13.5 }, daysPassed = { value = 9 } },
  dataHandler = { nonDynamicData = { dialogues = { dialogue, { id = 'some topic', type = 0 } } } },
}
-- Any tes3 API the bridge touches that is not mocked above fails the test.
tes3 = setmetatable(api, { __index = function(_, k) error('unexpected tes3 API: ' .. tostring(k)) end })
`;

test("MWSE bridge: runs, writes only codex_live.json, and passes protocol validation", () => {
  const { out, run } = vm();
  run(MWSE_MOCK, "mock");
  run(readFileSync(ROOT + "bridge/mwse/codex/bridge/main.lua", "utf8"), "main.lua");
  run(`__fire('initialized')
       __fire('loaded', { filename = 'Fixture save', newGame = false })
       __tick(1)
       __player.cell = __cells.tower
       __fire('cellChanged', { cell = __cells.tower, previousCell = __cells.balmora })
       __fire('journal', { topic = { id = 'codex_fixture_q', loadQuestName = function() return 'Fixture Quest' end }, index = 20, info = { text = 'Second entry', isQuestFinished = false }, new = false })
       __fire('levelUp', { level = 4 })
       __fire('skillRaised', { skill = 8, level = 26 })
       __fire('equipped', { reference = __player })
       __fire('menuExit')
       __menu = true
       __tick(2)
       __fire('saved', { filename = 'Fixture save 2' })
       __player.cell = __cells.quasi
       __fire('cellChanged', { cell = __cells.quasi, previousCell = __cells.tower })
       __tick(1)`, "script");
  assert.ok(out.length >= 8);
  assert.ok(out.every((o) => o.name === "codex_live"));
  const docs = out.map((o) => parseBridgeDocument(o.text));
  for (const d of docs) assert.ok(d.ok, d.ok ? "" : d.error);
  const last = docs[docs.length - 1];
  assert.ok(last.ok);
  if (!last.ok) return;
  const m = last.msg;
  assert.equal(m.engine, "mwse");
  assert.ok(m.caps!.includes("journal"));
  const kinds = m.events.map((e) => e.event.kind);
  for (const k of ["hello", "loaded", "quests", "cell", "journal", "levelUp", "skillRaised", "saved"]) assert.ok(kinds.includes(k as never), k);
  const quests = m.events.find((e) => e.event.kind === "quests")!.event;
  assert.ok(quests.kind === "quests" && quests.list[0].questName === "Fixture Quest" && quests.list.length === 1);
  // A "behaves like exterior" interior is reported as an interior with no grid.
  assert.equal(m.state!.cell!.exterior, false);
  assert.equal(m.state!.cell!.gx, undefined);
  const firstState = docs.find((d) => d.ok && d.msg.state?.pos)!;
  assert.ok(firstState.ok);
  if (!firstState.ok) return;
  const st = firstState.msg.state!;
  assert.equal(st.time!.month, 8, "months are converted to 1-based");
  assert.equal(st.character!.name, "Fixture Hero");
  assert.equal(st.character!.attributes!.strength.base, 41);
  assert.equal(Object.keys(st.character!.skills!).length, 27);
  assert.deepEqual([...st.character!.equipped!].sort(), ["Fixture Robe", "Fixture Saber"]);
  assert.equal(st.character!.inventory!.length, 2);
  // The whole stream feeds the tracker without errors.
  const t = newTracker();
  docs.forEach((d, i) => d.ok && ingest(t, d.msg, i * 1500));
  assert.ok(t.caps.length > 5);
});

test("MWSE bridge: event ring buffer stays bounded", () => {
  const { out, run } = vm();
  run(MWSE_MOCK, "mock");
  run(readFileSync(ROOT + "bridge/mwse/codex/bridge/main.lua", "utf8"), "main.lua");
  run(`__fire('loaded', { filename = 's' })
       for i = 1, 300 do __fire('levelUp', { level = i }) end`, "flood");
  const last = parseBridgeDocument(out[out.length - 1].text);
  assert.ok(last.ok && last.msg.events.length <= 120);
});

const OPENMW_MOCK = `
${JSON_ENCODER}
print = __print
__rt = 0
__level = 3
local stat = function(b, m) return { base = b, modified = m or b } end
local any = function(make) return setmetatable({}, { __index = function(_, k) return make(k) end }) end
__self = {
  cell = { name = 'Fixture Town', isExterior = true, gridX = -3, gridY = -2, region = 'fixture region' },
  position = { x = -22000, y = -15000, z = 600 },
  rotation = { getYaw = function(self) return 1.25 end },
}
__quests = { codex_fixture_q = { id = 'codex_fixture_q', stage = 10, started = true, finished = false } }
__entries = { { questId = 'codex_fixture_q', text = 'Fixture first entry' } }
local item = function(name, count) return { type = { record = function(o) return { name = name } end }, count = count } end
local types = {
  NPC = {
    record = function(o) return { name = 'Fixture Hero', race = 'fr', class = 'fc' } end,
    races = { record = function(id) return { name = 'Fixture Race' } end },
    classes = { record = function(id) return { name = 'Fixture Class' } end },
    stats = { skills = any(function(k) return function(o) return stat(30, 31) end end) },
  },
  Actor = {
    stats = {
      level = function(o) return { current = __level } end,
      dynamic = any(function(k) return function(o) return { base = 50, current = 45 } end end),
      attributes = any(function(k) return function(o) return stat(40, 42) end end),
    },
    inventory = function(o) return {
      countOf = function(self, id) assert(id == 'gold_001'); return 77 end,
      getAll = function(self) return { item('Gold', 77), item('Fixture Potion', 2) } end,
    } end,
    getEquipment = function(o) return { [1] = item('Fixture Robe', 1) } end,
    getSelectedSpell = function(o) return { name = 'Fixture Spark' } end,
    activeEffects = function(o) return { { name = 'Fixture Glow' } } end,
  },
  Player = {
    quests = function(o) return __quests end,
    journal = function(o) return { journalTextEntries = __entries } end,
    getBirthSign = function(o) return 'fs' end,
    birthSigns = { record = function(id) return { name = 'Fixture Sign' } end },
  },
}
local core = {
  API_REVISION = 80,
  getRealTime = function() return __rt end,
  regions = { records = any(function(k) return { name = 'Fixture Region' } end) },
  dialogue = { journal = { records = any(function(k) return { questName = 'Fixture Quest' } end) } },
}
package.preload['openmw.self'] = function() return __self end
package.preload['openmw.types'] = function() return types end
package.preload['openmw.core'] = function() return core end
package.preload['openmw_aux.calendar'] = function() return { formatGameTime = function(f) assert(f == '*t'); return { year = 427, month = 8, day = 16, hour = 13, min = 30 } end } end
`;

test("OpenMW bridge: prints valid prefixed lines; no onSave handler touches saves", () => {
  const { lines, run } = vm();
  run(OPENMW_MOCK, "mock");
  run(`__script = (function() ${readFileSync(ROOT + "bridge/openmw/scripts/codex_bridge/player.lua", "utf8")} end)()`, "player.lua");
  run(`local h = __script.engineHandlers
       assert(h.onSave == nil, 'the bridge must not store data in saves')
       h.onInit()
       h.onUpdate(0.016)            -- hello, loaded, character, quests
       h.onUpdate(1.6)              -- regular state line
       h.onQuestUpdate('codex_fixture_q', 20)
       __entries[#__entries + 1] = { questId = 'codex_fixture_q', text = 'Fixture second entry' }
       h.onUpdate(0.1)              -- journal event (read one update later)
       __rt = 10
       h.onUpdate(0)                -- paused: heartbeat with menu = true
       __self.cell = { name = 'Fixture Town, Tower', isExterior = false }
       h.onUpdate(0.1)              -- cell event
       h.onTeleported()
       __level = 4
       h.onUpdate(10.5)             -- character refresh notices the level up
       __self.cell = nil
       h.onUpdate(0.1)              -- loading: nothing printed`, "script");
  const bridgeLines = lines.filter((l) => l.includes("CODEXBRIDGE1 "));
  assert.equal(bridgeLines.length, lines.length, "every print is a bridge line");
  const { messages, errors } = parseBridgeLines(bridgeLines);
  assert.equal(errors, 0);
  assert.ok(messages.length >= 6);
  const events = messages.flatMap((m) => m.events.map((e) => e.event));
  const kinds = events.map((e) => e.kind);
  for (const k of ["hello", "loaded", "quests", "journal", "cell", "teleport", "levelUp"]) assert.ok(kinds.includes(k as never), k);
  const journal = events.find((e) => e.kind === "journal")!;
  assert.ok(journal.kind === "journal" && journal.text === "Fixture second entry" && journal.index === 20 && journal.questName === "Fixture Quest");
  const paused = messages.find((m) => m.state?.menu === true);
  assert.ok(paused, "heartbeat while paused");
  const st = messages.find((m) => m.state?.character)!.state!;
  assert.equal(st.character!.gold, 77);
  assert.equal(st.character!.skills!["Long Blade"].current, 31);
  assert.equal(st.time!.hour, 13.5);
  assert.equal(st.cell!.region, "Fixture Region");
  assert.ok(messages[0].caps!.includes("journal"));
  // Event sequence numbers increase across lines.
  const seqs = messages.flatMap((m) => m.events.map((e) => e.seq));
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  const t = newTracker();
  messages.forEach((m, i) => ingest(t, m, i * 1500));
  assert.equal(t.engine, "openmw");
});

test("OpenMW bridge: an older engine without the journal API reports fewer capabilities", () => {
  const { lines, run } = vm();
  run(OPENMW_MOCK, "mock");
  run(`package.loaded['openmw.types'] = nil
       local t = require('openmw.types'); t.Player.journal = nil; t.Player.quests = nil
       package.preload['openmw.types'] = function() return t end`, "older");
  run(`__script = (function() ${readFileSync(ROOT + "bridge/openmw/scripts/codex_bridge/player.lua", "utf8")} end)()`, "player.lua");
  run(`__script.engineHandlers.onUpdate(0.016)`, "go");
  const { messages } = parseBridgeLines(lines);
  assert.ok(messages.length >= 1);
  assert.ok(!messages[0].caps!.includes("journal"));
  assert.ok(messages[0].caps!.includes("position"));
});
