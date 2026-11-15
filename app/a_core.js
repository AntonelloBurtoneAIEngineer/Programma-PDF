'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const {PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle, PDFName, PDFString,
       PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList} = PDFLib;

const WORKER_URL = URL.createObjectURL(new Blob([document.getElementById('pdfWorkerSrc').textContent], {type: 'text/javascript'}));
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
let SHARED_WORKER = null;
function sharedWorker(){
  if (SHARED_WORKER) return SHARED_WORKER;
  try { SHARED_WORKER = new pdfjsLib.PDFWorker({port: new Worker(WORKER_URL)}); } catch(e){ SHARED_WORKER = null; }
  return SHARED_WORKER;
}
const openPdf = bytes => pdfjsLib.getDocument(Object.assign({data: bytes.slice(), isEvalSupported: false}, sharedWorker() ? {worker: sharedWorker()} : {}));

const PALETTE = [['#ffe14d','Giallo'],['#7be07b','Verde'],['#ff9ec4','Rosa'],['#7cc7ff','Azzurro'],['#d6313a','Rosso'],['#111111','Nero']];
const S = {
  bytes: null, name: 'documento.pdf', doc: null, n: 0, pages: [], scale: 1.25, zoomMode: 'width', cur: 1, ver: 0,
  tool: 'select', toolColor: {highlight:'#ffe14d', underline:'#d6313a', strike:'#d6313a', note:'#ffd84a', pen:'#d6313a', text:'#111111', sign:'#111111'},
  anns: [], hist: [], redo: [], sel: null, fields: {}, touched: new Set(), showFields: true, sig: null,
  search: {q:'', results:[], idx:-1, ver:0}, textCache: {}, docUndo: [], penW: 3, textSize: 14, encrypted: false,
  spread: false, stamp: null
};
S.toolColor.stamp = '#111111'; S.toolColor.redact = '#000000'; S.toolColor.edittext = '#111111';

