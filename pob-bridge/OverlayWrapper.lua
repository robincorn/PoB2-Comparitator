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

local function rebuildOutput()
  build.buildFlag = true
  build.modFlag = true
  runCallback("OnFrame")
  build.calcsTab:BuildOutput()
  runCallback("OnFrame")
end

local function stats()
  local output = build.calcsTab.mainOutput or {}
  return { effectiveHitPool = output.TotalEHP, effectiveMaxHit = output.SecondMinimalMaximumHitTaken, totalDPS = output.TotalDPS, averageDamage = output.AverageDamage, speed = output.Speed }
end

local function skillStats()
  local calcsTab = build.calcsTab
  local savedSkillNumber = calcsTab.input.skill_number
  local savedMainSocketGroup = build.mainSocketGroup
  local savedSelections = {}
  local result = {}

  for index, group in ipairs(build.skillsTab.socketGroupList or {}) do
    savedSelections[index] = {
      mainActiveSkill = group.mainActiveSkill,
      mainActiveSkillCalcs = group.mainActiveSkillCalcs,
    }
  end

  -- PoB2 itself uses displaySkillList (not displaySkillListCalcs) when selecting
  -- a skill. The latter is a calculation-side representation and its indices
  -- are not the UI selection indices we need to write back to the socket group.
  for groupIndex, group in ipairs(build.skillsTab.socketGroupList or {}) do
    local skillList = group.displaySkillList or {}
    for skillIndex, activeSkill in ipairs(skillList) do
      local grantedEffect = activeSkill.activeEffect and activeSkill.activeEffect.grantedEffect
      if grantedEffect then
        build.mainSocketGroup = groupIndex
        calcsTab.input.skill_number = groupIndex
        group.mainActiveSkill = skillIndex
        group.mainActiveSkillCalcs = skillIndex
        build.buildFlag = true
        build.modFlag = true

        -- This is the same selection/update sequence used by PoB2's own tests
        -- for per-skill calculations.
        runCallback("OnFrame")
        calcsTab:BuildOutput()
        runCallback("OnFrame")

        local output = calcsTab.mainOutput or {}
        local fullDPS = output.FullDPS
        local combinedDPS = output.CombinedDPS
        local hitDPS = output.TotalDPS
        local dotDPS = output.TotalDotDPS or output.TotalDot or 0

        table.insert(result, {
          name = grantedEffect.name or activeSkill.nameSpec or "Unknown Skill",
          group = groupIndex,
          skillIndex = skillIndex,
          support = false,
          fullDPS = fullDPS or 0,
          combinedDPS = combinedDPS or 0,
          hitDPS = hitDPS or 0,
          averageDamage = output.AverageDamage or 0,
          speed = output.Speed,
          dotDPS = dotDPS
        })
      end
    end

    for _, gem in ipairs(group.gemList or {}) do
      if gem.support then
        table.insert(result, {
          name = gem.nameSpec or (gem.grantedEffect and gem.grantedEffect.name) or "Support Gem",
          group = groupIndex,
          support = true,
          fullDPS = 0,
          combinedDPS = 0,
          hitDPS = 0,
          averageDamage = 0,
          dotDPS = 0
        })
      end
    end
  end

  build.mainSocketGroup = savedMainSocketGroup
  calcsTab.input.skill_number = savedSkillNumber
  for index, group in ipairs(build.skillsTab.socketGroupList or {}) do
    local saved = savedSelections[index]
    if saved then
      group.mainActiveSkill = saved.mainActiveSkill
      group.mainActiveSkillCalcs = saved.mainActiveSkillCalcs
    end
  end
  rebuildOutput()
  return result
end

local function buildSummary()
  rebuildOutput()
  return { stats=stats(), skills=skillStats() }
end

