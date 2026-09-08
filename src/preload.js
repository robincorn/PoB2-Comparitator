const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pob', {
  status: () => ipcRenderer.invoke('bridge-status'),
  selectBuild: () => ipcRenderer.invoke('select-build'),
  loadClipboardBuild: () => ipcRenderer.invoke('load-clipboard-build'),
  calculate: () => ipcRenderer.invoke('calculate'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  onBridgeStatus: (callback) => ipcRenderer.on('bridge-status', (_event, value) => callback(value)),
});
