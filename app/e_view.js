
/* =====================================================================
   ESTENSIONI 1: schede, posizione ricordata, aspetto, due pagine,
   lettura vocale, timbri e firme salvate, modifica testo
   ===================================================================== */
const LS = {
  get(k, d){ try { const v = localStorage.getItem('lp:' + k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem('lp:' + k, JSON.stringify(v)); return true; } catch(e){ return false; } }
};
const DESKTOP = !!(window.desktop && window.desktop.isDesktop);
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function parsePages(str, max){
  str = (str || '').trim().toLowerCase(); if (!str || str === 'tutte' || str === 'all') return Array.from({length: max}, (_, i) => i + 1);
  const out = new Set();
  for (const part of str.split(/[,;\s]+/).filter(Boolean)){
    const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) return null;
    let a = +m[1], b = m[2] ? +m[2] : a; if (a < 1 || b < a || b > max) return null;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/* ---------- Posizione ricordata ---------- */
const posKey = () => 'pos:' + S.name + '|' + (S.bytes ? S.bytes.length : 0);
function savePos(){ if (S.doc && S.bytes) LS.set(posKey(), {page: S.cur, zoomMode: S.zoomMode, scale: +S.scale.toFixed(3)}); }
function restorePos(){
  const p = LS.get(posKey()); if (!p) return;
  if (p.zoomMode){ S.zoomMode = p.zoomMode; if (p.scale) S.scale = p.scale; applyZoom(false); }
  if (p.page > 1 && p.page <= S.n) goToPage(p.page);
}
$('#viewer').addEventListener('scroll', debounce(savePos, 500));
window.addEventListener('beforeunload', e => {
  savePos(); snapTab();
  if (TABS.some(t => t.dirty)){ e.preventDefault(); e.returnValue = ''; return ''; }
});

/* ---------- Schede ---------- */
const TABS = []; let ACTIVE = null, SWITCHING = false;
const _loadBytes = loadBytes;
const dirtySig = () => JSON.stringify([S.anns, [...S.touched].map(n => [n, S.fields[n]]), S.bytes ? S.bytes.length : 0]);
function markClean(){ S.clean = dirtySig(); renderTabs(); updTitle(); }
const isDirty = () => !!S.doc && S.clean !== undefined && dirtySig() !== S.clean;
function updTitle(){ if (S.doc) document.title = (isDirty() ? '● ' : '') + S.name + ' – Lyonel Burton'; }
setInterval(updTitle, 1500);
function snapTab(){
  const t = TABS.find(x => x.id === ACTIVE); if (!t || !S.doc) return;
  Object.assign(t, {dirty: isDirty(), clean: S.clean, bytes: S.bytes, name: S.name, anns: S.anns, hist: S.hist, redo: S.redo, fields: S.fields, touched: [...S.touched],
    docUndo: S.docUndo, cur: S.cur, zoomMode: S.zoomMode, scale: S.scale, encrypted: S.encrypted, pw: S.encrypted ? LAST_PW : null});
  savePos();
}
loadBytes = async function(bytes, name, keep){
  if (!keep && !SWITCHING){ snapTab(); S.docUndo = []; }
  const ok = await _loadBytes(bytes, name, keep);
  if (!ok) return ok;
  if (!SWITCHING){
    if (!keep){ const t = {id: uid(), name: S.name}; TABS.push(t); ACTIVE = t.id; restorePos(); markClean(); }
    else { const t = TABS.find(x => x.id === ACTIVE); if (t) t.name = S.name; }
  }
  renderTabs(); return ok;
};
function renderTabs(){
  const bar = $('#tabbar'); bar.hidden = TABS.length < 2; bar.innerHTML = '';
  TABS.forEach(t => {
    const act = t.id === ACTIVE, dirty = act ? isDirty() : t.dirty;
    const d = el('div', 't' + (act ? ' on' : ''), `<span>${dirty ? '● ' : ''}${esc(act ? S.name : t.name)}</span><b title="Chiudi">✕</b>`);
    d.onclick = () => switchTab(t.id);
    d.querySelector('b').onclick = ev => { ev.stopPropagation(); closeTab(t.id); };
    bar.append(d);
  });
  const plus = el('div', 't', '<span>＋</span>'); plus.title = 'Apri un altro PDF'; plus.onclick = () => $('#fileIn').click(); bar.append(plus);
}
async function switchTab(id){
  if (id === ACTIVE) return; const t = TABS.find(x => x.id === id); if (!t) return;
  snapTab(); SWITCHING = true;
  try {
    S.anns = t.anns; S.hist = t.hist; S.redo = t.redo; S.fields = t.fields; S.touched = new Set(t.touched); S.docUndo = t.docUndo;
    S.zoomMode = t.zoomMode; S.scale = t.scale; PW_HINT = t.pw; ACTIVE = id;
    await _loadBytes(t.bytes, t.name, true); S.encrypted = t.encrypted; S.clean = t.clean;
    goToPage(t.cur || 1); updUndo();
  } finally { SWITCHING = false; renderTabs(); }
}
async function closeTab(id){
  const i = TABS.findIndex(x => x.id === id); if (i < 0) return;
  if (id === ACTIVE) snapTab();
  const t = TABS[i];
  if (t.dirty){
    if (!(await askConfirm('Chiudere il documento?', 'Ci sono modifiche non salvate (annotazioni, campi o pagine): andranno perse.', 'Chiudi senza salvare'))) return;
  }
  if (TABS.length === 1){ TABS.length = 0; ACTIVE = null; resetViewer(); renderTabs(); return; }
  if (id === ACTIVE){ await switchTab(TABS[i === 0 ? 1 : i - 1].id); }
  TABS.splice(TABS.findIndex(x => x.id === id), 1); renderTabs();
}
function resetViewer(){
  try { S.doc && S.doc.destroy(); } catch(e){}
  S.doc = null; S.bytes = null; S.n = 0; S.pages = []; S.anns = []; S.hist = []; S.redo = []; S.fields = {}; S.touched = new Set(); S.docUndo = []; S.sel = null;
  $('#pages').innerHTML = ''; $('#tab-thumbs').innerHTML = ''; $('#welcome').style.display = ''; $('#pageTot').textContent = '–';
  ['#bSave', '#bOrg'].forEach(s => $(s).disabled = true); document.title = 'Lyonel Burton'; updUndo(); refreshLists();
}

/* ---------- Aspetto: normale / notte / seppia ---------- */
const THEMES = ['', 'night', 'sepia'], THEME_LBL = ['🌙 Notte', '🟤 Seppia', '☀️ Normale'];
let themeIdx = 0;
function setTheme(i){
  themeIdx = i; document.body.classList.remove('night', 'sepia'); if (THEMES[i]) document.body.classList.add(THEMES[i]);
  $('#bTheme').textContent = THEME_LBL[i]; LS.set('theme', i);
}
$('#bTheme').onclick = () => setTheme((themeIdx + 1) % 3);

/* ---------- Due pagine affiancate ---------- */
function setSpread(v, quiet){
  S.spread = v; $('#pages').classList.toggle('spread', v); $('#bSpread').setAttribute('aria-pressed', v); LS.set('spread', v);
  if (S.doc && !quiet) applyZoom(true);
}
$('#bSpread').onclick = () => setSpread(!S.spread);

/* ---------- Schermo intero ---------- */
$('#bFull').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch(e){ toast('Lo schermo intero non è disponibile qui.', true); }
};
document.addEventListener('fullscreenchange', () => { if (S.doc && S.zoomMode !== 'num') setTimeout(() => applyZoom(true), 80); });

/* ---------- Lettura vocale ---------- */
let TTS = null;
async function pageText(doc, n){
  const pg = await doc.getPage(n), tc = await pg.getTextContent(); let out = '';
  tc.items.forEach(it => { out += (it.str || '') + (it.hasEOL ? '\n' : ' '); });
  return out;
}
function ttsStop(){
  if (TTS && TTS.resolve) TTS.resolve();
  TTS = null; try { speechSynthesis.cancel(); } catch(e){}
  $('#bTts').classList.remove('speaking'); $('#bTts').textContent = '🔊 Leggi';
}
function speakText(txt){
  return new Promise(res => {
    if (TTS) TTS.resolve = res;
    const parts = txt.replace(/\s+/g, ' ').match(/[^.!?;:]{1,200}[.!?;:]?\s*/g) || [txt];
    const voices = speechSynthesis.getVoices(), v = voices.find(x => /^it/i.test(x.lang));
    parts.forEach((p, i) => {
      if (!p.trim()) return;
      const u = new SpeechSynthesisUtterance(p.trim()); u.lang = 'it-IT'; if (v) u.voice = v;
      if (i === parts.length - 1){ u.onend = u.onerror = () => res(); }
      speechSynthesis.speak(u);
    });
    if (!parts.some(p => p.trim())) res();
  });
}
$('#bTts').onclick = async () => {
  if (!('speechSynthesis' in window)){ toast('La lettura vocale non è supportata da questo browser.', true); return; }
  if (TTS){ ttsStop(); return; }
  if (!S.doc){ toast('Apri prima un PDF.', true); return; }
  TTS = {page: S.cur}; $('#bTts').classList.add('speaking'); $('#bTts').textContent = '⏹ Stop';
  while (TTS && TTS.page <= S.n){
    const n = TTS.page; goToPage(n);
    const txt = (await pageText(S.doc, n)).trim(); if (!TTS) break;
    if (txt) await speakText(txt); else if (n === S.cur && TTS.page === S.cur && !txt && S.n === 1){ toast('Questa pagina non ha testo (prova l\'OCR).', true); }
    if (!TTS) break; TTS.page++;
  }
  ttsStop();
};

/* ---------- Timbri e firme salvate ---------- */
function stampImage(text, color){
  const c = document.createElement('canvas'), x = c.getContext('2d'), font = 'bold 64px Arial, Helvetica, sans-serif';
  x.font = font; const w = Math.ceil(x.measureText(text).width) + 64, h = 120; c.width = w; c.height = h;
  x.font = font; x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 8; x.lineJoin = 'round';
  x.strokeRect(6, 6, w - 12, h - 12); x.lineWidth = 3; x.strokeRect(16, 16, w - 32, h - 32);
  x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(text, w / 2, h / 2 + 4);
  return {data: c.toDataURL('image/png'), ar: w / h, w: clamp(.012 * text.length + .08, .16, .42)};
}
const STAMPS = [['APPROVATO', '#1a8a3a'], ['RICEVUTO', '#1b3f9c'], ['BOZZA', '#6b7280'], ['RIFIUTATO', '#c0262d'], ['CONFIDENZIALE', '#c0262d'], ['PAGATO', '#1a8a3a'], ['COPIA CONFORME', '#1b3f9c'], ['DA REVISIONARE', '#b36b00']];
function openStampModal(){
  const sigs = LS.get('sigs', []);
  const b = showModal(`<h2>Timbri e firme</h2>
    <div class="sect"><h3>✍️ Firme salvate</h3>
      <div id="sigList">${sigs.length ? '' : '<p>Nessuna firma salvata. Creane una e premi «Salva la firma attuale».</p>'}</div>
      <div class="mrow" style="justify-content:flex-start;margin-top:8px"><button class="tb" id="sgNew">✍️ Crea una nuova firma</button><button class="tb" id="sgSave" ${S.sig ? '' : 'disabled'}>💾 Salva la firma attuale</button></div>
      <p style="font-size:12px">Le firme restano salvate solo in questo browser/computer.</p></div>
    <div class="sect"><h3>🔖 Timbri</h3><div class="stampgrid" id="stGrid"></div>
      <div class="rowgrid"><label>Testo personalizzato<input type="text" id="stTxt" placeholder="Es. VISTO, URGENTE…"></label>
      <label>Colore<select id="stCol"><option value="#c0262d">Rosso</option><option value="#1b3f9c">Blu</option><option value="#1a8a3a">Verde</option><option value="#111111">Nero</option></select></label></div>
      <div class="mrow" style="justify-content:flex-start;margin-top:0"><button class="tb" id="stCustom">Usa il testo</button><button class="tb" id="stDate">📅 Data di oggi</button></div></div>
    <div class="mrow"><button class="tb" id="stClose">Chiudi</button></div>`);
  const useStamp = st => { S.stamp = st; closeModal(); S.tool = 'select'; setTool('stamp'); toast('Timbro pronto: clicca sulla pagina per inserirlo.'); };
  const grid = b.querySelector('#stGrid');
  STAMPS.forEach(([t, c]) => { const st = stampImage(t, c), btn = el('button'); btn.title = t; const im = new Image(); im.src = st.data; btn.append(im); btn.onclick = () => useStamp(st); grid.append(btn); });
  b.querySelector('#stCustom').onclick = () => { const t = b.querySelector('#stTxt').value.trim().toUpperCase(); if (!t){ toast('Scrivi il testo del timbro.', true); return; } useStamp(stampImage(t, b.querySelector('#stCol').value)); };
  b.querySelector('#stDate').onclick = () => useStamp(stampImage(new Date().toLocaleDateString('it-IT'), b.querySelector('#stCol').value));
  const list = b.querySelector('#sigList');
  sigs.forEach(sg => {
    const row = el('div', 'sigitem'); const im = new Image(); im.src = sg.data;
    const use = el('button', 'tb', 'Usa'), del = el('button', 'tb', '🗑️');
    use.onclick = () => { S.sig = {data: sg.data, ar: sg.ar}; closeModal(); S.tool = 'select'; setTool('sign'); toast('Firma pronta: clicca sulla pagina per inserirla.'); };
    del.onclick = () => { LS.set('sigs', LS.get('sigs', []).filter(x => x.id !== sg.id)); openStampModal(); };
    row.append(im, use, del); list.append(row);
  });
  b.querySelector('#sgNew').onclick = () => { closeModal(); openSignModal(() => { toast('Firma creata. Ora puoi salvarla da «Timbri / firme».'); openStampModal(); }); };
  b.querySelector('#sgSave').onclick = () => {
    if (!S.sig) return; const arr = LS.get('sigs', []); arr.push({id: uid(), data: S.sig.data, ar: S.sig.ar});
    if (!LS.set('sigs', arr.slice(-6))) toast('Impossibile salvare in questo ambiente.', true); else toast('Firma salvata.');
    openStampModal();
  };
  b.querySelector('#stClose').onclick = () => { closeModal(); if (S.tool === 'stamp' && !S.stamp) setTool('select'); };
}
$$('.tool[data-tool="stamp"]').forEach(btn => btn.addEventListener('click', () => {}));

/* ---------- Modifica del testo esistente ---------- */
$('#pages').addEventListener('pointerdown', e => {
  if (S.tool !== 'edittext') return;
  const sp = e.target.closest('.textLayer span'); if (!sp || !sp.textContent.trim()) return;
  const pe = sp.closest('.page'); if (!pe) return; const p = pageOf(parseInt(pe.dataset.n)); if (!p) return;
  e.preventDefault(); e.stopPropagation();
  const pr = pe.getBoundingClientRect(), r = sp.getBoundingClientRect();
  const Wpt = pr.width / S.scale, Hpt = pr.height / S.scale;
  const size = clamp(Math.round(parseFloat(getComputedStyle(sp).fontSize) / S.scale * 2) / 2, 6, 72);
  const padX = 1.5 / Wpt, padY = 1.5 / Hpt;
  const rx = (r.left - pr.left) / pr.width, ry = (r.top - pr.top) / pr.height, rw = r.width / pr.width, rh = r.height / pr.height;
  const cover = {id: uid(), type: 'cover', page: p.num, x: clamp(rx - padX, 0, 1), y: clamp(ry - padY, 0, 1), w: rw + 2 * padX, h: rh + 2 * padY};
  const tx = clamp(rx - 3 / Wpt, 0, .95);
  const txt = {id: uid(), type: 'text', page: p.num, x: tx, y: clamp(ry - (.13 * size + 2) / Hpt, 0, .98), w: clamp(rw + 14 / Wpt, .05, 1 - tx), size, color: '#111111', text: sp.textContent, fresh: false};
  snap(); S.anns.push(cover, txt); buildAnnLayer(p); refreshLists(); updUndo();
  setTool('select'); selectAnn(txt.id);
  setTimeout(() => { const d = document.querySelector(`.atext[data-id="${txt.id}"]`); if (d && getAnn(txt.id)) startTextEdit(d, txt); }, 90);
}, true);

/* ---------- Zoom con Ctrl + rotellina, scorciatoie ---------- */
let wheelT = 0;
$('#viewer').addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || !S.doc) return; e.preventDefault();
  const now = Date.now(); if (now - wheelT < 60) return; wheelT = now; zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
}, {passive: false});
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase();
  if (k === 'p'){ e.preventDefault(); printDoc(); }
  else if (k === 'o' && !DESKTOP){ e.preventDefault(); $('#fileIn').click(); }
});

