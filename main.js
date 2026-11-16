const {app, BrowserWindow, protocol, Menu, dialog, ipcMain, shell, session, net} = require('electron');
const path = require('path'), fs = require('fs');

protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true}}]);

const ROOT = path.join(__dirname, 'src');
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};

let win = null, rendererReady = false; const pending = [];
const REPO = 'AntonelloBurtoneAIEngineer/Programma-PDF';
const verNum = v => String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map(x => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++){ if (x[i] !== y[i]) return x[i] > y[i]; } return false; };
async function checkUpdates(manual){
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {headers: {'Accept': 'application/vnd.github+json', 'User-Agent': 'Lyonel-Burton'}});
    if (r.status === 404){ if (manual) dialog.showMessageBox(win, {type: 'info', title: 'Aggiornamenti', message: 'Non ci sono ancora versioni pubblicate.'}); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), latest = (j.tag_name || '').replace(/^v/i, ''), current = app.getVersion();
    if (latest && newer(latest, current)){
      if (win) win.webContents.send('update-available', {latest, current, url: j.html_url || `https://github.com/${REPO}/releases/latest`, notes: (j.body || '').slice(0, 2000)});
    } else if (manual) dialog.showMessageBox(win, {type: 'info', title: 'Aggiornamenti', message: 'Hai già la versione più recente (' + current + ').'});
  } catch (e) { if (manual) dialog.showMessageBox(win, {type: 'warning', title: 'Aggiornamenti', message: 'Impossibile controllare gli aggiornamenti.', detail: String(e.message || e)}); }
}
const pdfArgs = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => /\.pdf$/i.test(a) && fs.existsSync(a));

function sendFile(file){
  try {
    const bytes = fs.readFileSync(file);
    if (rendererReady && win) { win.webContents.send('open-file', path.basename(file), bytes, path.resolve(file)); if (win.isMinimized()) win.restore(); win.focus(); }
    else pending.push(file);
  } catch (e) { dialog.showErrorBox('Lyonel Burton', 'Impossibile aprire il file:\n' + file + '\n' + e.message); }
}
async function openDialog(){
  const r = await dialog.showOpenDialog(win, {title: 'Apri PDF', properties: ['openFile', 'multiSelections'], filters: [{name: 'Documenti PDF', extensions: ['pdf']}]});
  if (r.canceled) return [];
  return r.filePaths.map(f => ({name: path.basename(f), path: f, bytes: fs.readFileSync(f)}));
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
  // La barra dei menu è disegnata dall'interfaccia (File, Modifica, Visualizza…), uguale nella versione web.
  Menu.setApplicationMenu(null);
}

app.setName('Lyonel Burton');
app.setAboutPanelOptions({applicationName: 'Lyonel Burton', applicationVersion: app.getVersion(), copyright: '© Antonello Burtone', credits: 'Autore: Antonello Burtone'});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => { if (win){ if (win.isMinimized()) win.restore(); win.focus(); } pdfArgs(argv).forEach(sendFile); });
  app.on('open-file', (e, file) => { e.preventDefault(); sendFile(file); });
  ipcMain.on('renderer-ready', () => { rendererReady = true; while (pending.length) sendFile(pending.shift()); setTimeout(() => checkUpdates(false), 4000); });
  ipcMain.handle('open-dialog', () => openDialog());
  ipcMain.handle('write-file', async (_e, file, bytes) => {
    if (typeof file !== 'string' || !/\.pdf$/i.test(file)) throw new Error('Percorso non valido');
    const tmp = file + '.lbtmp'; await fs.promises.writeFile(tmp, Buffer.from(bytes)); await fs.promises.rename(tmp, file); return true;
  });
  ipcMain.handle('save-as', async (_e, def, bytes) => {
    const r = await dialog.showSaveDialog(win, {title: 'Salva con nome', defaultPath: path.isAbsolute(String(def)) ? def : path.join(app.getPath('documents'), String(def || 'documento.pdf')), filters: [{name: 'Documento PDF', extensions: ['pdf']}]});
    if (r.canceled || !r.filePath) return null;
    let f = r.filePath; if (!/\.pdf$/i.test(f)) f += '.pdf';
    await fs.promises.writeFile(f, Buffer.from(bytes)); return {path: f, name: path.basename(f)};
  });
  ipcMain.on('check-updates', () => checkUpdates(true));
  ipcMain.on('quit', () => { if (win) win.close(); });
  ipcMain.on('open-external', (_e, url) => { if (/^https:\/\/github\.com\//i.test(String(url))) shell.openExternal(url); });
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
