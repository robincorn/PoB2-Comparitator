-- Thin JSONL RPC bridge around PoB2's existing HeadlessWrapper.
-- This file intentionally contains no calculation logic of its own.

local nativePrint = print
local function log(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[i] = tostring(select(i, ...)) end
  io.stderr:write(table.concat(parts, "\t") .. "\n")
  io.stderr:flush()
end
print = log
package.path = "./?.lua;./?/init.lua;" .. package.path

dofile("HeadlessWrapper.lua")
local dkjson = require "dkjson"

local function response(id, ok, result, err)
  local out = { id = id, ok = ok }
  if ok then out.result = result else out.error = err end
  nativePrint(dkjson.encode(out))
  io.stdout:flush()
end

local function stats()
  local output = build.calcsTab.mainOutput or {}
  return {
    effectiveHitPool = output.TotalEHP,
    effectiveMaxHit = output.SecondMinimalMaximumHitTaken,
    totalDPS = output.TotalDPS,
    averageDamage = output.AverageDamage,
    speed = output.Speed,
  }
end

local function skillStats()
  local calcsTab = build.calcsTab
  local savedSkillNumber = calcsTab.input.skill_number
  local savedMainSocketGroup = build.mainSocketGroup
  local savedSelections = {}
  for index, group in ipairs(build.skillsTab.socketGroupList or {}) do
    savedSelections[index] = group.mainActiveSkillCalcs
  end

  local result = {}
  for groupIndex, group in ipairs(build.skillsTab.socketGroupList or {}) do
    local skillList = group.displaySkillListCalcs
    if skillList and #skillList > 0 then
      build.mainSocketGroup = groupIndex
      calcsTab.input.skill_number = groupIndex
      for skillIndex, activeSkill in ipairs(skillList) do
        local grantedEffect = activeSkill.activeEffect and activeSkill.activeEffect.grantedEffect
        if grantedEffect then
          group.mainActiveSkillCalcs = skillIndex
          build.buildFlag = true
          build.modFlag = true
          runCallback("OnFrame")
          local output = calcsTab.mainOutput or {}
          local totalDPS = output.TotalDPS or 0
          local averageDamage = output.AverageDamage or 0
          local combinedDPS = output.CombinedDPS or totalDPS
          local fullDPS = output.FullDPS or combinedDPS
          local speed = output.Speed
          local totalDot = output.TotalDot or 0
          if totalDPS ~= 0 or averageDamage ~= 0 or totalDot ~= 0 then
            table.insert(result, {
              name = grantedEffect.name or activeSkill.nameSpec or "Unknown Skill",
              group = groupIndex,
              skillIndex = skillIndex,
              fullDPS = fullDPS,
              combinedDPS = combinedDPS,
              hitDPS = totalDPS,
              averageDamage = averageDamage,
              speed = speed,
              dotDPS = totalDot,
            })
          end
        end
      end
    end
  end

  build.mainSocketGroup = savedMainSocketGroup
  calcsTab.input.skill_number = savedSkillNumber
  for index, group in ipairs(build.skillsTab.socketGroupList or {}) do
    group.mainActiveSkillCalcs = savedSelections[index]
  end
  build.buildFlag = true
  build.modFlag = true
  runCallback("OnFrame")
  return result
end

local function statDelta(base, changed)
  local out = {}
  for key, value in pairs(changed) do
    if type(value) == "number" and type(base[key]) == "number" then out[key] = value - base[key] end
  end
  return out
end

local function compareItem(itemText)
  assert(type(itemText) == "string" and #itemText > 0, "params.itemText is required")
  local savedXml = build:SaveDB("code")
  runCallback("OnFrame")
  local baseStats = stats()
  local ok, result = pcall(function()
    local item = new("Item"):Item(itemText)
    assert(item.base, "PoB2 could not parse the clipboard item")
    local slotName = item:GetPrimarySlot()
    assert(slotName and build.itemsTab.slots[slotName], "PoB2 could not determine an equipment slot for this item")
    build.itemsTab:AddItem(item)
    build.itemsTab:EquipItemInSet(item, build.itemsTab.activeItemSetId)
    build.buildFlag = true
    runCallback("OnFrame")
    local changedStats = stats()
    return { itemName=item.name or item.base.name or "Clipboard Item", slot=slotName, base=baseStats, changed=changedStats, delta=statDelta(baseStats, changedStats) }
  end)
  loadBuildFromXML(savedXml, "Restored Build")
  runCallback("OnFrame")
  if not ok then error(result) end
  return result
end

local function dispatch(request)
  if request.method == "getStatus" then
    return { status="ready", pobVersion=launch.versionNumber, branch=launch.versionBranch }
  elseif request.method == "loadBuild" then
    assert(type(request.params) == "table", "params is required")
    assert(type(request.params.xml) == "string", "params.xml is required")
    loadBuildFromXML(request.params.xml, request.params.name or "Overlay Build")
    runCallback("OnFrame")
    return { stats=stats(), skills=skillStats() }
  elseif request.method == "compareItem" then
    assert(type(request.params) == "table", "params is required")
    return compareItem(request.params.itemText)
  elseif request.method == "getStats" then
    runCallback("OnFrame")
    return { stats=stats(), skills=skillStats() }
  elseif request.method == "resetBuild" then
    newBuild()
    return { stats=stats(), skills={} }
  end
  error("Unknown method: " .. tostring(request.method))
end

if not build then response(nil, false, nil, "PoB2 headless initialization did not expose build") os.exit(1) end

while true do
  local line = io.read("*l")
  if not line then break end
  if line ~= "" then
    local id = nil
    local ok, result = pcall(function()
      local request, decodeErr = dkjson.decode(line)
      assert(request, decodeErr or "Invalid JSON request")
      id = request.id
      return dispatch(request)
    end)
    if ok then response(id, true, result) else response(id, false, nil, tostring(result)) end
  end
end
