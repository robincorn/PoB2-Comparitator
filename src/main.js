const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let bridge;
let requestId = 0;
const pending = new Map();

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
  const bridgeScript = path.join(projectRoot, 'pob-bridge', 'OverlayWrapper.lua');
  const luajit = findLuaJit(projectRoot);

  if (!fs.existsSync(path.join(pobSrc, 'HeadlessWrapper.lua'))) {
    return { ok: false, error: `PoB2 not found at ${pobRoot}. Run setup-pob.cmd first.` };
  }

  const env = {
    ...process.env,
    LUA_PATH: `../runtime/lua/?.lua;../runtime/lua/?/init.lua;;${process.env.LUA_PATH || ''}`,
    LUA_CPATH: `../runtime/?.dll;;${process.env.LUA_CPATH || ''}`,
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
          resolve(message);
        }
      } catch (err) {
        console.error('Invalid bridge output:', line, err);
      }
    }
  });
  bridge.stderr.on('data', (chunk) => console.error('[PoB]', chunk.toString()));
  bridge.on('error', (err) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: `Could not start LuaJIT: ${err.message}` });
    pending.clear();
    bridge = null;
    mainWindow?.webContents.send('bridge-status', { ok: false, error: `Could not start LuaJIT: ${err.message}` });
  });
  bridge.on('exit', (code) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: `PoB bridge exited (${code})` });
    pending.clear();
    bridge = null;
    mainWindow?.webContents.send('bridge-status', { ok: false, error: `PoB bridge exited (${code})` });
  });
  return { ok: true };
}

function callBridge(method, params = {}) {
  return new Promise((resolve) => {
    if (!bridge) return resolve({ ok: false, error: 'PoB bridge is not running' });
    const id = ++requestId;
    pending.set(id, resolve);
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
