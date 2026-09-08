const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const pobRoot = process.env.POB2_PATH || path.join(root, 'pob');
const pobSrc = path.join(pobRoot, 'src');
const pobRuntimeLua = path.join(pobRoot, 'runtime', 'lua');
const bridgeScript = path.join(root, 'pob-bridge', 'OverlayWrapper.lua');
const luaJit = process.env.LUAJIT || path.join(root, '.tools', 'luajit', 'luajit.exe');

function fail(message) {
  console.error(`SMOKE TEST FAILED: ${message}`);
  process.exitCode = 1;
}

for (const required of [
  path.join(pobSrc, 'HeadlessWrapper.lua'),
  path.join(pobRuntimeLua, 'dkjson.lua'),
  bridgeScript,
  luaJit,
]) {
  if (!fs.existsSync(required)) fail(`Missing ${required}`);
}

if (process.exitCode) process.exit();

const env = { ...process.env };
env.LUA_PATH = [
  path.join(pobRuntimeLua, '?.lua'),
  path.join(pobRuntimeLua, '?', 'init.lua'),
  env.LUA_PATH || '',
].filter(Boolean).join(';');
env.LUA_CPATH = [
  path.join(pobRoot, 'runtime', '?.dll'),
  env.LUA_CPATH || '',
].filter(Boolean).join(';');

const child = spawn(luaJit, [bridgeScript], {
  cwd: pobSrc,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let buffer = '';
let responseReceived = false;
let nextId = 1;
let phase = 'startup';
const timeout = setTimeout(() => {
  if (!responseReceived) {
    child.kill();
    fail(`Bridge did not answer within 15 seconds during ${phase}. Check [PoB stderr] above for the last startup message.`);
  }
}, 15000);

function send(method, params = {}) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  return id;
}

const statusId = send('getStatus');

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let response;
    try {
      response = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`[PoB stdout] ${trimmed}\n`);
      continue;
    }

    if (response.id === statusId) {
      if (!response.ok) {
        clearTimeout(timeout);
        child.kill();
        fail(response.error || 'Bridge returned a status error');
        return;
      }
      if (response.result?.status !== 'ready') {
        clearTimeout(timeout);
        child.kill();
        fail(`Unexpected status: ${JSON.stringify(response.result)}`);
        return;
      }

      console.log(`PoB2 READY: ${response.result.pobVersion}`);
      phase = 'calculation';
      send('getStats');
      return;
    }

    if (response.id === statusId + 1) {
      responseReceived = true;
      clearTimeout(timeout);

      if (!response.ok) {
        child.kill();
        fail(response.error || 'PoB2 calculation returned an error');
        return;
      }

      const stats = response.result;
      const requiredStats = ['life', 'mana', 'energyShield', 'armour', 'evasion', 'totalDPS', 'averageDamage'];
      const missing = requiredStats.filter((key) => typeof stats?.[key] !== 'number');

      if (missing.length) {
        child.kill();
        fail(`PoB2 calculation returned missing/non-numeric stats: ${missing.join(', ')}. Result: ${JSON.stringify(stats)}`);
        return;
      }

      console.log(`CALCULATION PASSED: ${JSON.stringify(stats)}`);
      console.log('SMOKE TEST PASSED: PoB2 headless startup + calculation bridge are working.');
      child.kill();
    }
  }
});

child.stderr.on('data', (chunk) => process.stderr.write(`[PoB stderr] ${chunk}`));
child.on('error', (error) => {
  if (!responseReceived) {
    clearTimeout(timeout);
    fail(`Could not start LuaJIT: ${error.message}`);
  }
});
child.on('exit', (code, signal) => {
  if (!responseReceived) {
    clearTimeout(timeout);
    fail(`Bridge exited before completing smoke test (code=${code}, signal=${signal || 'none'})`);
  }
});
