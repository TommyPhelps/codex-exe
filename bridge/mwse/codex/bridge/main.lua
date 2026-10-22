--[[
  CODEX.EXE bridge for MWSE-Lua (original Morrowind engine).

  What it does:
    Writes a small JSON status file, Data Files\MWSE\codex_live.json, that
    CODEX.EXE reads to show your location, journal updates and character
    sheet on a second monitor.

  What it never does:
    - It does not change the game, your character, or any save file.
      (It stores nothing in tes3.player.data and registers no persistent timers.)
    - It does not open network connections or run code from elsewhere.

  Uninstall: delete Data Files\MWSE\mods\codex\bridge and
  Data Files\MWSE\codex_live.json. Your saves are unaffected.

  Protocol: see docs/BRIDGE.md in the CODEX.EXE repository (version 1).
]]

local PROTOCOL = "codex-bridge"
local VERSION = 1
local FILE = "codex_live"      -- json.savefile adds Data Files\MWSE\ and .json
local MAX_EVENTS = 120         -- ring buffer kept in the file
local SAMPLE_SECONDS = 1.5     -- simulation seconds between position samples
local HEARTBEAT_SECONDS = 5    -- real seconds between heartbeats (menus/pause)
local MAX_INVENTORY = 300
local MAX_QUESTS = 400

local JOURNAL_TYPE = (tes3.dialogueType and tes3.dialogueType.journal) or 4

math.randomseed(os.time() + math.floor((os.clock() * 1000) % 100000))
local session = string.format("mw%x%06x", os.time(), math.random(0, 0xFFFFFF))
local seq = 0
local eventSeq = 0
local events = {}
local character = nil      -- cached character block, refreshed on events
local inventory = nil      -- cached inventory, refreshed on menu exit / load
local inGame = false
local CAPS = { "cell", "position", "time", "journal", "quests", "character", "stats", "equipment", "spell", "effects", "inventory", "events" }

local function safe(fn, ...)
  local ok, result = pcall(fn, ...)
  if ok then return result end
  return nil
end

