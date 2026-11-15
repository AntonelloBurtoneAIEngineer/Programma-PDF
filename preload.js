const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  onOpen: cb => ipcRenderer.on('open-file', (_e, name, bytes) => cb(name, bytes)),
  onUpdate: cb => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  openExternal: url => ipcRenderer.send('open-external', url),
  ready: () => ipcRenderer.send('renderer-ready')
});
