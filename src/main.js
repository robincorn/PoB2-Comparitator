const { app, BrowserWindow, ipcMain, dialog, clipboard, globalShortcut, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { decodeShareCode } = require('./pob-code');

let mainWindow;
let tray;
let bridge;
let isQuitting = false;
let overlayOpen = false;
let requestId = 0;
let buildReady = false;
let comparisonBusy = false;
let localSync = null;
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  }
}

function hideOverlay() {
  overlayOpen = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay-closed');
    setWindowInteractive(false);
  }
}

function showOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlayOpen = true;
  mainWindow.setBounds(display.bounds, false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.showInactive();
  mainWindow.setAlwaysOnTop(true, 'floating');
  setWindowInteractive(false);
  mainWindow.webContents.send('overlay-opened');
}

function ensureOverlayVisible() {
  if (!mainWindow || mainWindow.isDestroyed() || !overlayOpen) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.showInactive();
  mainWindow.setAlwaysOnTop(true, 'floating');
  setWindowInteractive(false);
}

function toggleOverlay() {
  overlayOpen ? hideOverlay() : showOverlay();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('PoB2 Comparitator');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide Overlay', click: toggleOverlay },
    { type: 'separator' },
    { label: 'Quit PoB2 Comparitator', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', toggleOverlay);
  tray.on('double-click', showOverlay);
}

function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  mainWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.once('did-finish-load', hideOverlay);
  mainWindow.on('close', event => {
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
  return fs.existsSync(local) ? local : (process.platform === 'win32' ? 'luajit.exe' : 'luajit');
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
      process.env.LUA_PATH || ''
    ].filter(Boolean).join(';'),
    LUA_CPATH: [path.join(pobRuntime, '?.dll'), process.env.LUA_CPATH || ''].filter(Boolean).join(';')
  };

  bridge = spawn(luajit, [bridgeScript], {
    cwd: pobSrc,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  let buffer = '';
  bridge.stdout.on('data', chunk => {
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
      } catch (err) {
        console.error('Invalid bridge output:', line, err);
      }
    }
  });

  bridge.stderr.on('data', chunk => console.error('[PoB]', chunk.toString()));
  bridge.on('error', err => failPending(`Could not start LuaJIT: ${err.message}`));
  bridge.on('exit', code => {
    failPending(`PoB bridge exited (${code})`);
    bridge = null;
    mainWindow?.webContents.send('bridge-status', {
      ok: false,
      error: `PoB bridge exited (${code})`
    });
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
  return new Promise(resolve => {
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
  return bridge ? { ok: true } : startBridge();
}

async function loadXml(xml, name) {
  const ready = await ensureBridge();
  if (!ready.ok) return ready;
  return callBridge('loadBuild', { xml, name });
}

function withStats(response) {
  return response?.ok
    ? { ...response, stats: response.result?.stats, skills: response.result?.skills || [] }
    : response;
}

function markBuildLoaded() {
  buildReady = true;
}

async function compareClipboardItem() {
  if (!buildReady) return { ok: false, error: 'Load a PoB2 build before comparing an item.' };
  if (comparisonBusy) return { ok: false, error: 'Item comparison is already running.' };
  const itemText = clipboard.readText().trim();
  if (!itemText) return { ok: false, error: 'Clipboard is empty. Copy an item from PoE first.' };

  comparisonBusy = true;
  mainWindow?.webContents.send('item-comparison-start');
  try {
    const ready = await ensureBridge();
    if (!ready.ok) return ready;
    const response = await callBridge('compareItem', { itemText });
    if (response?.ok) mainWindow?.webContents.send('item-comparison', response.result);
    else mainWindow?.webContents.send('item-comparison-error', { error: response?.error || 'Item comparison failed.' });
    ensureOverlayVisible();
    return response;
  } finally {
    comparisonBusy = false;
  }
}

function userPathCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const docs = app.getPath('documents');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(docs, 'Path of Building (PoE2)', 'Builds'),
    path.join(docs, 'Path of Building', 'Builds'),
    path.join(appData, 'Path of Building (PoE2)', 'Builds'),
    path.join(appData, 'Path of Building Community', 'Builds'),
    path.join(appData, 'Path of Building', 'Builds'),
    path.join(localAppData, 'Path of Building (PoE2)', 'Builds'),
    path.join(localAppData, 'Path of Building', 'Builds')
  ];
}

function findBuildDirectory() {
  return userPathCandidates().find(dir => fs.existsSync(dir)) || userPathCandidates()[0];
}

function installedPobCandidates() {
  const home = process.env.USERPROFILE || '';
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    process.env.POB_INSTALLED_PATH,
    path.join(appData, 'Path of Building (PoE2)', 'Path of Building-PoE2.exe'),
    path.join(appData, 'Path of Building (PoE2)', 'runtime', 'Path of Building-PoE2.exe'),
    path.join(localAppData, 'Path of Building (PoE2)', 'Path of Building-PoE2.exe'),
    path.join(localAppData, 'Path of Building (PoE2)', 'runtime', 'Path of Building-PoE2.exe'),
    path.join(pf, 'Path of Building (PoE2)', 'Path of Building-PoE2.exe'),
    path.join(pf, 'Path of Building (PoE2)', 'runtime', 'Path of Building-PoE2.exe'),
    path.join(pfx86, 'Path of Building (PoE2)', 'Path of Building-PoE2.exe'),
    path.join(pfx86, 'Path of Building (PoE2)', 'runtime', 'Path of Building-PoE2.exe'),
    path.join(appData, 'Path of Building Community', 'Path of Building.exe'),
    path.join(pf, 'Path of Building Community', 'Path of Building.exe'),
    path.join(pfx86, 'Path of Building Community', 'Path of Building.exe')
  ].filter(Boolean);
}

function findInstalledPob() {
  const direct = installedPobCandidates().find(file => fs.existsSync(file));
  if (direct) return direct;
  const roots = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const wanted = new Set(['Path of Building-PoE2.exe', 'Path of Building.exe']);
  const queue = roots.map(root => ({ dir: root, depth: 0 }));
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > 5) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && wanted.has(entry.name)) return full;
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return null;
}

