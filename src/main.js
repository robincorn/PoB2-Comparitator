const { app, BrowserWindow, ipcMain, dialog, clipboard, globalShortcut, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { decodeShareCode } = require('./pob-code');

let mainWindow;
let tray;
let bridge;
let isQuitting = false;
let requestId = 0;
let buildReady = false;
let comparisonBusy = false;
const pending = new Map();
const BRIDGE_TIMEOUT_MS = 30000;
const TOGGLE_HOTKEY = 'CommandOrControl+Shift+Space';
const COMPARE_HOTKEY = 'CommandOrControl+Shift+C';

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'icon-32.svg');
  const svg = fs.readFileSync(iconPath, 'utf8');
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function setWindowInteractive(interactive) {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

function hideOverlay() {
  if (!mainWindow) return;
  mainWindow.webContents.send('overlay-closed');
  setWindowInteractive(false);
}

function showOverlay() {
  if (!mainWindow) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  mainWindow.setBounds(display.bounds, false);
  mainWindow.showInactive();
  setWindowInteractive(false);
  mainWindow.webContents.send('overlay-opened');
}

function toggleOverlay() {
  if (!mainWindow) return;
  const currentlyOpen = mainWindow.webContents.executeJavaScript('document.body.classList.contains("overlay-open")', true).catch(() => false);
  currentlyOpen.then((open) => open ? hideOverlay() : showOverlay());
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('PoB2 Comparitator');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide Overlay', click: toggleOverlay },
    { type: 'separator' },
    { label: 'Quit PoB2 Comparitator', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', toggleOverlay);
  tray.on('double-click', showOverlay);
}

function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.bounds;
  mainWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.once('did-finish-load', () => hideOverlay());
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideOverlay();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  setWindowInteractive(false);
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
  if (!fs.existsSync(path.join(pobSrc, 'HeadlessWrapper.lua'))) return { ok: false, error: `PoB2 not found at ${pobRoot}. Run npm run setup first.` };
  if (!fs.existsSync(path.join(pobRuntimeLua, 'dkjson.lua'))) return { ok: false, error: `PoB2 runtime Lua directory not found at ${pobRuntimeLua}.` };
  const env = {
    ...process.env,
    LUA_PATH: [path.join(pobRuntimeLua, '?.lua'), path.join(pobRuntimeLua, '?', 'init.lua'), path.join(pobSrc, '?.lua'), path.join(pobSrc, '?', 'init.lua'), process.env.LUA_PATH || ''].filter(Boolean).join(';'),
    LUA_CPATH: [path.join(pobRuntime, '?.dll'), process.env.LUA_CPATH || ''].filter(Boolean).join(';'),
  };
  bridge = spawn(luajit, [bridgeScript], { cwd: pobSrc, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '';
  bridge.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        const entry = pending.get(message.id);
        if (entry) {
          pending.delete(message.id);
          clearTimeout(entry.timer);
          entry.resolve(message);
        }
      } catch (err) { console.error('Invalid bridge output:', line, err); }
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
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.resolve({ ok: false, error });
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

async function ensureBridge() {
  if (bridge) return { ok: true };
  return startBridge();
}

async function loadXml(xml, name) {
  const result = await ensureBridge();
  if (!result.ok) return result;
  return callBridge('loadBuild', { xml, name });
}

function withStats(response) {
  if (!response?.ok) return response;
  return { ...response, stats: response.result?.stats, skills: response.result?.skills || [] };
}

function markBuildLoaded() {
  buildReady = true;
}

async function compareItemText(itemText) {
  const result = await ensureBridge();
  if (!result.ok) return result;
  return callBridge('compareItem', { itemText });
}

async function compareClipboardItem() {
  if (!buildReady) return { ok: false, error: 'Load a PoB2 build before comparing an item.' };
  if (comparisonBusy) return { ok: false, error: 'Item comparison is already running.' };
  const itemText = clipboard.readText().trim();
  if (!itemText) return { ok: false, error: 'Clipboard is empty. Copy an item from PoE first.' };
  comparisonBusy = true;
  mainWindow?.webContents.send('item-comparison-start');
  try {
    const response = await compareItemText(itemText);
    if (response?.ok) mainWindow?.webContents.send('item-comparison', response.result);
    else mainWindow?.webContents.send('item-comparison-error', { error: response?.error || 'Item comparison failed.' });
    return response;
  } finally {
    comparisonBusy = false;
  }
}

ipcMain.handle('bridge-status', async () => {
  const result = await ensureBridge();
  if (!result.ok) return result;
  return callBridge('getStatus');
});

ipcMain.handle('hide-overlay', () => { hideOverlay(); return { ok: true }; });
ipcMain.handle('set-ignore-mouse-events', (_event, ignore) => { setWindowInteractive(!ignore); return { ok: true }; });
ipcMain.handle('compare-clipboard-item', compareClipboardItem);

ipcMain.handle('select-build', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Select a Path of Building XML build', properties: ['openFile'], filters: [{ name: 'Path of Building', extensions: ['xml'] }] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const buildPath = result.filePaths[0];
  const xml = fs.readFileSync(buildPath, 'utf8');
  const response = withStats(await loadXml(xml, path.basename(buildPath, '.xml')));
  if (response.ok) markBuildLoaded();
  return { ...response, file: buildPath };
});

ipcMain.handle('load-clipboard-build', async () => {
  const code = clipboard.readText().trim();
  if (!code) return { ok: false, error: 'Clipboard is empty.' };
  let xml;
  try { xml = decodeShareCode(code); }
  catch (error) { return { ok: false, error: error.message }; }
  const response = withStats(await loadXml(xml, 'Clipboard Build'));
  if (response.ok) markBuildLoaded();
  return response;
});

ipcMain.handle('calculate', async () => withStats(await callBridge('getStats')));

app.whenReady().then(() => {
  createTray();
  createWindow();
  if (!globalShortcut.register(TOGGLE_HOTKEY, toggleOverlay)) console.error(`Failed to register overlay hotkey: ${TOGGLE_HOTKEY}`);
  if (!globalShortcut.register(COMPARE_HOTKEY, compareClipboardItem)) console.error(`Failed to register item compare hotkey: ${COMPARE_HOTKEY}`);
});

app.on('will-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  tray?.destroy();
  bridge?.kill();
});

app.on('window-all-closed', () => {
  if (!isQuitting) return;
  app.quit();
});