/* ---------- Utilità ---------- */
let toastT = null;
function toast(msg, err){
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = '', err ? 5000 : 2600);
}
async function saveFile(name, data, mime){
  try {
    if (window.claude && claude.use){
      const d = await claude.use('downloads');
      if (d){
        try { await d.save({filename: name, data}); return true; }
        catch(e){ if (e && e.code === 'declined') return false; toast('Salvataggio non riuscito: ' + (e && e.message || e), true); return false; }
      }
    }
  } catch(e){}
  const blob = new Blob([data], {type: mime || 'application/octet-stream'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
const baseName = () => (S.name || 'documento').replace(/\.pdf$/i, '');

/* ---------- Finestre modali ---------- */
function showModal(html, wide){
  const m = $('#modal'), b = $('#mbox'); b.className = 'mbox' + (wide ? ' wide' : ''); b.innerHTML = html; m.hidden = false; return b;
}
function closeModal(){ $('#modal').hidden = true; $('#mbox').innerHTML = ''; }
function askText(title, msg, def, type){
  return new Promise(res => {
    const ov = el('div', 'modal'); ov.style.zIndex = 80;
    const b = el('div', 'mbox');
    b.innerHTML = `<h2>${esc(title)}</h2><p>${esc(msg)}</p><input type="${type||'text'}" id="askIn"><div class="mrow"><button class="tb" id="askNo">Annulla</button><button class="tb primary" id="askOk">OK</button></div>`;
    ov.append(b); document.body.append(ov);
    const inp = b.querySelector('#askIn'); inp.value = def || ''; inp.focus(); inp.select();
    const done = v => { ov.remove(); res(v); };
    b.querySelector('#askNo').onclick = () => done(null);
    b.querySelector('#askOk').onclick = () => done(inp.value);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
  });
}
function askConfirm(title, msg, okLabel){
  return new Promise(res => {
    const ov = el('div', 'modal'); ov.style.zIndex = 80;
    const b = el('div', 'mbox');
    b.innerHTML = `<h2>${esc(title)}</h2><p>${esc(msg)}</p><div class="mrow"><button class="tb" id="cNo">Annulla</button><button class="tb primary" id="cOk">${esc(okLabel||'OK')}</button></div>`;
    ov.append(b); document.body.append(ov);
    b.querySelector('#cNo').onclick = () => { ov.remove(); res(false); };
    b.querySelector('#cOk').onclick = () => { ov.remove(); res(true); };
  });
}

/* ---------- Apertura documento ---------- */
async function openFile(file){
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)){ toast('Seleziona un file PDF.', true); return; }
  const buf = new Uint8Array(await file.arrayBuffer());
  await loadBytes(buf, file.name);
}

let PW_HINT = null, LAST_PW = null;
async function loadBytes(bytes, name, keep){
  const task = openPdf(bytes);
  let pwTried = false;
  task.onPassword = async (update, reason) => {
    if (PW_HINT != null && !pwTried){ const h = PW_HINT; PW_HINT = null; pwTried = true; LAST_PW = h; update(h); return; }
    const pw = await askText('Documento protetto', reason === 2 ? 'Password errata. Riprova.' : 'Questo PDF richiede una password per essere aperto.', '', 'password');
    pwTried = true;
    if (pw == null){ task.destroy(); return; }
    LAST_PW = pw; update(pw);
  };
  let doc;
  try { doc = await task.promise; }
  catch(e){ if (!pwTried) toast('Impossibile aprire il file: ' + (e && e.message || e), true); return false; }
  if (S.doc && S.doc !== doc){ try { S.doc.destroy(); } catch(e){} }
  S.bytes = bytes; if (name) S.name = name;
  S.doc = doc; S.n = doc.numPages; S.ver++;
  S.encrypted = pwTried;
  if (!keep){ S.anns = []; S.hist = []; S.redo = []; S.fields = {}; S.touched = new Set(); S.sel = null; }
  S.textCache = {}; S.search = {q: '', results: [], idx: -1, ver: S.search.ver + 1};
  $('#searchIn').value = ''; $('#sCount').textContent = '';
  $('#welcome').style.display = 'none';
  $('#pageTot').textContent = S.n; $('#pageIn').max = S.n;
  ['#bSave', '#bOrg'].forEach(s => $(s).disabled = false);
  document.title = S.name + ' – Lyonel Burton';
  await buildPages();
  buildThumbs(); buildOutline(); refreshLists(); updUndo();
  $('#viewer').scrollTop = 0;
  return true;
}

/* ---------- Pagine ---------- */
async function buildPages(){
  const host = $('#pages'); host.innerHTML = ''; S.pages = [];
  const ver = S.ver;
  const first = await S.doc.getPage(1); const v1 = first.getViewport({scale: 1});
  for (let i = 1; i <= S.n; i++){
    const e = el('div', 'page'); e.dataset.n = i; e.innerHTML = `<span class="num">${i}</span>`;
    S.pages.push({num: i, el: e, bw: v1.width, bh: v1.height, state: 'idle', token: 0, rs: 0, textDivs: []});
    host.append(e);
  }
  S.cur = 1;
  const CH = 40;
  for (let s = 1; s <= S.n; s += CH){
    const idxs = []; for (let i = s; i < Math.min(S.n + 1, s + CH); i++) idxs.push(i);
    await Promise.all(idxs.map(async i => {
      try { const pg = await S.doc.getPage(i); const vp = pg.getViewport({scale: 1}); const p = S.pages[i-1]; p.bw = vp.width; p.bh = vp.height; } catch(e){}
    }));
    if (ver !== S.ver) return;
  }
  applyZoom(false);
}

function calcScale(){
  const v = $('#viewer'), p = S.pages[Math.max(0, S.cur - 1)] || S.pages[0]; if (!p) return S.scale;
  const cols = S.spread ? 2 : 1;
  const availW = (v.clientWidth - 40 - (cols - 1) * 14) / cols, availH = v.clientHeight - 32;
  if (S.zoomMode === 'width') return clamp(availW / p.bw, .2, 5);
  if (S.zoomMode === 'page') return clamp(Math.min(availW / p.bw, availH / p.bh), .2, 5);
  return S.scale;
}
function layoutAll(){
  for (const p of S.pages){ p.el.style.width = Math.round(p.bw * S.scale) + 'px'; p.el.style.height = Math.round(p.bh * S.scale) + 'px'; }
}
function getAnchor(){
  const v = $('#viewer'), p = S.pages[S.cur - 1]; if (!p) return null;
  return {n: S.cur, frac: (v.scrollTop - p.el.offsetTop) / Math.max(1, p.el.offsetHeight)};
}
function applyZoom(keep = true){
  const a = keep ? getAnchor() : null;
  S.scale = calcScale(); layoutAll();
  S.pages.forEach(releasePage);
  if (a){ const p = S.pages[a.n - 1]; $('#viewer').scrollTop = p.el.offsetTop + a.frac * p.el.offsetHeight; }
  syncZoomSel(); updateVisible();
}
function syncZoomSel(){
  const sel = $('#zoomSel'); [...sel.querySelectorAll('option[data-c]')].forEach(o => o.remove());
  if (S.zoomMode === 'num'){
    const pct = Math.round(S.scale * 100); let found = [...sel.options].find(o => Math.abs(parseFloat(o.value) * 100 - pct) < 1);
    if (found) sel.value = found.value;
    else { const o = el('option', null, pct + '%'); o.value = 'c' + pct; o.dataset.c = 1; sel.append(o); sel.value = o.value; }
  } else sel.value = S.zoomMode;
}
function zoomBy(f){
  S.zoomMode = 'num'; S.scale = clamp(S.scale * f, .2, 5); const a = getAnchor();
  layoutAll(); S.pages.forEach(releasePage);
  if (a){ const p = S.pages[a.n - 1]; $('#viewer').scrollTop = p.el.offsetTop + a.frac * p.el.offsetHeight; }
  syncZoomSel(); updateVisible();
}

function releasePage(p){
  p.token++; if (p.task){ try { p.task.cancel(); } catch(e){} p.task = null; }
  if (p.state === 'idle' && !p.el.querySelector('canvas')) return;
  p.state = 'idle'; p.rs = 0; p.textDivs = [];
  [...p.el.children].forEach(c => { if (!c.classList.contains('num')) c.remove(); });
}

async function renderPage(p){
  if (p.state === 'rendering') return;
  p.state = 'rendering'; const token = ++p.token, scale = S.scale, ver = S.ver;
  try {
    const page = await S.doc.getPage(p.num); if (token !== p.token) return;
    const vp = page.getViewport({scale});
    p.el.style.width = Math.round(vp.width) + 'px'; p.el.style.height = Math.round(vp.height) + 'px';
    p.vw = vp.width; p.vh = vp.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
    const task = page.render({canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr,0,0,dpr,0,0] : null,
                              annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS});
    p.task = task;
    try { await task.promise; } catch(e){ if (e && e.name === 'RenderingCancelledException') return; throw e; }
    if (token !== p.token || ver !== S.ver) return;
    p.task = null;
    p.el.querySelectorAll('canvas,.textLayer,.formLayer,.annLayer').forEach(x => x.remove());
    p.el.append(cv);
    const tl = el('div', 'textLayer'); tl.style.setProperty('--scale-factor', vp.scale); p.el.append(tl);
    const tc = await page.getTextContent(); if (token !== p.token) return;
    S.textCache[p.num] = tc.items.map(it => it.str || '');
    p.textDivs = [];
    await pdfjsLib.renderTextLayer({textContentSource: tc, container: tl, viewport: vp, textDivs: p.textDivs}).promise;
    if (token !== p.token) return;
    applySearchHighlights(p);
    await buildFormLayer(p, page, vp); if (token !== p.token) return;
    buildAnnLayer(p);
    p.state = 'done'; p.rs = scale;
  } catch(e){
    if (token === p.token){ p.state = 'idle'; console.error(e); }
  }
}

