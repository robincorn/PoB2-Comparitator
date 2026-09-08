const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pob', {
  status: () => ipcRenderer.invoke('bridge-status'),
  selectBuild: () => ipcRenderer.invoke('select-build'),
  loadClipboardBuild: () => ipcRenderer.invoke('load-clipboard-build'),
  compareClipboardItem: () => ipcRenderer.invoke('compare-clipboard-item'),
  calculate: () => ipcRenderer.invoke('calculate'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  localPobSync: () => ipcRenderer.invoke('local-pob-sync'),
  localPobCancel: () => ipcRenderer.invoke('local-pob-cancel'),
  localPobInfo: () => ipcRenderer.invoke('local-pob-info'),
  onBridgeStatus: (callback) => ipcRenderer.on('bridge-status', (_event, value) => callback(value)),
  onItemComparisonStart: (callback) => ipcRenderer.on('item-comparison-start', () => callback()),
  onItemComparison: (callback) => ipcRenderer.on('item-comparison', (_event, value) => callback(value)),
  onItemComparisonError: (callback) => ipcRenderer.on('item-comparison-error', (_event, value) => callback(value)),
  onOverlayOpened: (callback) => ipcRenderer.on('overlay-opened', () => callback()),
  onOverlayClosed: (callback) => ipcRenderer.on('overlay-closed', () => callback()),
  onLocalPobStatus: (callback) => ipcRenderer.on('local-pob-status', (_event, value) => callback(value)),
  onLocalPobBuild: (callback) => ipcRenderer.on('local-pob-build', (_event, value) => callback(value)),
});