local function skillDelta(baseSkills, changedSkills)
  local baseMap, changedMap = {}, {}
  for _, skill in ipairs(baseSkills or {}) do baseMap[skill.name] = skill end
  for _, skill in ipairs(changedSkills or {}) do changedMap[skill.name] = skill end
  local names, seen = {}, {}
  for _, skill in ipairs(baseSkills or {}) do if not seen[skill.name] then names[#names + 1] = skill.name; seen[skill.name] = true end end
  for _, skill in ipairs(changedSkills or {}) do if not seen[skill.name] then names[#names + 1] = skill.name; seen[skill.name] = true end end
  local result = {}
  for _, name in ipairs(names) do
    local base, changed = baseMap[name] or {}, changedMap[name] or {}
    local baseDPS = base.combinedDPS or base.hitDPS or 0; local changedDPS = changed.combinedDPS or changed.hitDPS or 0
    local baseHit, changedHit = base.averageDamage or 0, changed.averageDamage or 0; local baseDot, changedDot = base.dotDPS or 0, changed.dotDPS or 0
    if baseDPS ~= 0 or changedDPS ~= 0 or baseHit ~= 0 or changedHit ~= 0 or baseDot ~= 0 or changedDot ~= 0 then
      result[#result + 1] = { name=name, baseDPS=baseDPS, changedDPS=changedDPS, dpsDelta=changedDPS-baseDPS, baseAverageHit=baseHit, changedAverageHit=changedHit, averageHitDelta=changedHit-baseHit, baseDotDPS=baseDot, changedDotDPS=changedDot, dotDelta=changedDot-baseDot }
    end
  end
  return result
end

local function compareItem(itemText)
  assert(type(itemText) == "string" and #itemText > 0, "params.itemText is required")
  local savedXml = build:SaveDB("code")
  local baseSummary = buildSummary()
  local ok, result = pcall(function()
    local item = new("Item"):Item(itemText)
    assert(item.base, "PoB2 could not parse the clipboard item")
    local slotName = item:GetPrimarySlot()
    assert(slotName and build.itemsTab.slots[slotName], "PoB2 could not determine an equipment slot for this item")
    build.itemsTab:AddItem(item)
    build.itemsTab:EquipItemInSet(item, build.itemsTab.activeItemSetId)
    build.buildFlag = true; build.modFlag = true
    local changedSummary = buildSummary()
    return { itemName=item.name or item.base.name or "Clipboard Item", slot=slotName, base=baseSummary, changed=changedSummary, delta={ effectiveHitPool=(changedSummary.stats.effectiveHitPool or 0)-(baseSummary.stats.effectiveHitPool or 0), effectiveMaxHit=(changedSummary.stats.effectiveMaxHit or 0)-(baseSummary.stats.effectiveMaxHit or 0), skills=skillDelta(baseSummary.skills, changedSummary.skills) } }
  end)
  loadBuildFromXML(savedXml, "Restored Build"); rebuildOutput()
  if not ok then error(result) end
  return result
end

local function loadCharacter(character)
  assert(type(character) == "table", "params.character is required")
  assert(type(character.name) == "string" and character.name ~= "", "character.name is required")
  assert(type(character.passives) == "table", "character.passives is required")
  assert(type(character.equipment) == "table", "character.equipment is required")
  loadBuildFromJSON(character, character); rebuildOutput(); return buildSummary()
end

local function dispatch(request)
  if request.method == "getStatus" then return { status="ready", pobVersion=launch.versionNumber, branch=launch.versionBranch }
  elseif request.method == "loadBuild" then assert(type(request.params) == "table", "params is required"); assert(type(request.params.xml) == "string", "params.xml is required"); loadBuildFromXML(request.params.xml, request.params.name or "Overlay Build"); return buildSummary()
  elseif request.method == "loadCharacter" then assert(type(request.params) == "table", "params is required"); return loadCharacter(request.params.character)
  elseif request.method == "compareItem" then assert(type(request.params) == "table", "params is required"); return compareItem(request.params.itemText)
  elseif request.method == "getStats" then return buildSummary()
  elseif request.method == "resetBuild" then newBuild(); return { stats=stats(), skills={} }
  end
  error("Unknown method: " .. tostring(request.method))
end

if not build then response(nil, false, nil, "PoB2 headless initialization did not expose build"); os.exit(1) end
while true do
  local line = io.read("*l"); if not line then break end
  if line ~= "" then
    local id = nil
    local ok, result = pcall(function() local request, decodeErr = dkjson.decode(line); assert(request, decodeErr or "Invalid JSON request"); id = request.id; return dispatch(request) end)
    if ok then response(id, true, result) else response(id, false, nil, tostring(result)) end
  end
end
