const {contextBridge, ipcRenderer, webUtils} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  onOpen: cb => ipcRenderer.on('open-file', (_e, name, bytes, path) => cb(name, bytes, path)),
  onUpdate: cb => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  openExternal: url => ipcRenderer.send('open-external', url),
  pathFor: file => { try { return webUtils.getPathForFile(file) || null; } catch (e) { return null; } },
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  writeFile: (path, bytes) => ipcRenderer.invoke('write-file', path, bytes),
  saveAs: (defaultPath, bytes) => ipcRenderer.invoke('save-as', defaultPath, bytes),
  checkUpdates: () => ipcRenderer.send('check-updates'),
  quit: () => ipcRenderer.send('quit'),
  ready: () => ipcRenderer.send('renderer-ready')
});
