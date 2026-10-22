--[[
  CODEX.EXE bridge for OpenMW (Lua, player script).

  OpenMW's Lua sandbox cannot write files or open sockets, so this script
  prints one JSON line per update to openmw.log, prefixed with
  "CODEXBRIDGE1 ". CODEX.EXE reads new lines from the end of that log.

  What it never does:
    - It never changes the game world, your character or quests.
    - It defines no onSave handler, so it stores nothing in your saves.

  Uninstall: remove "content=codex_bridge.omwscripts" (and the matching
  data= line) from openmw.cfg, or untick it in the launcher. Saves are fine.

  Every API call is wrapped in pcall, so older OpenMW versions simply report
  fewer capabilities instead of failing. Protocol: docs/BRIDGE.md (v1).
]]

local self = require('openmw.self')
local types = require('openmw.types')
local core = require('openmw.core')
local okCalendar, calendar = pcall(require, 'openmw_aux.calendar')

local PREFIX = 'CODEXBRIDGE1 '
local SAMPLE_SECONDS = 1.5      -- simulation seconds between state lines
local HEARTBEAT_SECONDS = 5     -- real seconds between lines while paused
local CHARACTER_SECONDS = 10    -- simulation seconds between character refreshes
local INVENTORY_SECONDS = 60
local MAX_INVENTORY = 300
local QUEST_CHUNK = 25

local function safe(fn, ...)
  local ok, result = pcall(fn, ...)
  if ok then return result end
  return nil
end

local apiRevision = safe(function() return core.API_REVISION end)
local hasQuests = safe(function() return types.Player.quests ~= nil end) or false
local hasJournal = safe(function() return types.Player.journal ~= nil end) or false