function snapshotBuildFiles(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.xml')) continue;
    const file = path.join(dir, name);
    try { out.set(file, fs.statSync(file).mtimeMs); } catch {}
  }
  return out;
}

function newestChangedBuild(dir, before) {
  let best = null;
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.xml')) continue;
    const file = path.join(dir, name);
    try {
      const mtime = fs.statSync(file).mtimeMs;
      const old = before.get(file);
      if (old === undefined || mtime > old + 500) {
        best = !best || mtime > best.mtime ? { file, mtime } : best;
      }
    } catch {}
  }
  return best?.file || null;
}

function stopLocalSync(reason = 'cancelled') {
  if (!localSync) return;
  clearInterval(localSync.timer);
  localSync = null;
  mainWindow?.webContents.send('local-pob-status', { state: reason });
}

async function startLocalPobSync() {
  if (localSync) return { ok: false, error: 'Local PoB sync is already waiting for a saved build.' };
  const exe = findInstalledPob();
  if (!exe) return { ok: false, error: 'Could not find an installed PoB2. Set POB_INSTALLED_PATH to the Path of Building-PoE2.exe path.' };

  const buildDir = findBuildDirectory();
  fs.mkdirSync(buildDir, { recursive: true });
  const before = snapshotBuildFiles(buildDir);

  try {
    spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  } catch (error) {
    return { ok: false, error: `Could not launch PoB2: ${error.message}` };
  }

  mainWindow?.webContents.send('local-pob-status', { state: 'waiting', executable: exe, buildDir });
  localSync = { timer: null, buildDir, before, startedAt: Date.now() };
  localSync.timer = setInterval(async () => {
    if (!localSync) return;
    const found = newestChangedBuild(buildDir, before);
    if (!found) {
      if (Date.now() - localSync.startedAt > 15 * 60 * 1000) stopLocalSync('timeout');
      return;
    }
    try {
      const xml = fs.readFileSync(found, 'utf8');
      const response = withStats(await loadXml(xml, path.basename(found, '.xml')));
      if (!response.ok) {
        mainWindow?.webContents.send('local-pob-status', { state: 'error', error: response.error });
        return;
      }
      markBuildLoaded();
      clearInterval(localSync.timer);
      localSync = null;
      mainWindow?.webContents.send('local-pob-status', { state: 'synced', file: found });
      mainWindow?.webContents.send('local-pob-build', { ...response, file: found });
      ensureOverlayVisible();
    } catch (error) {
      mainWindow?.webContents.send('local-pob-status', { state: 'error', error: error.message });
    }
  }, 1000);

  return { ok: true, executable: exe, buildDir };
}

ipcMain.handle('bridge-status', async () => {
  const ready = await ensureBridge();
  if (!ready.ok) return ready;
  return callBridge('getStatus');
});

ipcMain.handle('hide-overlay', () => {
  hideOverlay();
  return { ok: true };
});

ipcMain.handle('set-ignore-mouse-events', (_e, ignore) => {
  setWindowInteractive(!ignore);
  return { ok: true };
});

ipcMain.handle('compare-clipboard-item', compareClipboardItem);

ipcMain.handle('select-build', async () => {
  const wasOpen = overlayOpen;
  ensureOverlayVisible();
  const result = await dialog.showOpenDialog(null, {
    title: 'Select a Path of Building XML build',
    properties: ['openFile'],
    filters: [{ name: 'Path of Building', extensions: ['xml'] }]
  });
  if (result.canceled || !result.filePaths[0]) {
    if (wasOpen) ensureOverlayVisible();
    return { ok: false, canceled: true };
  }

  const filePath = result.filePaths[0];
  if (wasOpen) ensureOverlayVisible();
  const response = withStats(await loadXml(fs.readFileSync(filePath, 'utf8'), path.basename(filePath, '.xml')));
  if (response.ok) markBuildLoaded();
  if (wasOpen) ensureOverlayVisible();
  return { ...response, file: filePath };
});

ipcMain.handle('load-clipboard-build', async () => {
  const code = clipboard.readText().trim();
  if (!code) return { ok: false, error: 'Clipboard is empty.' };
  let xml;
  try { xml = decodeShareCode(code); } catch (error) { return { ok: false, error: error.message }; }
  const response = withStats(await loadXml(xml, 'Clipboard Build'));
  if (response.ok) markBuildLoaded();
  ensureOverlayVisible();
  return response;
});

ipcMain.handle('calculate', async () => {
  const response = withStats(await callBridge('getStats'));
  ensureOverlayVisible();
  return response;
});

ipcMain.handle('local-pob-sync', startLocalPobSync);
ipcMain.handle('local-pob-cancel', () => { stopLocalSync(); return { ok: true }; });
ipcMain.handle('local-pob-info', () => ({ executable: findInstalledPob(), buildDirectory: findBuildDirectory() }));

app.whenReady().then(async () => {
  createTray();
  createWindow();
  if (!globalShortcut.register(TOGGLE_HOTKEY, toggleOverlay)) console.error(`Failed to register overlay hotkey: ${TOGGLE_HOTKEY}`);
  if (!globalShortcut.register(COMPARE_HOTKEY, compareClipboardItem)) console.error(`Failed to register item compare hotkey: ${COMPARE_HOTKEY}`);
  await ensureBridge();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (localSync) stopLocalSync();
  if (bridge) bridge.kill();
  if (tray) tray.destroy();
});