/* ---------- Informazioni ---------- */
const APP_NAME = 'Lyonel Burton', APP_VERSION = '1.0.0', APP_AUTHOR = 'Antonello Burtone';
$('#bAbout').onclick = () => {
  const b = showModal(`<div style="text-align:center"><div class="logo" style="display:inline-block;font-size:22px;padding:10px 14px;border-radius:12px">LB</div>
    <h2 style="margin:10px 0 2px">${APP_NAME}</h2><div class="muted">Versione ${APP_VERSION}${DESKTOP ? ' · desktop' : ' · web'}</div></div>
    <div class="sect" style="margin-top:14px"><p style="margin:2px 0"><b>Autore:</b> ${APP_AUTHOR}</p>
    <p style="margin:2px 0">Legge, annota, compila, firma e organizza i PDF. Oscura, confronta, esporta, comprime, aggiunge filigrane e numeri di pagina, firma digitalmente${DESKTOP ? ' e fa l\'OCR delle scansioni' : ''}.</p>
    <p style="margin:6px 0 0;font-size:12.5px">I documenti restano sul tuo computer: non vengono inviati a nessun server.</p></div>
    <p style="font-size:12px;text-align:center;margin:8px 0 0">© ${new Date().getFullYear()} ${APP_AUTHOR}. Tutti i diritti riservati.</p>
    <div class="mrow" style="justify-content:center"><button class="tb primary" id="abOk">Chiudi</button></div>`);
  b.querySelector('#abOk').onclick = closeModal;
};

/* ---------- Avvio estensioni ---------- */
(function initExt(){
  setTheme(LS.get('theme', 0) || 0); if (LS.get('spread', false)) setSpread(true, true);
  $('#bOcr').disabled = false;
  document.addEventListener('keydown', e => { if (e.key === 'F11' && !DESKTOP){ e.preventDefault(); $('#bFull').click(); } });
  if (window.desktop && window.desktop.onOpen) window.desktop.onOpen((name, bytes) => loadBytes(new Uint8Array(bytes), name));
  if (window.desktop && window.desktop.ready) window.desktop.ready();
})();
