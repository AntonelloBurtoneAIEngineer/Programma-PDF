
/* =====================================================================
   ESTENSIONI 6: aggiungere PDF e immagini al documento, trascinare
   schede e file nel pannello Pagine, unire tutti i documenti aperti
   ===================================================================== */
const isPdfFile = f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
const isImgFile = f => /^image\//.test(f.type);

/* Converte delle immagini in un PDF (una pagina per immagine) */
async function imagesPdfBytes(files, refSize){
  const doc = await PDFDocument.create();
  for (const f of files){
    const pic = await imageFromFile(f), im = /^data:image\/jpe?g/i.test(pic.data) ? await doc.embedJpg(pic.data) : await doc.embedPng(pic.data);
    let [a, b] = refSize || [595.28, 841.89]; if (a > b) [a, b] = [b, a];
    const [pw, ph] = pic.ar > 1 ? [b, a] : [a, b], k = Math.min(pw / im.width, ph / im.height), w = im.width * k, h = im.height * k;
    doc.addPage([pw, ph]).drawImage(im, {x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h});
  }
  return await doc.save();
}
const refSize = () => { try { const p = S.pages[0]; return p ? [p.bw, p.bh] : null; } catch(e){ return null; } };

/* Prepara le sorgenti (PDF, immagini) come elenco di {name, bytes} */
async function sourcesFromFiles(files){
  const out = [], imgs = [];
  for (const f of files){
    if (isPdfFile(f)) out.push({name: f.name, bytes: new Uint8Array(await f.arrayBuffer())});
    else if (isImgFile(f)) imgs.push(f);
  }
  if (imgs.length) out.push({name: imgs.length === 1 ? imgs[0].name : imgs.length + ' immagini', bytes: await imagesPdfBytes(imgs, refSize()), img: true});
  return out;
}