function updateVisible(){
  const v = $('#viewer'), top = v.scrollTop, bot = top + v.clientHeight, m = v.clientHeight;
  for (const p of S.pages){
    const pt = p.el.offsetTop, pb = pt + p.el.offsetHeight;
    if (pb > top - m && pt < bot + m){ if (p.state === 'idle') renderPage(p); }
    else if (p.state === 'done' && (pb < top - m * 3 || pt > bot + m * 3)) releasePage(p);
  }
  updateCurrent();
}
function updateCurrent(){
  const v = $('#viewer'), mid = v.scrollTop + v.clientHeight * 0.35; let cur = 1;
  for (const p of S.pages){ if (p.el.offsetTop <= mid) cur = p.num; else break; }
  if (cur !== S.cur){ S.cur = cur; $('#pageIn').value = cur; markThumb(); }
}
function goToPage(n, smooth){
  n = clamp(n, 1, S.n || 1); const p = S.pages[n - 1]; if (!p) return;
  $('#viewer').scrollTop = p.el.offsetTop - 10; S.cur = n; $('#pageIn').value = n; markThumb(); updateVisible();
}
let rafScroll = 0;
$('#viewer').addEventListener('scroll', () => { if (rafScroll) return; rafScroll = requestAnimationFrame(() => { rafScroll = 0; updateVisible(); }); });
window.addEventListener('resize', () => { if (S.doc && S.zoomMode !== 'num') applyZoom(true); });

