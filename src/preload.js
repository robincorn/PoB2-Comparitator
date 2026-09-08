const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pob', {
  status: () => ipcRenderer.invoke('bridge-status'),
  selectBuild: () => ipcRenderer.invoke('select-build'),
  loadClipboardBuild: () => ipcRenderer.invoke('load-clipboard-build'),
  compareClipboardItem: () => ipcRenderer.invoke('compare-clipboard-item'),
  calculate: () => ipcRenderer.invoke('calculate'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  onBridgeStatus: (callback) => ipcRenderer.on('bridge-status', (_event, value) => callback(value)),
  onItemComparison: (callback) => ipcRenderer.on('item-comparison', (_event, value) => callback(value)),
  onItemComparisonError: (callback) => ipcRenderer.on('item-comparison-error', (_event, value) => callback(value)),
  onOverlayOpened: (callback) => ipcRenderer.on('overlay-opened', () => callback()),
  onOverlayClosed: (callback) => ipcRenderer.on('overlay-closed', () => callback()),
});