local function pushEvent(ev)
  eventSeq = eventSeq + 1
  ev.seq = eventSeq
  events[#events + 1] = ev
  while #events > MAX_EVENTS do
    table.remove(events, 1)
  end
end

local function cellInfo(cell)
  if not cell then return nil end
  -- Interiors that "behave as exteriors" (e.g. Mournhold) do not use world
  -- map coordinates, so they are reported as interiors.
  local exterior = not cell.isInterior
  local info = { name = cell.name or "", exterior = exterior }
  if exterior then
    info.gx = cell.gridX
    info.gy = cell.gridY
  end
  local region = safe(function() return cell.region and cell.region.name end)
  if region then info.region = region end
  return info
end

local function statOf(s)
  if not s then return nil end
  return { base = s.base, current = s.current }
end

local function readCharacter()
  local mp = tes3.mobilePlayer
  local ref = tes3.player
  if not mp or not ref then return nil end
  local npc = ref.object
  local c = { name = npc.name }
  c.level = safe(function() return npc.level end)
  c.race = safe(function() return npc.race and npc.race.name end)
  c["class"] = safe(function() return npc.class and npc.class.name end)
  c.birthsign = safe(function() return mp.birthsign and mp.birthsign.name end)
  c.health = statOf(mp.health)
  c.magicka = statOf(mp.magicka)
  c.fatigue = statOf(mp.fatigue)
  c.gold = safe(tes3.getPlayerGold)

  local attributes = {}
  for i, s in ipairs(mp.attributes or {}) do
    local name = safe(tes3.getAttributeName, i - 1)
    if name then attributes[name] = statOf(s) end
  end
  c.attributes = attributes

  local skills = {}
  for i, s in ipairs(mp.skills or {}) do
    local name = safe(tes3.getSkillName, i - 1)
    if name then skills[name] = statOf(s) end
  end
  c.skills = skills

  local equipped = {}
  safe(function()
    for _, stack in pairs(npc.equipment) do
      if stack.object and stack.object.name then
        equipped[#equipped + 1] = stack.object.name
      end
    end
  end)
  c.equipped = equipped

  c.spell = safe(function() return mp.currentSpell and mp.currentSpell.name end)

  local effects = {}
  safe(function()
    for _, e in ipairs(mp:getActiveMagicEffects()) do
      local name = tes3.getMagicEffectName({ effect = e.effectId, attribute = e.attributeId, skill = e.skillId })
      if name and #effects < 60 then effects[#effects + 1] = name end
    end
  end)
  c.effects = effects
  return c
end

local function readInventory()
  local ref = tes3.player
  if not ref then return nil end
  local list = {}
  safe(function()
    for _, stack in pairs(ref.object.inventory) do
      if #list >= MAX_INVENTORY then break end
      if stack.object and stack.object.name then
        list[#list + 1] = { name = stack.object.name, count = stack.count }
      end
    end
  end)
  return list
end

local function readTime()
  local wc = tes3.worldController
  if not wc then return nil end
  return safe(function()
    return {
      year = wc.year.value,
      month = wc.month.value + 1, -- the game stores months 0-based
      day = wc.day.value,
      hour = wc.hour.value,
      daysPassed = wc.daysPassed.value,
    }
  end)
end

local function currentState()
  local state = { menu = tes3.menuMode() }
  if not inGame or not tes3.player then
    state.menu = true
    return state
  end
  state.cell = cellInfo(tes3.player.cell)
  local p = tes3.player.position
  local yaw = safe(function() return tes3.player.orientation.z end)
  state.pos = { x = p.x, y = p.y, z = p.z, yaw = yaw }
  state.time = readTime()
  if character then
    local c = {}
    for k, v in pairs(character) do c[k] = v end
    c.inventory = inventory
    state.character = c
  end
  return state
end

local function write()
  seq = seq + 1
  local doc = {
    protocol = PROTOCOL,
    v = VERSION,
    engine = "mwse",
    session = session,
    seq = seq,
    caps = CAPS,
    engineVersion = "MWSE " .. tostring(mwse.buildNumber or "?"),
    state = currentState(),
    events = events,
  }
  local ok, err = pcall(json.savefile, FILE, doc)
  if not ok then
    mwse.log("[CODEX bridge] could not write status file: %s", tostring(err))
  end
end

local function refreshCharacter()
  character = safe(readCharacter) or character
end

local function questSnapshot()
  local list = {}
  safe(function()
    for _, d in ipairs(tes3.dataHandler.nonDynamicData.dialogues) do
      if #list >= MAX_QUESTS then break end
      if d.type == JOURNAL_TYPE and (d.journalIndex or 0) > 0 then
        local info = safe(function() return d:getJournalInfo() end)
        list[#list + 1] = {
          questId = d.id,
          questName = safe(function() return d:loadQuestName() end),
          index = d.journalIndex,
          text = info and safe(function() return info.text end) or nil,
          finished = info and info.isQuestFinished or false,
        }
      end
    end
  end)
  return list
end

-- Position samples: simulation timers do not tick in menus or while paused,
-- so nothing is recorded during loading screens or pauses.
local function onSample()
  write()
end

local function onHeartbeat()
  if tes3.menuMode() then write() end
end

local function onLoaded(e)
  inGame = true
  pushEvent({ kind = "loaded", save = e.filename, newGame = e.newGame })
  refreshCharacter()
  inventory = safe(readInventory)
  pushEvent({ kind = "quests", list = questSnapshot() })
  -- Timers are cancelled whenever a save loads, so start them here.
  timer.start({ type = timer.simulate, duration = SAMPLE_SECONDS, iterations = -1, callback = onSample, persist = false })
  timer.start({ type = timer.real, duration = HEARTBEAT_SECONDS, iterations = -1, callback = onHeartbeat, persist = false })
  write()
end

local function onCellChanged(e)
  local info = cellInfo(e.cell)
  if not info then return end
  pushEvent({ kind = "cell", cell = info, previous = cellInfo(e.previousCell) })
  write()
end

local function onJournal(e)
  local info = e.info
  pushEvent({
    kind = "journal",
    questId = e.topic and e.topic.id or "",
    questName = safe(function() return e.topic:loadQuestName() end),
    index = e.index,
    text = info and safe(function() return info.text end) or nil,
    finished = info and info.isQuestFinished or false,
    isNew = e.new,
  })
  write()
end

local function onLevelUp(e)
  refreshCharacter()
  pushEvent({ kind = "levelUp", level = e.level })
  write()
end

local function onSkillRaised(e)
  refreshCharacter()
  local name = safe(tes3.getSkillName, e.skill) or tostring(e.skill)
  pushEvent({ kind = "skillRaised", skill = name, level = e.level })
  write()
end

local function onSaved(e)
  pushEvent({ kind = "saved", save = e.filename })
  write()
end

local function onMenuExit()
  refreshCharacter()
  inventory = safe(readInventory) or inventory
end

local function onEquipChange(e)
  if e.reference == tes3.player then refreshCharacter() end
end

local function onInitialized()
  pushEvent({ kind = "hello", engineVersion = "MWSE " .. tostring(mwse.buildNumber or "?"), caps = CAPS })
  write()
end

event.register("initialized", onInitialized)
event.register("loaded", onLoaded)
event.register("cellChanged", onCellChanged)
event.register("journal", onJournal)
event.register("levelUp", onLevelUp)
event.register("skillRaised", onSkillRaised)
event.register("saved", onSaved)
event.register("menuExit", onMenuExit)
event.register("equipped", onEquipChange)
event.register("unequipped", onEquipChange)
event.register("magicSelectionChanged", refreshCharacter)

mwse.log("[CODEX bridge] loaded (protocol %d, session %s)", VERSION, session)
