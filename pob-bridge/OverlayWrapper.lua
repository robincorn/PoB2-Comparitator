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
  return { life=output.Life, mana=output.Mana, energyShield=output.EnergyShield, armour=output.Armour, evasion=output.Evasion, totalDPS=output.TotalDPS, averageDamage=output.AverageDamage }
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
    return stats()
  elseif request.method == "compareItem" then
    assert(type(request.params) == "table", "params is required")
    return compareItem(request.params.itemText)
  elseif request.method == "getStats" then
    runCallback("OnFrame")
    return stats()
  elseif request.method == "resetBuild" then
    newBuild()
    return stats()
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