/* ---------- Miniature, indice ---------- */
let thumbObs = null, thumbQ = Promise.resolve();
function buildThumbs(){
  const box = $('#tab-thumbs'); box.innerHTML = '';
  if (thumbObs) thumbObs.disconnect();
  const ver = S.ver;
  thumbObs = new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return; const p = S.pages[en.target.dataset.n - 1]; if (!p || p.thumbDone) return; p.thumbDone = true;
    thumbQ = thumbQ.then(async () => {
      if (ver !== S.ver) return;
      try {
        const pg = await S.doc.getPage(p.num), c = p.thumbC, vp = pg.getViewport({scale: c.width / p.bw});
        c.height = Math.round(vp.height);
        await pg.render({canvasContext: c.getContext('2d'), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS}).promise;
      } catch(e){}
    });
  }), {root: box, rootMargin: '300px'});
  S.pages.forEach(p => {
    const d = el('div', 'thumb'); d.dataset.n = p.num;
    const c = el('canvas'); c.width = 140; c.height = Math.round(140 * p.bh / p.bw);
    d.append(c, el('span', null, String(p.num))); d.onclick = () => goToPage(p.num);
    box.append(d); p.thumbD = d; p.thumbC = c; p.thumbDone = false; thumbObs.observe(d);
  });
  markThumb();
}
function markThumb(){
  S.pages.forEach(p => p.thumbD && p.thumbD.classList.toggle('cur', p.num === S.cur));
  const p = S.pages[S.cur - 1];
  if (p && p.thumbD && !$('#tab-thumbs').hidden){
    const box = $('#tab-thumbs'), t = p.thumbD.offsetTop, h = p.thumbD.offsetHeight;
    if (t < box.scrollTop || t + h > box.scrollTop + box.clientHeight) box.scrollTop = t - 20;
  }
}
async function buildOutline(){
  const box = $('#tab-outline'); box.innerHTML = '<div class="empty">Nessun indice in questo documento.</div>';
  let out = null; try { out = await S.doc.getOutline(); } catch(e){}
  if (!out || !out.length) return;
  const mk = items => {
    const ul = el('ul', 'ol');
    items.forEach(it => {
      const li = el('li'); const a = el('a', null, esc(it.title || '(senza titolo)'));
      a.onclick = async () => {
        try {
          let dest = it.dest; if (typeof dest === 'string') dest = await S.doc.getDestination(dest);
          if (dest) goToPage((await S.doc.getPageIndex(dest[0])) + 1);
        } catch(e){}
      };
      li.append(a); if (it.items && it.items.length) li.append(mk(it.items)); ul.append(li);
    });
    return ul;
  };
  box.innerHTML = ''; box.append(mk(out));
}
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  ['thumbs', 'outline', 'annots'].forEach(n => $('#tab-' + n).hidden = n !== t.dataset.tab);
  if (t.dataset.tab === 'thumbs') markThumb();
});

/* ---------- Ricerca ---------- */
function applySearchHighlights(p){
  const q = S.search.q; if (!q || !p.textDivs) return; const ql = q.toLowerCase();
  p.textDivs.forEach(d => {
    const t = d.textContent, tl = t.toLowerCase(); let i = tl.indexOf(ql); if (i < 0) return;
    const frag = document.createDocumentFragment(); let last = 0;
    while (i >= 0){
      frag.append(t.slice(last, i)); const m = document.createElement('mark'); m.textContent = t.slice(i, i + q.length); frag.append(m);
      last = i + q.length; i = tl.indexOf(ql, last);
    }
    frag.append(t.slice(last)); d.textContent = ''; d.append(frag);
  });
}
let searchT = null;
$('#searchIn').addEventListener('input', e => { clearTimeout(searchT); searchT = setTimeout(() => runSearch(e.target.value.trim()), 280); });
$('#searchIn').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); clearTimeout(searchT); if (S.search.q !== e.target.value.trim()) runSearch(e.target.value.trim()); else stepSearch(e.shiftKey ? -1 : 1); } });
$('#sNext').onclick = () => stepSearch(1); $('#sPrev').onclick = () => stepSearch(-1);

