const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { decodeShareCode } = require('../src/pob-code');

const root = path.resolve(__dirname, '..');
const pobRoot = process.env.POB2_PATH || path.join(root, 'pob');
const pobSrc = path.join(pobRoot, 'src');
const pobRuntimeLua = path.join(pobRoot, 'runtime', 'lua');
const bridgeScript = path.join(root, 'pob-bridge', 'OverlayWrapper.lua');
const luaJit = process.env.LUAJIT || path.join(root, '.tools', 'luajit', 'luajit.exe');
const fixturePath = path.join(root, 'test-fixtures', 'test-build.txt');

function fail(message) { console.error(`SMOKE TEST FAILED: ${message}`); process.exitCode = 1; }

for (const required of [path.join(pobSrc, 'HeadlessWrapper.lua'), path.join(pobRuntimeLua, 'dkjson.lua'), bridgeScript, luaJit, fixturePath]) {
  if (!fs.existsSync(required)) fail(`Missing ${required}`);
}
if (process.exitCode) process.exit();

const shareCode = fs.readFileSync(fixturePath, 'utf8').trim();
if (!shareCode) { fail(`PoB2 share-code fixture is empty: ${fixturePath}`); process.exit(); }

let xml;
try { xml = decodeShareCode(shareCode); console.log(`SHARE CODE DECODE PASSED: ${xml.length} bytes of XML`); }
catch (error) { fail(error.message); process.exit(); }

const env = { ...process.env };
env.LUA_PATH = [path.join(pobRuntimeLua, '?.lua'), path.join(pobRuntimeLua, '?', 'init.lua'), path.join(pobSrc, '?.lua'), path.join(pobSrc, '?', 'init.lua'), env.LUA_PATH || ''].filter(Boolean).join(';');
env.LUA_CPATH = [path.join(pobRoot, 'runtime', '?.dll'), env.LUA_CPATH || ''].filter(Boolean).join(';');

const child = spawn(luaJit, [bridgeScript], { cwd: pobSrc, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = '';
let responseReceived = false;
let nextId = 1;
let phase = 'startup';
const pending = new Map();
const timeout = setTimeout(() => { if (!responseReceived) { child.kill(); fail(`Bridge did not answer within 30 seconds during ${phase}. Check [PoB stderr] above for the last startup message.`); } }, 30000);

function send(method, params = {}) { const id = nextId++; pending.set(id, method); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); return id; }

function validateStats(stats, label) {
  const requiredStats = ['effectiveHitPool', 'effectiveMaxHit'];
  const missing = requiredStats.filter((key) => typeof stats?.[key] !== 'number');
  if (missing.length) { fail(`${label} returned missing/non-numeric stats: ${missing.join(', ')}. Result: ${JSON.stringify(stats)}`); return false; }
  return true;
}

function validateSkills(skills, label) {
  if (!Array.isArray(skills)) { fail(`${label} returned no skill list: ${JSON.stringify(skills)}`); return false; }
  const damaging = skills.filter((skill) => typeof skill?.combinedDPS === 'number' || typeof skill?.hitDPS === 'number');
  if (!damaging.length) { fail(`${label} returned no calculated damaging skills: ${JSON.stringify(skills)}`); return false; }
  return true;
}

send('getStatus');

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let response;
    try { response = JSON.parse(trimmed); } catch { process.stdout.write(`[PoB stdout] ${trimmed}\n`); continue; }
    const method = pending.get(response.id);
    if (!method) continue;
    pending.delete(response.id);
    if (!response.ok) { clearTimeout(timeout); child.kill(); fail(`${method} failed: ${response.error || 'unknown error'}`); return; }

    if (method === 'getStatus') {
      if (response.result?.status !== 'ready') { clearTimeout(timeout); child.kill(); fail(`Unexpected status: ${JSON.stringify(response.result)}`); return; }
      console.log(`PoB2 READY: ${response.result.pobVersion}`); phase = 'build import'; send('loadBuild', { xml, name: 'Smoke Test Build' }); return;
    }
    if (method === 'loadBuild') {
      if (!validateStats(response.result?.stats, 'Build import') || !validateSkills(response.result?.skills, 'Build import')) { clearTimeout(timeout); child.kill(); return; }
      console.log(`BUILD IMPORT PASSED: ${JSON.stringify({ stats: response.result.stats, skills: response.result.skills.length })}`); phase = 'post-import calculation'; send('getStats'); return;
    }
    if (method === 'getStats') {
      if (!validateStats(response.result?.stats, 'Post-import calculation') || !validateSkills(response.result?.skills, 'Post-import calculation')) { clearTimeout(timeout); child.kill(); return; }
      console.log(`POST-IMPORT CALCULATION PASSED: ${JSON.stringify({ stats: response.result.stats, skills: response.result.skills.length })}`);
      phase = 'item comparison';
      send('compareItem', { itemText: 'New Item\nGold Ring\n+10 to maximum Life' });
      return;
    }
    if (method === 'compareItem') {
      const result = response.result;
      if (!result?.itemName || !result?.slot || !validateStats(result.base?.stats, 'Item comparison base') || !validateStats(result.changed?.stats, 'Item comparison changed')) { clearTimeout(timeout); child.kill(); return; }
      if (typeof result.delta?.effectiveHitPool !== 'number' || typeof result.delta?.effectiveMaxHit !== 'number' || !Array.isArray(result.delta?.skills)) { clearTimeout(timeout); child.kill(); fail(`Item comparison returned invalid deltas: ${JSON.stringify(result)}`); return; }
      console.log(`ITEM COMPARISON PASSED: ${result.itemName} in ${result.slot}; defenseDelta=${JSON.stringify({ effectiveHitPool: result.delta.effectiveHitPool, effectiveMaxHit: result.delta.effectiveMaxHit })}; skillDeltas=${result.delta.skills.length}`);
      responseReceived = true;
      clearTimeout(timeout);
      console.log('SMOKE TEST PASSED: PoB2 startup + share-code decode + build import + skill DPS + effective defenses + item comparison are working.');
      child.kill();
    }
  }
});

child.stderr.on('data', (chunk) => process.stderr.write(`[PoB stderr] ${chunk}`));
child.on('error', (error) => { if (!responseReceived) { clearTimeout(timeout); fail(`Could not start LuaJIT: ${error.message}`); } });
child.on('exit', (code, signal) => { if (!responseReceived) { clearTimeout(timeout); fail(`Bridge exited before completing smoke test (code=${code}, signal=${signal || 'none'})`); } });
