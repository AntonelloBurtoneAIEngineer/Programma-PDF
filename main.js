const {app, BrowserWindow, protocol, Menu, dialog, ipcMain, shell, session} = require('electron');
const path = require('path'), fs = require('fs');

protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true}}]);

const ROOT = path.join(__dirname, 'src');
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};

let win = null, rendererReady = false; const pending = [];
const pdfArgs = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => /\.pdf$/i.test(a) && fs.existsSync(a));

function sendFile(file){
  try {
    const bytes = fs.readFileSync(file);
    if (rendererReady && win) { win.webContents.send('open-file', path.basename(file), bytes); if (win.isMinimized()) win.restore(); win.focus(); }
    else pending.push(file);
  } catch (e) { dialog.showErrorBox('Lyonel Burton', 'Impossibile aprire il file:\n' + file + '\n' + e.message); }
}
async function openDialog(){
  const r = await dialog.showOpenDialog(win, {title: 'Apri PDF', properties: ['openFile', 'multiSelections'], filters: [{name: 'Documenti PDF', extensions: ['pdf']}]});
  if (!r.canceled) r.filePaths.forEach(sendFile);
}

function createWindow(){
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 820, minHeight: 560, backgroundColor: '#3a3c42', title: 'Lyonel Burton',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}
  });
  win.loadURL('app://local/index.html');
  win.webContents.setWindowOpenHandler(({url}) => { if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url); return {action: 'deny'}; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url); } });
  win.webContents.on('will-prevent-unload', e => {
    const c = dialog.showMessageBoxSync(win, {type: 'warning', buttons: ['Torna al documento', 'Chiudi senza salvare'], defaultId: 0, cancelId: 0, title: 'Lyonel Burton',
      message: 'Ci sono modifiche non salvate.', detail: 'Se chiudi ora, annotazioni, campi compilati e modifiche alle pagine andranno persi.'});
    if (c === 1) e.preventDefault();
  });
  win.on('closed', () => { win = null; rendererReady = false; });
}

function buildMenu(){
  const t = [
    {label: 'File', submenu: [
      {label: 'Apri…', accelerator: 'CmdOrCtrl+O', click: openDialog}, {type: 'separator'}, {role: 'quit', label: 'Esci'}]},
    {label: 'Modifica', submenu: [{role: 'copy', label: 'Copia'}, {role: 'paste', label: 'Incolla'}, {role: 'selectAll', label: 'Seleziona tutto'}]},
    {label: 'Visualizza', submenu: [
      {role: 'togglefullscreen', label: 'Schermo intero'}, {role: 'zoomIn', label: 'Ingrandisci interfaccia'}, {role: 'zoomOut', label: 'Riduci interfaccia'}, {role: 'resetZoom', label: 'Dimensione normale'},
      {role: 'toggleDevTools', label: 'Strumenti sviluppatore'}]},
    {label: '?', submenu: [{label: 'Informazioni', click: () => dialog.showMessageBox(win, {type: 'info', title: 'Informazioni', message: 'Lyonel Burton ' + app.getVersion(), detail: 'Autore: Antonello Burtone\n\nLegge, annota, compila, firma e organizza i PDF. I file restano sul tuo computer.\n\n© ' + new Date().getFullYear() + ' Antonello Burtone. Tutti i diritti riservati.'})}]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.setName('Lyonel Burton');
app.setAboutPanelOptions({applicationName: 'Lyonel Burton', applicationVersion: app.getVersion(), copyright: '© Antonello Burtone', credits: 'Autore: Antonello Burtone'});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => { if (win){ if (win.isMinimized()) win.restore(); win.focus(); } pdfArgs(argv).forEach(sendFile); });
  app.on('open-file', (e, file) => { e.preventDefault(); sendFile(file); });
  ipcMain.on('renderer-ready', () => { rendererReady = true; while (pending.length) sendFile(pending.shift()); });
  app.whenReady().then(() => {
    protocol.handle('app', req => {
      try {
        let p = decodeURIComponent(new URL(req.url).pathname); if (p === '/' || !p) p = '/index.html';
        const full = path.normalize(path.join(ROOT, p));
        if (!full.startsWith(ROOT)) return new Response('Vietato', {status: 403});
        const data = fs.readFileSync(full);
        return new Response(data, {headers: {'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream'}});
      } catch (e) { return new Response('Non trovato', {status: 404}); }
    });
    session.defaultSession.on('will-download', (_e, item) => { item.setSaveDialogOptions({title: 'Salva con nome', defaultPath: path.join(app.getPath('downloads'), item.getFilename())}); });
    pending.push(...pdfArgs(process.argv));
    buildMenu(); createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
