const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let bridge;
let requestId = 0;
const pending = new Map();
const BRIDGE_TIMEOUT_MS = 30000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 360,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function findLuaJit(root) {
  if (process.env.LUAJIT) return process.env.LUAJIT;
  const local = path.join(root, '.tools', 'luajit', 'luajit.exe');
  if (fs.existsSync(local)) return local;
  return process.platform === 'win32' ? 'luajit.exe' : 'luajit';
}

function startBridge() {
  const projectRoot = path.join(__dirname, '..');
  const pobRoot = process.env.POB2_PATH || path.join(projectRoot, 'pob');
  const pobSrc = path.join(pobRoot, 'src');
  const pobRuntimeLua = path.join(pobRoot, 'runtime', 'lua');
  const pobRuntime = path.join(pobRoot, 'runtime');
  const bridgeScript = path.join(projectRoot, 'pob-bridge', 'OverlayWrapper.lua');
  const luajit = findLuaJit(projectRoot);

  if (!fs.existsSync(path.join(pobSrc, 'HeadlessWrapper.lua'))) {
    return { ok: false, error: `PoB2 not found at ${pobRoot}. Run npm run setup first.` };
  }
  if (!fs.existsSync(path.join(pobRuntimeLua, 'dkjson.lua'))) {
    return { ok: false, error: `PoB2 runtime Lua directory not found at ${pobRuntimeLua}.` };
  }

  const env = {
    ...process.env,
    LUA_PATH: [
      path.join(pobRuntimeLua, '?.lua'),
      path.join(pobRuntimeLua, '?', 'init.lua'),
      path.join(pobSrc, '?.lua'),
      path.join(pobSrc, '?', 'init.lua'),
      process.env.LUA_PATH || '',
    ].filter(Boolean).join(';'),
    LUA_CPATH: [
      path.join(pobRuntime, '?.dll'),
      process.env.LUA_CPATH || '',
    ].filter(Boolean).join(';'),
  };

  bridge = spawn(luajit, [bridgeScript], {
    cwd: pobSrc,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let buffer = '';
  bridge.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        const resolve = pending.get(message.id);
        if (resolve) {
          pending.delete(message.id);
          if (resolve.timer) clearTimeout(resolve.timer);
          resolve(message);
        }
      } catch (err) {
        console.error('Invalid bridge output:', line, err);
      }
    }
  });
  bridge.stderr.on('data', (chunk) => console.error('[PoB]', chunk.toString()));
  bridge.on('error', (err) => failPending(`Could not start LuaJIT: ${err.message}`));
  bridge.on('exit', (code) => {
    failPending(`PoB bridge exited (${code})`);
    bridge = null;
    mainWindow?.webContents.send('bridge-status', { ok: false, error: `PoB bridge exited (${code})` });
  });
  return { ok: true };
}

function failPending(error) {
  for (const resolve of pending.values()) {
    if (resolve.timer) clearTimeout(resolve.timer);
    resolve({ ok: false, error });
  }
  pending.clear();
  bridge = null;
}

function callBridge(method, params = {}) {
  return new Promise((resolve) => {
    if (!bridge) return resolve({ ok: false, error: 'PoB bridge is not running' });
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: `PoB bridge timed out (${method})` });
    }, BRIDGE_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    bridge.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}

ipcMain.handle('bridge-status', async () => {
  if (!bridge) {
    const result = startBridge();
    if (!result.ok) return result;
  }
  return callBridge('getStatus');
});

ipcMain.handle('select-build', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a Path of Building XML build',
    properties: ['openFile'],
    filters: [{ name: 'Path of Building', extensions: ['xml'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };

  const buildPath = result.filePaths[0];
  const xml = fs.readFileSync(buildPath, 'utf8');
  const response = await callBridge('loadBuild', { xml, name: path.basename(buildPath, '.xml') });
  return { ...response, file: buildPath };
});

ipcMain.handle('calculate', () => callBridge('getStats'));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => bridge?.kill());
