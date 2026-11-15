const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  onOpen: cb => ipcRenderer.on('open-file', (_e, name, bytes) => cb(name, bytes)),
  ready: () => ipcRenderer.send('renderer-ready')
});