async function runSearch(q){
  if (!S.doc) return;
  const ver = ++S.search.ver; S.search = {q, results: [], idx: -1, ver};
  S.pages.forEach(p => { if (p.state === 'done'){ releasePage(p); } });
  if (!q){ $('#sCount').textContent = ''; updateVisible(); return; }
  $('#sCount').textContent = 'Cerco…';
  const ql = q.toLowerCase(), res = [];
  for (let i = 1; i <= S.n; i++){
    if (!S.textCache[i]){
      try { const pg = await S.doc.getPage(i); const tc = await pg.getTextContent(); S.textCache[i] = tc.items.map(it => it.str || ''); } catch(e){ S.textCache[i] = []; }
    }
    if (ver !== S.search.ver) return;
    let nth = 0;
    for (const s of S.textCache[i]){ const sl = s.toLowerCase(); let k = sl.indexOf(ql); while (k >= 0){ res.push({page: i, nth: nth++}); k = sl.indexOf(ql, k + ql.length); } }
  }
  S.search.results = res;
  if (!res.length){ $('#sCount').textContent = 'Nessun risultato'; updateVisible(); return; }
  let start = res.findIndex(r => r.page >= S.cur); if (start < 0) start = 0;
  S.search.idx = start - 1; stepSearch(1);
}
async function stepSearch(d){
  const r = S.search.results; if (!r.length) return;
  S.search.idx = (S.search.idx + d + r.length) % r.length;
  const cur = r[S.search.idx]; $('#sCount').textContent = `${S.search.idx + 1} di ${r.length}`;
  const p = S.pages[cur.page - 1]; goToPage(cur.page);
  for (let k = 0; k < 40 && p.state !== 'done'; k++){ if (p.state === 'idle') renderPage(p); await new Promise(r => setTimeout(r, 60)); }
  p.el.querySelectorAll('mark').forEach((m, i) => m.classList.toggle('cur', i === cur.nth));
  const m = p.el.querySelectorAll('mark')[cur.nth];
  if (m) m.scrollIntoView({block: 'center', inline: 'nearest'});
}

/* ---------- Barra degli strumenti: vista ---------- */
$('#bOpen').onclick = $('#wOpen').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; openFile(f); };
$('#bSide').onclick = () => $('#side').classList.toggle('hidden');
$('#bPrev').onclick = () => goToPage(S.cur - 1);
$('#bNext').onclick = () => goToPage(S.cur + 1);
$('#pageIn').onchange = e => goToPage(parseInt(e.target.value) || 1);
$('#bZoomIn').onclick = () => S.doc && zoomBy(1.2);
$('#bZoomOut').onclick = () => S.doc && zoomBy(1 / 1.2);
$('#zoomSel').onchange = e => {
  if (!S.doc) return; const v = e.target.value;
  if (v === 'width' || v === 'page'){ S.zoomMode = v; applyZoom(true); }
  else if (v[0] !== 'c'){ S.zoomMode = 'num'; S.scale = parseFloat(v); const a = getAnchor(); layoutAll(); S.pages.forEach(releasePage); if (a){ const p = S.pages[a.n-1]; $('#viewer').scrollTop = p.el.offsetTop + a.frac * p.el.offsetHeight; } syncZoomSel(); updateVisible(); }
};
if (window.innerWidth < 760) $('#side').classList.add('hidden');

/* Trascina e rilascia */
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')){ dragDepth++; $('#dropHint').classList.add('show'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').classList.remove('show'); });
window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => {
  dragDepth = 0; $('#dropHint').classList.remove('show');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){ e.preventDefault(); openFile(e.dataTransfer.files[0]); }
});
