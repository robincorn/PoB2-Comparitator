-- Thin JSONL RPC bridge around PoB2's existing HeadlessWrapper.
-- This file intentionally contains no calculation logic of its own.

-- PoB2's headless wrapper prints startup messages and expects to be able to
-- print to stdout. We keep stdout exclusively for JSONL transport by routing
-- all ordinary print() output to stderr before loading PoB2.
local nativePrint = print
local function log(...)
  local parts = {}
  for i = 1, select("#", ...) do
    parts[i] = tostring(select(i, ...))
  end
  io.stderr:write(table.concat(parts, "\t") .. "\n")
  io.stderr:flush()
end
print = log

-- PoB2's HeadlessWrapper owns the complete application initialization and
-- exposes `build` when that initialization returns.
dofile("HeadlessWrapper.lua")

local dkjson = require "dkjson"

local function response(id, ok, result, err)
  local out = { id = id, ok = ok }
  if ok then
    out.result = result
  else
    out.error = err
  end
  nativePrint(dkjson.encode(out))
  io.stdout:flush()
end

local function stats()
  local output = build.calcsTab.mainOutput or {}
  return {
    life = output.Life,
    mana = output.Mana,
    energyShield = output.EnergyShield,
    armour = output.Armour,
    evasion = output.Evasion,
    totalDPS = output.TotalDPS,
    averageDamage = output.AverageDamage,
  }
end

local function dispatch(request)
  if request.method == "getStatus" then
    return {
      status = "ready",
      pobVersion = launch.versionNumber,
      branch = launch.versionBranch,
    }
  elseif request.method == "loadBuild" then
    assert(type(request.params) == "table", "params is required")
    assert(type(request.params.xml) == "string", "params.xml is required")
    loadBuildFromXML(request.params.xml, request.params.name or "Overlay Build")
    return stats()
  elseif request.method == "getStats" then
    runCallback("OnFrame")
    return stats()
  elseif request.method == "resetBuild" then
    newBuild()
    return stats()
  end
  error("Unknown method: " .. tostring(request.method))
end

-- Do not enter a read loop until HeadlessWrapper has completely initialized.
-- On startup failures HeadlessWrapper may already have displayed an error and
-- returned. In that case `build` will be absent, so fail fast with a machine-
-- readable response instead of hanging until the parent timeout.
if not build then
  response(nil, false, nil, "PoB2 headless initialization did not expose build")
  os.exit(1)
end

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
    if ok then
      response(id, true, result)
    else
      response(id, false, nil, tostring(result))
    end
  end
end
