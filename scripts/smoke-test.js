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

// PoB2 is started with cwd=<repo>\\pob\\src, but its Lua modules live under
// <repo>\\pob\\runtime\\lua. Use absolute paths so this stays correct on Windows.
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
let finished = false;
const timeout = setTimeout(() => {
  if (!finished) {
    child.kill();
    fail('Bridge did not answer within 15 seconds');
  }
}, 15000);

child.stderr.on('data', (chunk) => process.stderr.write(`[PoB] ${chunk}`));
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      fail(`Invalid JSON from bridge: ${line}`);
      child.kill();
      return;
    }

    if (response.id !== 1) continue;
    finished = true;
    clearTimeout(timeout);

    if (!response.ok) {
      fail(response.error || 'Bridge returned an error');
    } else if (response.result?.status !== 'ready') {
      fail(`Unexpected status: ${JSON.stringify(response.result)}`);
    } else {
      console.log(`SMOKE TEST PASSED: PoB2 ${response.result.pobVersion} (${response.result.branch})`);
    }

    child.kill();
  }
});

child.on('error', (error) => {
  if (!finished) {
    clearTimeout(timeout);
    fail(`Could not start LuaJIT: ${error.message}`);
  }
});

child.on('exit', () => {
  if (!finished && process.exitCode === undefined) {
    clearTimeout(timeout);
    fail('Bridge exited before answering');
  }
});

child.stdin.write(JSON.stringify({ id: 1, method: 'getStatus', params: {} }) + '\n');
