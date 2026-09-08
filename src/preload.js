const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pob', {
  status: () => ipcRenderer.invoke('bridge-status'),
  selectBuild: () => ipcRenderer.invoke('select-build'),
  calculate: () => ipcRenderer.invoke('calculate'),
  onBridgeStatus: (callback) => ipcRenderer.on('bridge-status', (_event, value) => callback(value)),
});