/* Inserisce le pagine delle sorgenti nel documento attivo, dalla posizione «at» (0 = all'inizio) */
async function insertSources(at, sources){
  if (!S.doc || !sources.length) return;
  const loaded = [];
  for (const s of sources){
    try {
      const task = openPdf(s.bytes); let locked = false; task.onPassword = () => { locked = true; task.destroy(); };
      try { const p = await task.promise; p.destroy(); } catch(e){ toast(locked ? `«${s.name}» è protetto da password e non può essere unito.` : `Impossibile leggere «${s.name}».`, true); continue; }
      loaded.push(Object.assign({doc: await PDFDocument.load(s.bytes, {ignoreEncryption: true, updateMetadata: false})}, s));
    } catch(e){ toast(`Impossibile leggere «${s.name}».`, true); }
  }
  if (!loaded.length) return;
  let added = 0; const names = loaded.map(s => s.name);
  const ok = await docOp(async doc => {
    let pos = clamp(at, 0, doc.getPageCount());
    for (const s of loaded){
      const pages = await doc.copyPages(s.doc, s.doc.getPageIndices());
      for (const pg of pages){ doc.insertPage(pos++, pg); added++; }
    }
  }, 'Pagine aggiunte.');
  if (ok){ toast(`Aggiunte ${added} pagin${added === 1 ? 'a' : 'e'} da ${names.length === 1 ? '«' + names[0] + '»' : names.length + ' file'} (puoi annullare con ↶).`); setTimeout(() => goToPage(Math.min(S.n, at + 1)), 150); }
}
function pickAndInsert(at, kind){
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
  inp.accept = kind === 'img' ? 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml' : kind === 'pdf' ? 'application/pdf,.pdf' : 'application/pdf,.pdf,image/*';
  inp.onchange = async () => { if (!inp.files.length) return; try { insertSources(at, await sourcesFromFiles([...inp.files])); } catch(e){ toast('Errore: ' + (e.message || e), true); } };
  inp.click();
}
function tabSource(t){
  if (t.id === ACTIVE) return null;
  if (t.encrypted){ toast(`«${t.name}» è protetto da password e non può essere unito.`, true); return null; }
  if (t.dirty) toast(`Nota: le annotazioni non salvate di «${t.name}» non vengono incluse.`);
  return {name: t.name, bytes: t.bytes};
}
function insertTab(at, id){ snapTab(); const t = TABS.find(x => x.id === id), s = t && tabSource(t); if (s) insertSources(at, [s]); }

/* Unisce tutti i documenti aperti in un nuovo PDF */
async function mergeAllTabs(){
  if (TABS.length < 2){ toast('Apri almeno due PDF (compaiono come schede in alto).', true); return; }
  snapTab();
  const ok = await askConfirm('Unire tutti i documenti aperti?', `Le pagine dei ${TABS.length} documenti verranno unite in un nuovo PDF, nell'ordine delle schede. I documenti originali non vengono modificati.`, 'Unisci');
  if (!ok) return;
  try {
    toast('Unisco i documenti…'); const out = await PDFDocument.create(); let n = 0;
    for (const t of TABS){
      if (t.encrypted){ toast(`«${t.name}» è protetto da password: saltato.`, true); continue; }
      const bytes = t.id === ACTIVE ? await commitEdits() : t.bytes, src = await PDFDocument.load(bytes, {ignoreEncryption: true, updateMetadata: false});
      for (const pg of await out.copyPages(src, src.getPageIndices())){ out.addPage(pg); n++; }
    }
    out.setTitle('Documenti uniti'); out.setCreator('Lyonel Burton');
    const bytes = await out.save(); await loadBytes(bytes, 'documenti-uniti.pdf'); S.clean = 'nuovo'; renderTabs(); updTitle();
    toast(`Creato «documenti-uniti.pdf» con ${n} pagine: premi «Salva» per salvarlo.`);
  } catch(e){ console.error(e); toast('Errore: ' + (e.message || e), true); }
}

/* ---------- Pannello Pagine: tasto destro nella zona vuota ---------- */
$('#tab-thumbs').addEventListener('contextmenu', e => {
  if (e.target.closest('.thumb') || !S.doc) return;
  e.preventDefault(); closeMenus();
  const others = TABS.filter(t => t.id !== ACTIVE);
  const items = [
    ['📄 Aggiungi PDF in fondo…', '', () => pickAndInsert(S.n, 'pdf')],
    ['🖼️ Aggiungi immagine in fondo…', '', () => pickAndInsert(S.n, 'img')],
    ['📄 Aggiungi PDF all\'inizio…', '', () => pickAndInsert(0, 'pdf')],
    ['🖼️ Aggiungi immagine all\'inizio…', '', () => pickAndInsert(0, 'img')],
    ['➕ Aggiungi pagina vuota in fondo', '', () => blankPage(S.n)]
  ];
  if (others.length){
    items.push(SEP); others.forEach(t => items.push([`📑 Aggiungi in fondo le pagine di «${esc(t.name.length > 30 ? t.name.slice(0, 30) + '…' : t.name)}»`, '', () => insertTab(S.n, t.id)]));
    items.push(['🧩 Unisci tutti i documenti aperti in un nuovo PDF…', '', mergeAllTabs]);
  }
  items.push(SEP, ['🗂️ Organizza pagine…', '', () => $('#bOrg').click()]);
  const m = $('#ctxMenu'); fillMenu(m, items); m.hidden = false;
  m.style.left = Math.min(e.clientX, window.innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 6) + 'px';
});
/* Voci aggiuntive sul tasto destro di una miniatura */
$('#tab-thumbs').addEventListener('contextmenu', e => {
  const t = e.target.closest('.thumb'); if (!t || !S.doc) return;
  const n = parseInt(t.dataset.n, 10), m = $('#ctxMenu'), ref = [...m.querySelectorAll('.mitem')].find(b => /Inserisci pagina vuota/.test(b.textContent)); if (!ref) return;
  const mk = (label, fn) => { const b = el('button', 'mitem', `<span>${label}</span><kbd></kbd>`); b.addEventListener('mousedown', ev => ev.preventDefault()); b.onclick = () => { closeMenus(); closeCtx(); fn(); }; return b; };
  ref.after(mk('🖼️ Inserisci immagine dopo questa pagina…', () => pickAndInsert(n, 'img')));
  ref.after(mk('📄 Inserisci PDF dopo questa pagina…', () => pickAndInsert(n, 'pdf')));
  m.style.top = Math.min(parseFloat(m.style.top), window.innerHeight - m.offsetHeight - 6) + 'px';
});

/* ---------- Trascinare schede o file nel pannello Pagine ---------- */
const TAB_MIME = 'application/x-lyonel-tab';
let DRAG_TAB = null;
function dropIndex(e){
  const thumbs = [...$('#tab-thumbs').querySelectorAll('.thumb')]; let idx = thumbs.length;
  for (let i = 0; i < thumbs.length; i++){ const r = thumbs[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2){ idx = i; break; } }
  return {idx, thumbs};
}
function showDropLine(e){
  let line = $('#thumbDrop'); if (!line){ line = el('div'); line.id = 'thumbDrop'; }
  const {idx, thumbs} = dropIndex(e), box = $('#tab-thumbs');
  if (idx < thumbs.length) box.insertBefore(line, thumbs[idx]); else box.append(line);
  line.textContent = idx === 0 ? 'Inserisci all\'inizio' : idx >= thumbs.length ? 'Inserisci in fondo' : `Inserisci dopo la pagina ${idx}`;
}
const hideDropLine = () => { const l = $('#thumbDrop'); if (l) l.remove(); };
const dragKind = e => { const ty = [...(e.dataTransfer ? e.dataTransfer.types : [])]; return ty.includes(TAB_MIME) || DRAG_TAB ? 'tab' : ty.includes('Files') ? 'files' : null; };
const thumbsBox = $('#tab-thumbs');
thumbsBox.addEventListener('dragover', e => {
  const k = dragKind(e); if (!k || !S.doc) return;
  if (k === 'tab' && DRAG_TAB === ACTIVE) return;
  e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy';
  $('#dropHint').classList.remove('show'); showDropLine(e);
});
thumbsBox.addEventListener('dragleave', e => { if (!thumbsBox.contains(e.relatedTarget)) hideDropLine(); });
thumbsBox.addEventListener('drop', async e => {
  const k = dragKind(e); if (!k || !S.doc) return;
  e.preventDefault(); e.stopPropagation(); dragDepth = 0; $('#dropHint').classList.remove('show');
  const {idx} = dropIndex(e); hideDropLine();
  if (k === 'tab'){ const id = (e.dataTransfer.getData(TAB_MIME) || DRAG_TAB); DRAG_TAB = null; if (id && id !== ACTIVE) insertTab(idx, id); return; }
  const files = [...e.dataTransfer.files].filter(f => isPdfFile(f) || isImgFile(f));
  if (!files.length){ toast('Puoi trascinare qui file PDF o immagini.', true); return; }
  try { insertSources(idx, await sourcesFromFiles(files)); } catch(err){ toast('Errore: ' + (err.message || err), true); }
});
document.addEventListener('dragend', () => { DRAG_TAB = null; hideDropLine(); });

/* Le schede diventano trascinabili */
const _renderTabs0 = renderTabs;
renderTabs = function(){
  _renderTabs0();
  const bar = $('#tabbar'), tabs = [...bar.querySelectorAll('.t')];
  TABS.forEach((t, i) => {
    const d = tabs[i]; if (!d) return;
    d.title = t.id === ACTIVE ? 'Documento attivo' : `Trascina questa scheda nel pannello «Pagine» per aggiungere le sue pagine al documento attivo. Tasto destro per altre opzioni.`;
    if (t.id === ACTIVE) return;
    d.draggable = true;
    d.addEventListener('dragstart', e => { DRAG_TAB = t.id; try { e.dataTransfer.setData(TAB_MIME, t.id); e.dataTransfer.setData('text/plain', t.name); } catch(_){} e.dataTransfer.effectAllowed = 'copy'; d.classList.add('dragging'); if ($('#side').classList.contains('hidden')) $('#side').classList.remove('hidden'); });
    d.addEventListener('dragend', () => d.classList.remove('dragging'));
    d.addEventListener('contextmenu', ev => {
      ev.preventDefault(); closeMenus();
      const items = [[`📑 Aggiungi le pagine in fondo a «${esc(S.name)}»`, '', () => insertTab(S.n, t.id), () => !!S.doc],
        [`📑 Aggiungi le pagine all'inizio di «${esc(S.name)}»`, '', () => insertTab(0, t.id), () => !!S.doc],
        ['🧩 Unisci tutti i documenti aperti in un nuovo PDF…', '', mergeAllTabs], SEP,
        ['📂 Passa a questo documento', '', () => switchTab(t.id)], ['✖ Chiudi', '', () => closeTab(t.id)]];
      const m = $('#ctxMenu'); fillMenu(m, items); m.hidden = false;
      m.style.left = Math.min(ev.clientX, window.innerWidth - m.offsetWidth - 6) + 'px'; m.style.top = Math.min(ev.clientY, window.innerHeight - m.offsetHeight - 6) + 'px';
    });
  });
  const act = tabs[TABS.findIndex(t => t.id === ACTIVE)];
  if (act) act.addEventListener('contextmenu', ev => {
    ev.preventDefault(); closeMenus();
    const m = $('#ctxMenu'); fillMenu(m, [['🧩 Unisci tutti i documenti aperti in un nuovo PDF…', '', mergeAllTabs, () => TABS.length > 1], ['✖ Chiudi', 'Ctrl+W', closeCmd]]); m.hidden = false;
    m.style.left = Math.min(ev.clientX, window.innerWidth - m.offsetWidth - 6) + 'px'; m.style.top = Math.min(ev.clientY, window.innerHeight - m.offsetHeight - 6) + 'px';
  });
};

/* ---------- Organizza pagine: aggiungi immagine / pagine dei documenti aperti ---------- */
function orgAddSource(name, bytes){
  return (async () => {
    const task = openPdf(bytes); let locked = false; task.onPassword = () => { locked = true; task.destroy(); };
    let pdf; try { pdf = await task.promise; } catch(e){ toast(locked ? `«${name}» è protetto da password e non può essere unito.` : `Impossibile leggere «${name}».`, true); return; }
    const id = 'x' + uid(); ORG.ext[id] = {name, bytes, pdf, n: pdf.numPages};
    for (let i = 0; i < pdf.numPages; i++) ORG.items.push({key: uid(), src: id, idx: i, rot: 0, sel: false, dup: false});
  })();
}
function orgAddImage(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';
  inp.onchange = async () => {
    for (const f of inp.files){ try { await orgAddSource(f.name, await imagesPdfBytes([f], refSize())); } catch(e){ toast(`«${f.name}»: ${e.message || e}`, true); } }
    drawOrg();
  };
  inp.click();
}
async function orgAddTabs(){
  snapTab(); const others = TABS.filter(t => t.id !== ACTIVE);
  if (!others.length){ toast('Non ci sono altri documenti aperti.', true); return; }
  for (const t of others){ if (t.encrypted){ toast(`«${t.name}» è protetto da password: saltato.`, true); continue; } await orgAddSource(t.name, t.bytes); }
  drawOrg(); toast(`Aggiunte le pagine di ${others.length} document${others.length > 1 ? 'i' : 'o'}: trascinale per riordinarle, poi premi «Applica».`);
}
const _drawOrg0 = drawOrg;
drawOrg = function(){
  const first = !$('#orgGrid'); _drawOrg0();
  if (!first) return;
  const add = $('#oAdd'); if (!add) return;
  add.textContent = '📄 Aggiungi PDF';
  const bi = el('button', 'tb', '🖼️ Aggiungi immagine'); bi.id = 'oAddImg'; bi.onclick = orgAddImage; add.after(bi);
  const bt = el('button', 'tb', '📑 Da documenti aperti'); bt.id = 'oAddTabs'; bt.title = 'Aggiungi le pagine degli altri PDF aperti nelle schede'; bt.onclick = orgAddTabs; bi.after(bt);
  const top = $('.orgTop'); if (top && !$('#orgTitle')){ const h = el('h2', null, '🗂️ Organizza pagine'); h.id = 'orgTitle'; h.style.cssText = 'margin:0 8px 0 0;font-size:17px;width:100%'; top.prepend(h); }
  const body = $('.orgBody'); if (body){
    body.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')){ e.preventDefault(); e.stopPropagation(); $('#dropHint').classList.remove('show'); } });
    body.addEventListener('drop', async e => {
      if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.stopPropagation(); dragDepth = 0; $('#dropHint').classList.remove('show');
      for (const f of e.dataTransfer.files){
        try { if (isPdfFile(f)) await orgAddSource(f.name, new Uint8Array(await f.arrayBuffer())); else if (isImgFile(f)) await orgAddSource(f.name, await imagesPdfBytes([f], refSize())); } catch(err){ toast(`«${f.name}»: ${err.message || err}`, true); }
      }
      drawOrg();
    });
  }
};