local CAPS = { 'cell', 'position', 'time', 'character', 'stats', 'equipment', 'spell', 'effects', 'inventory', 'events' }
if hasQuests then
  CAPS[#CAPS + 1] = 'journal'
  CAPS[#CAPS + 1] = 'quests'
end

local session = string.format('omw%x%06x', os.time(), math.random(0, 0xFFFFFF))
local seq = 0
local eventSeq = 0

-- ------------------------------------------------------------------ JSON

local ARRAY = {}
local function array(t)
  return setmetatable(t or {}, ARRAY)
end

local function escapeString(s)
  return (string.gsub(s, '[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    if c == '\n' then return '\\n' end
    if c == '\r' then return '\\r' end
    if c == '\t' then return '\\t' end
    return string.format('\\u%04x', string.byte(c))
  end))
end

local encode
local function encodeNumber(n)
  if n ~= n or n == math.huge or n == -math.huge then return 'null' end
  if math.floor(n) == n and n > -9007199254740992 and n < 9007199254740992 then
    return string.format('%d', n)
  end
  return string.format('%.4f', n)
end

encode = function(v)
  local t = type(v)
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return v and 'true' or 'false' end
  if t == 'number' then return encodeNumber(v) end
  if t == 'string' then return '"' .. escapeString(v) .. '"' end
  if t == 'table' then
    local parts = {}
    if getmetatable(v) == ARRAY or v[1] ~= nil then
      for i = 1, #v do parts[#parts + 1] = encode(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    local keys = {}
    for k, _ in pairs(v) do
      if type(k) == 'string' then keys[#keys + 1] = k end
    end
    table.sort(keys)
    for _, k in ipairs(keys) do
      parts[#parts + 1] = '"' .. escapeString(k) .. '":' .. encode(v[k])
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end

-- ------------------------------------------------------------- game data

local ATTRIBUTES = { 'strength', 'intelligence', 'willpower', 'agility', 'speed', 'endurance', 'personality', 'luck' }
local SKILLS = {
  { 'block', 'Block' }, { 'armorer', 'Armorer' }, { 'mediumarmor', 'Medium Armor' }, { 'heavyarmor', 'Heavy Armor' },
  { 'bluntweapon', 'Blunt Weapon' }, { 'longblade', 'Long Blade' }, { 'axe', 'Axe' }, { 'spear', 'Spear' },
  { 'athletics', 'Athletics' }, { 'enchant', 'Enchant' }, { 'destruction', 'Destruction' }, { 'alteration', 'Alteration' },
  { 'illusion', 'Illusion' }, { 'conjuration', 'Conjuration' }, { 'mysticism', 'Mysticism' }, { 'restoration', 'Restoration' },
  { 'alchemy', 'Alchemy' }, { 'unarmored', 'Unarmored' }, { 'security', 'Security' }, { 'sneak', 'Sneak' },
  { 'acrobatics', 'Acrobatics' }, { 'lightarmor', 'Light Armor' }, { 'shortblade', 'Short Blade' }, { 'marksman', 'Marksman' },
  { 'mercantile', 'Mercantile' }, { 'speechcraft', 'Speechcraft' }, { 'handtohand', 'Hand-to-hand' },
}

local function cellInfo(cell)
  if not cell then return nil end
  local info = { name = cell.name or '', exterior = cell.isExterior and true or false }
  if info.exterior then
    info.gx = cell.gridX
    info.gy = cell.gridY
  end
  if cell.region then
    info.region = safe(function() return core.regions.records[cell.region].name end)
  end
  return info
end

local function cellKey(info)
  if not info then return nil end
  if info.exterior then return 'ext:' .. tostring(info.gx) .. ',' .. tostring(info.gy) end
  return 'int:' .. string.lower(info.name)
end

local function objectName(obj)
  return safe(function() return obj.type.record(obj).name end)
end

local function stat(fn)
  return safe(function()
    local s = fn(self)
    return { base = s.base, current = s.modified or s.current }
  end)
end

local function readCharacter()
  local rec = safe(function() return types.NPC.record(self) end)
  if not rec then return nil end
  local c = { name = rec.name }
  c.level = safe(function() return types.Actor.stats.level(self).current end)
  c.race = safe(function() return types.NPC.races.record(rec.race).name end)
  c['class'] = safe(function() return types.NPC.classes.record(rec.class).name end)
  c.birthsign = safe(function() return types.Player.birthSigns.record(types.Player.getBirthSign(self)).name end)
  c.health = stat(types.Actor.stats.dynamic.health)
  c.magicka = stat(types.Actor.stats.dynamic.magicka)
  c.fatigue = stat(types.Actor.stats.dynamic.fatigue)
  c.gold = safe(function() return types.Actor.inventory(self):countOf('gold_001') end)

  local attributes = {}
  for _, id in ipairs(ATTRIBUTES) do
    attributes[id] = stat(types.Actor.stats.attributes[id])
  end
  c.attributes = attributes

  local skills = {}
  for _, pair in ipairs(SKILLS) do
    skills[pair[2]] = stat(types.NPC.stats.skills[pair[1]])
  end
  c.skills = skills

  local equipped = array()
  safe(function()
    for _, obj in pairs(types.Actor.getEquipment(self)) do
      local name = objectName(obj)
      if name then equipped[#equipped + 1] = name end
    end
  end)
  c.equipped = equipped

  local spell = safe(function() return types.Actor.getSelectedSpell(self) end)
  c.spell = spell and spell.name or nil

  local effects = array()
  safe(function()
    for _, e in pairs(types.Actor.activeEffects(self)) do
      if e.name and #effects < 60 then effects[#effects + 1] = e.name end
    end
  end)
  c.effects = effects
  return c
end

local function readInventory()
  local list = array()
  safe(function()
    for _, obj in ipairs(types.Actor.inventory(self):getAll()) do
      if #list >= MAX_INVENTORY then break end
      local name = objectName(obj)
      if name then list[#list + 1] = { name = name, count = obj.count } end
    end
  end)
  return list
end

local function readTime()
  if not okCalendar then return nil end
  return safe(function()
    local t = calendar.formatGameTime('*t')
    return { year = t.year, month = t.month, day = t.day, hour = t.hour + t.min / 60 }
  end)
end

-- Latest journal text per quest id (lower case), from the player's journal.
local function journalTexts()
  local byQuest = {}
  if not hasJournal then return byQuest end
  safe(function()
    local entries = types.Player.journal(self).journalTextEntries
    for i = 1, #entries do
      local e = entries[i]
      if e.questId then byQuest[string.lower(e.questId)] = e.text end
    end
  end)
  return byQuest
end

local function questName(id)
  return safe(function() return core.dialogue.journal.records[id].questName end)
end

-- --------------------------------------------------------------- output

local character = nil
local inventory = nil

local function emit(state, events)
  seq = seq + 1
  local doc = {
    protocol = 'codex-bridge',
    v = 1,
    engine = 'openmw',
    session = session,
    seq = seq,
    caps = array(CAPS),
    apiRevision = apiRevision,
    engineVersion = apiRevision and ('OpenMW Lua API r' .. tostring(apiRevision)) or 'OpenMW',
    state = state,
    events = events and array(events) or nil,
  }
  print(PREFIX .. encode(doc))
end

local function nextEvent(ev)
  eventSeq = eventSeq + 1
  ev.seq = eventSeq
  return ev
end

local function currentState(menu)
  local state = { menu = menu }
  local info = cellInfo(self.cell)
  state.cell = info
  local p = self.position
  state.pos = { x = p.x, y = p.y, z = p.z, yaw = safe(function() return self.rotation:getYaw() end) }
  state.time = readTime()
  if character then
    local c = {}
    for k, v in pairs(character) do c[k] = v end
    c.inventory = inventory
    state.character = c
  end
  return state
end

-- ---------------------------------------------------------------- state

local sampleAcc = 0
local characterAcc = 0
local inventoryAcc = 0
local lastBeat = 0
local lastCell = nil
local needLoadEvents = true
local pendingQuests = {}

local function refreshCharacter(events)
  local fresh = safe(readCharacter)
  if not fresh then return end
  if character and events then
    if fresh.level and character.level and fresh.level > character.level then
      events[#events + 1] = nextEvent({ kind = 'levelUp', level = fresh.level })
    end
    for _, pair in ipairs(SKILLS) do
      local before = character.skills and character.skills[pair[2]]
      local after = fresh.skills and fresh.skills[pair[2]]
      if before and after and after.base > before.base then
        events[#events + 1] = nextEvent({ kind = 'skillRaised', skill = pair[2], level = after.base })
      end
    end
  end
  character = fresh
end

local function sendLoadEvents()
  local events = { nextEvent({ kind = 'hello', caps = array(CAPS), apiRevision = apiRevision }), nextEvent({ kind = 'loaded' }) }
  refreshCharacter(nil)
  inventory = readInventory()
  emit(currentState(false), events)
  if not hasQuests then return end
  local texts = journalTexts()
  local chunk = {}
  safe(function()
    for id, q in pairs(types.Player.quests(self)) do
      if q.started or (q.stage or 0) > 0 then
        local qid = q.id or id
        chunk[#chunk + 1] = {
          questId = qid,
          questName = questName(qid),
          index = q.stage or 0,
          finished = q.finished and true or false,
          text = texts[string.lower(qid)],
        }
        if #chunk >= QUEST_CHUNK then
          emit(nil, { nextEvent({ kind = 'quests', list = array(chunk) }) })
          chunk = {}
        end
      end
    end
  end)
  if #chunk > 0 then emit(nil, { nextEvent({ kind = 'quests', list = array(chunk) }) }) end
end

local function processPendingQuests(events)
  local texts = nil
  for qid, stage in pairs(pendingQuests) do
    texts = texts or journalTexts()
    local finished = safe(function() return types.Player.quests(self)[qid].finished end)
    events[#events + 1] = nextEvent({
      kind = 'journal',
      questId = qid,
      questName = questName(qid),
      index = stage,
      text = texts[string.lower(qid)],
      finished = finished and true or false,
    })
  end
  pendingQuests = {}
end

local function onUpdate(dt)
  if not self.cell then return end -- loading
  if needLoadEvents then
    needLoadEvents = false
    lastCell = cellKey(cellInfo(self.cell))
    sendLoadEvents()
    return
  end

  local events = {}
  if next(pendingQuests) ~= nil then processPendingQuests(events) end

  local info = cellInfo(self.cell)
  local key = cellKey(info)
  if key ~= lastCell then
    lastCell = key
    events[#events + 1] = nextEvent({ kind = 'cell', cell = info })
    refreshCharacter(events)
  end

  if dt > 0 then
    sampleAcc = sampleAcc + dt
    characterAcc = characterAcc + dt
    inventoryAcc = inventoryAcc + dt
    if characterAcc >= CHARACTER_SECONDS then
      characterAcc = 0
      refreshCharacter(events)
    end
    if inventoryAcc >= INVENTORY_SECONDS then
      inventoryAcc = 0
      inventory = readInventory()
    end
    if sampleAcc >= SAMPLE_SECONDS or #events > 0 then
      sampleAcc = 0
      emit(currentState(false), #events > 0 and events or nil)
    end
  else
    local now = core.getRealTime()
    if now - lastBeat >= HEARTBEAT_SECONDS or #events > 0 then
      lastBeat = now
      emit(currentState(true), #events > 0 and events or nil)
    end
  end
end

return {
  engineHandlers = {
    onInit = function() needLoadEvents = true end,
    onLoad = function() needLoadEvents = true end,
    onUpdate = onUpdate,
    onTeleported = function()
      emit(nil, { nextEvent({ kind = 'teleport' }) })
    end,
    onQuestUpdate = function(questId, stage)
      -- The journal text is read on the next update, after the engine has added it.
      pendingQuests[questId] = stage
    end,
  },
}
