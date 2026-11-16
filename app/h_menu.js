
/* =====================================================================
   ESTENSIONI 4: barra dei menu, menu tasto destro, anteprima di stampa,
   Salva / Salva con nome / Chiudi, pannello laterale ridimensionabile
   ===================================================================== */
const D = window.desktop || null;
const click = sel => () => { const b = $(sel); if (b && !b.disabled) b.click(); };
const setZoom = v => { if (!S.doc) return; const s = $('#zoomSel'); s.value = v; s.dispatchEvent(new Event('change')); };
const hasDoc = () => !!S.doc;

/* ---------- Apri / Salva / Salva con nome / Chiudi ---------- */
async function openCmd(){
  if (D && D.openDialog){
    try { const files = await D.openDialog(); for (const f of files || []){ NEXT_PATH = f.path; await loadBytes(new Uint8Array(f.bytes), f.name); } } catch(e){ toast('Impossibile aprire: ' + (e.message || e), true); }
  } else $('#fileIn').click();
}
async function savePdfBytes(){ if (!S.doc || !(await ensureEditable())) return null; toast('Preparo il PDF…'); return await buildPdf(); }
async function saveCmd(){
  if (!S.doc) return;
  if (!(D && D.writeFile && S.path)) return saveAsCmd(true);
  try {
    const out = await savePdfBytes(); if (!out) return;
    await D.writeFile(S.path, out); markClean(); toast('Salvato: ' + S.name);
  } catch(e){ console.error(e); toast('Salvataggio non riuscito: ' + (e && e.message || e), true); }
}
async function saveAsCmd(fromSave){
  if (!S.doc) return;
  try {
    if (D && D.saveAs){
      const out = await savePdfBytes(); if (!out) return;
      const def = S.path ? S.path : (fromSave ? baseName() + '-modificato.pdf' : S.name);
      const r = await D.saveAs(def, out); if (!r) return;
      S.path = r.path; S.name = r.name; const t = TABS.find(x => x.id === ACTIVE); if (t){ t.path = r.path; t.name = r.name; }
      markClean(); toast('Salvato: ' + r.name); return;
    }
    let name = fromSave ? baseName() + '-modificato.pdf' : S.name;
    if (!fromSave){
      name = await askText('Salva con nome', 'Nome del file:', baseName() + '-copia.pdf'); if (name == null) return;
      name = name.trim() || 'documento.pdf'; if (!/\.pdf$/i.test(name)) name += '.pdf';
    }
    const out = await savePdfBytes(); if (!out) return;
    if (await saveFile(name, out, 'application/pdf')){ markClean(); toast('PDF pronto: ' + name); }
  } catch(e){ console.error(e); toast('Errore nel salvataggio: ' + (e && e.message || e), true); }
}
$('#bSave').onclick = () => saveCmd();
function closeCmd(){ if (ACTIVE) closeTab(ACTIVE); }
$('#bOpen').onclick = $('#wOpen').onclick = openCmd;

/* ---------- Operazioni rapide sulla pagina ---------- */
function rotatePage(n, d){ return docOp(async doc => { const p = doc.getPage(n - 1); p.setRotation(degrees(((p.getRotation().angle + d) % 360 + 360) % 360)); }, 'Pagina ruotata (puoi annullare con ↶).'); }
async function deletePage(n){
  if (S.n < 2){ toast('Il documento ha una sola pagina.', true); return; }
  if (!(await askConfirm('Eliminare la pagina ' + n + '?', 'Puoi annullare con ↶.', 'Elimina'))) return;
  docOp(async doc => doc.removePage(n - 1), 'Pagina ' + n + ' eliminata (puoi annullare con ↶).');
}
function blankPage(n){ return docOp(async doc => { const p = doc.getPage(n - 1), {width, height} = p.getSize(); doc.insertPage(n, [width, height]); }, 'Pagina vuota inserita dopo la pagina ' + n + '.'); }
async function gotoAsk(){
  if (!S.doc) return; const v = await askText('Vai alla pagina', `Numero di pagina (1–${S.n}):`, String(S.cur)); if (v == null) return;
  const n = parseInt(v, 10); if (n >= 1 && n <= S.n) goToPage(n); else toast('Numero di pagina non valido.', true);
}
function shapeTool(k){ S.shapeKind = k; setTool('shape'); }

/* ---------- Barra dei menu ---------- */
const SEP = '-';
function menuDef(){
  return [
    ['File', [
      ['📂 Apri…', 'Ctrl+O', openCmd],
      ['🖼️ Crea PDF da immagini…', '', openImgPdf],
      SEP,
      ['💾 Salva', 'Ctrl+S', saveCmd, hasDoc],
      ['💾 Salva con nome…', 'Ctrl+Maiusc+S', () => saveAsCmd(false), hasDoc],
      ['📝 Converti in Word (.docx)…', '', openWordExport, hasDoc],
      ['📤 Esporta / comprimi…', '', openExport, hasDoc],
      SEP,
      ['🏷️ Proprietà del documento…', 'Ctrl+D', openMeta, hasDoc],
      ['🖨️ Stampa…', 'Ctrl+P', openPrintPreview, hasDoc],
      SEP,
      ['✖ Chiudi', 'Ctrl+W', closeCmd, hasDoc],
      D && D.quit ? ['🚪 Esci', 'Ctrl+Q', () => D.quit()] : null
    ]],
    ['Modifica', [
      ['↶ Annulla', 'Ctrl+Z', undo, () => !$('#bUndo').disabled],
      ['↷ Ripeti', 'Ctrl+Y', redo, () => !$('#bRedo').disabled],
      ['🗑️ Elimina elemento selezionato', 'Canc', () => S.sel && delAnn(S.sel), () => !!S.sel],
      SEP,
      ['📋 Copia testo selezionato', 'Ctrl+C', copySel, () => !!selText()],
      SEP,
      ['🔍 Cerca nel documento', 'Ctrl+F', () => $('#searchIn').focus(), hasDoc],
      ['🔎 Cerca in tutti i documenti…', 'Ctrl+Maiusc+F', openFindAll, hasDoc],
      SEP,
      ['✎ Modifica testo', '', () => setTool('edittext'), hasDoc],
      ['⬛ Oscura', '', () => setTool('redact'), hasDoc]
    ]],
    ['Visualizza', [
      ['☰ Pannello laterale', 'F4', () => $('#side').classList.toggle('hidden')],
      SEP,
      ['＋ Ingrandisci', 'Ctrl++', () => S.doc && zoomBy(1.2), hasDoc],
      ['－ Riduci', 'Ctrl+-', () => S.doc && zoomBy(1 / 1.2), hasDoc],
      ['↔ Adatta alla larghezza', '', () => setZoom('width'), hasDoc],
      ['▢ Pagina intera', '', () => setZoom('page'), hasDoc],
      ['100% Dimensione reale', 'Ctrl+0', () => setZoom('1'), hasDoc],
      SEP,
      ['⏮ Prima pagina', 'Home', () => goToPage(1), hasDoc],
      ['◀ Pagina precedente', '', click('#bPrev'), hasDoc],
      ['▶ Pagina successiva', '', click('#bNext'), hasDoc],
      ['⏭ Ultima pagina', 'Fine', () => goToPage(S.n), hasDoc],
      ['#️⃣ Vai alla pagina…', 'Ctrl+G', gotoAsk, hasDoc],
      SEP,
      ['📖 Due pagine affiancate', '', click('#bSpread')],
      ['☀️ Aspetto normale', '', () => setTheme(0)],
      ['🌙 Aspetto notte', '', () => setTheme(1)],
      ['🟤 Aspetto seppia', '', () => setTheme(2)],
      ['🔷 Evidenzia campi del modulo', '', click('#bFields'), hasDoc],
      SEP,
      ['⛶ Schermo intero', 'F11', click('#bFull')],
      ['▶️ Presentazione', 'F5', startPresentation, hasDoc],
      ['🔊 Leggi ad alta voce', '', click('#bTts'), hasDoc]
    ]],
    ['Commenti', [
      ['🖱️ Seleziona', 'Esc', () => setTool('select')],
      ['🖍️ Evidenzia testo', '', () => setTool('highlight'), hasDoc],
      ['U̲ Sottolinea testo', '', () => setTool('underline'), hasDoc],
      ['S̶ Barra testo', '', () => setTool('strike'), hasDoc],
      SEP,
      ['📝 Nota', '', () => setTool('note'), hasDoc],
      ['🅣 Casella di testo', '', () => setTool('text'), hasDoc],
      ['✏️ Penna (a mano libera)', '', () => setTool('pen'), hasDoc],
      SEP,
      ['▭ Rettangolo', '', () => shapeTool('rect'), hasDoc],
      ['◯ Ellisse', '', () => shapeTool('ellipse'), hasDoc],
      ['╱ Linea', '', () => shapeTool('line'), hasDoc],
      ['➜ Freccia', '', () => shapeTool('arrow'), hasDoc],
      SEP,
      ['🖼️ Inserisci immagine…', '', () => setTool('picture'), hasDoc],
      ['🔖 Timbri…', '', () => setTool('stamp'), hasDoc]
    ]],
    ['Compila e firma', [
      ['✍️ Firma (disegna, scrivi o carica immagine)…', '', () => { S.tool = 'select'; openSignModal(() => { setTool('sign'); toast('Firma pronta: clicca sulla pagina per inserirla.'); }); }, hasDoc],
      ['📌 Inserisci la firma attuale', '', () => setTool('sign'), () => hasDoc() && !!S.sig],
      ['🔖 Timbri e firme salvate…', '', openStampModal, hasDoc],
      SEP,
      ['🔏 Firma digitale con certificato…', '', openCert, hasDoc]
    ]],
    ['Pagine', [
      ['🗂️ Organizza pagine…', '', click('#bOrg'), hasDoc],
      ['↻ Ruota pagina a destra', '', () => rotatePage(S.cur, 90), hasDoc],
      ['↺ Ruota pagina a sinistra', '', () => rotatePage(S.cur, -90), hasDoc],
      ['➕ Inserisci pagina vuota dopo questa', '', () => blankPage(S.cur), hasDoc],
      ['🗑️ Elimina questa pagina', '', () => deletePage(S.cur), hasDoc],
      SEP,
      ['✂️ Ritaglia', '', () => setTool('crop'), hasDoc],
      ['💧 Filigrana e numeri di pagina…', '', openMark, hasDoc]
    ]],
    ['Strumenti', [
      ['🔍 OCR – rendi ricercabile', '', openOcr, hasDoc],
      ['📝 Converti in Word (.docx)…', '', openWordExport, hasDoc],
      ['🔀 Confronta con un altro PDF…', '', openCompare, hasDoc],
      ['📤 Esporta immagini / testo, comprimi…', '', openExport, hasDoc],
      ['🖼️ Crea PDF da immagini…', '', openImgPdf]
    ]],
    ['?', [
      ['⌨️ Scorciatoie da tastiera', '', showShortcuts],
      D && D.checkUpdates ? ['🔄 Controlla aggiornamenti…', '', () => D.checkUpdates()] : null,
      ['🌐 Pagina del progetto su GitHub', '', () => { const u = 'https://github.com/AntonelloBurtoneAIEngineer/Programma-PDF'; if (D && D.openExternal) D.openExternal(u); else window.open(u, '_blank', 'noopener'); }],
      SEP,
      ['ℹ️ Informazioni su Lyonel Burton', '', click('#bAbout')]
    ]]
  ];
}
let MENU_OPEN = null;
function fillMenu(box, items){
  box.innerHTML = '';
  items.filter(Boolean).forEach(it => {
    if (it === SEP){ box.append(el('div', 'msep')); return; }
    const [label, key, fn, en] = it, ok = !en || en();
    const b = el('button', 'mitem', `<span>${label}</span><kbd>${key || ''}</kbd>`); b.disabled = !ok;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.onclick = () => { closeMenus(); closeCtx(); try { fn(); } catch(e){ console.error(e); } };
    box.append(b);
  });
}
function buildMenubar(){
  const bar = $('#menubar'); bar.innerHTML = '';
  menuDef().forEach(([title], i) => {
    const t = el('button', 'mtop', title); t.dataset.i = i;
    t.addEventListener('mousedown', e => e.preventDefault());
    t.onclick = e => { e.stopPropagation(); if (MENU_OPEN === i) closeMenus(); else openMenu(i); };
    t.onmouseenter = () => { if (MENU_OPEN != null && MENU_OPEN !== i) openMenu(i); };
    bar.append(t);
  });
  const dd = el('div', 'dmenu'); dd.id = 'menuDrop'; dd.hidden = true; document.body.append(dd);
}
function openMenu(i){
  closeCtx(); MENU_OPEN = i; const t = $(`#menubar .mtop[data-i="${i}"]`), dd = $('#menuDrop');
  $$('#menubar .mtop').forEach(x => x.classList.toggle('on', x === t));
  fillMenu(dd, menuDef()[i][1]); dd.hidden = false;
  const r = t.getBoundingClientRect(); dd.style.left = Math.min(r.left, window.innerWidth - dd.offsetWidth - 6) + 'px'; dd.style.top = r.bottom + 'px';
}
function closeMenus(){ MENU_OPEN = null; const dd = $('#menuDrop'); if (dd) dd.hidden = true; $$('#menubar .mtop').forEach(x => x.classList.remove('on')); }
document.addEventListener('mousedown', e => { if (!e.target.closest('#menuDrop') && !e.target.closest('#menubar')) closeMenus(); if (!e.target.closest('#ctxMenu')) closeCtx(); }, true);
window.addEventListener('blur', () => { closeMenus(); closeCtx(); });
window.addEventListener('resize', () => { closeMenus(); closeCtx(); });
function showShortcuts(){
  const rows = [['Ctrl+O', 'Apri'], ['Ctrl+S', 'Salva'], ['Ctrl+Maiusc+S', 'Salva con nome'], ['Ctrl+P', 'Stampa (con anteprima)'], ['Ctrl+W', 'Chiudi il documento'],
    ['Ctrl+Z / Ctrl+Y', 'Annulla / Ripeti'], ['Canc', 'Elimina l\'elemento selezionato'], ['Ctrl+F', 'Cerca'], ['Ctrl+Maiusc+F', 'Cerca in tutti i documenti'],
    ['Ctrl+G', 'Vai alla pagina'], ['Ctrl + rotellina / Ctrl+ +/-', 'Zoom'], ['Ctrl+0', 'Dimensione reale'], ['F4', 'Pannello laterale'], ['F5', 'Presentazione'],
    ['F11', 'Schermo intero'], ['Ctrl+V', 'Incolla un\'immagine nella pagina'], ['Tasto destro', 'Menu rapido sulla pagina'], ['Esc', 'Torna a «Seleziona»']];
  const b = showModal(`<h2>Scorciatoie da tastiera</h2><table class="kbtable">${rows.map(r => `<tr><td><kbd>${r[0]}</kbd></td><td>${r[1]}</td></tr>`).join('')}</table>
    <div class="mrow"><button class="tb primary" id="kbOk">Chiudi</button></div>`);
  b.querySelector('#kbOk').onclick = closeModal;
}

/* ---------- Menu tasto destro ---------- */
const selText = () => { const s = window.getSelection(); return s && !s.isCollapsed && $('#pages').contains(s.anchorNode) ? s.toString().trim() : ''; };
async function copySel(){ const t = selText(); if (!t) return; try { await navigator.clipboard.writeText(t); } catch(e){ document.execCommand('copy'); } toast('Testo copiato.'); }
function closeCtx(){ const m = $('#ctxMenu'); if (m) m.hidden = true; }
function addNoteAt(p, fx, fy){ const a = {id: uid(), type: 'note', page: p.num, x: fx, y: fy, text: '', color: S.toolColor.note, fresh: true}; addAnn(a); setTool('select'); selectAnn(a.id); setTimeout(() => { if (getAnn(a.id)) openNote(a); }, 80); }
function addTextAt(p, fx, fy){
  const a = {id: uid(), type: 'text', page: p.num, x: Math.min(fx, .7), y: Math.min(fy, .95), w: .3, size: S.textSize, color: S.toolColor.text, text: '', fresh: true};
  addAnn(a); setTool('select'); selectAnn(a.id); setTimeout(() => { const d = document.querySelector(`.atext[data-id="${a.id}"]`); if (d && getAnn(a.id)) startTextEdit(d, a); }, 80);
}
function addSigAt(p, fx, fy){
  const put = () => { const pr = p.el.getBoundingClientRect(), sg = S.sig, w = .25, h = w * pr.width / sg.ar / pr.height;
    const a = {id: uid(), type: 'image', page: p.num, x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, ar: sg.ar, data: sg.data}; addAnn(a); setTool('select'); selectAnn(a.id); };
  if (S.sig) put(); else openSignModal(put);
}
function addPicAt(p, fx, fy){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { const pic = await imageFromFile(f); S.pic = pic; insertPicAt(pic, p.num, fx, fy); } catch(e){ toast(e.message || String(e), true); } };
  inp.click();
}
$('#viewer').addEventListener('contextmenu', e => {
  if (!S.doc || e.target.closest('input,textarea,select,.atext.editing')) return;
  const pe = e.target.closest('.page'); if (!pe) return;
  e.preventDefault(); closeMenus();
  const p = pageOf(parseInt(pe.dataset.n)), r = pe.getBoundingClientRect(), fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp((e.clientY - r.top) / r.height, 0, 1);
  const t = e.target.closest('[data-id]'), ann = t && getAnn(t.dataset.id), txt = selText(), n = p.num, items = [];
  if (ann){
    selectAnn(ann.id);
    if (ann.type === 'note') items.push(['💬 Modifica nota', '', () => openNote(ann)]);
    if (ann.type === 'text') items.push(['✎ Modifica testo', '', () => { const d = document.querySelector(`.atext[data-id="${ann.id}"]`); if (d) startTextEdit(d, ann); }]);
    items.push(['🗑️ Elimina', 'Canc', () => delAnn(ann.id)], SEP);
  }
  if (txt){
    const short = txt.length > 24 ? txt.slice(0, 24) + '…' : txt;
    items.push(['📋 Copia', 'Ctrl+C', copySel],
      ['🖍️ Evidenzia', '', () => { setTool('highlight'); setTool('select'); }],
      ['U̲ Sottolinea', '', () => { setTool('underline'); setTool('select'); }],
      ['S̶ Barra', '', () => { setTool('strike'); setTool('select'); }],
      [`🔍 Cerca «${esc(short)}»`, '', () => { $('#searchIn').value = txt; runSearch(txt); }], SEP);
  }
  items.push(['📝 Aggiungi nota qui', '', () => addNoteAt(p, fx, fy)],
    ['🅣 Aggiungi testo qui', '', () => addTextAt(p, fx, fy)],
    ['✍️ Inserisci firma qui', '', () => addSigAt(p, fx, fy)],
    ['🖼️ Inserisci immagine qui…', '', () => addPicAt(p, fx, fy)],
    SEP,
    [`↻ Ruota pagina ${n} a destra`, '', () => rotatePage(n, 90)],
    [`↺ Ruota pagina ${n} a sinistra`, '', () => rotatePage(n, -90)],
    [`➕ Inserisci pagina vuota dopo la ${n}`, '', () => blankPage(n)],
    [`🗑️ Elimina pagina ${n}`, '', () => deletePage(n), () => S.n > 1],
    SEP,
    ['＋ Ingrandisci', '', () => zoomBy(1.2)], ['－ Riduci', '', () => zoomBy(1 / 1.2)],
    ['🖨️ Stampa…', 'Ctrl+P', openPrintPreview],
    ['🏷️ Proprietà del documento…', '', openMeta]);
  const m = $('#ctxMenu'); fillMenu(m, items); m.hidden = false;
  m.style.left = Math.min(e.clientX, window.innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 6) + 'px';
});

/* ---------- Anteprima di stampa ---------- */
async function openPrintPreview(){
  if (!needDoc()) return;
  let pdf, own = false;
  try { const bytes = (S.anns.length || S.touched.size) ? await commitEdits() : S.bytes; pdf = bytes === S.bytes ? S.doc : await openPdf(bytes).promise; own = pdf !== S.doc; }
  catch(e){ toast('Errore: ' + (e.message || e), true); return; }
  const b = showModal(`<div class="mhead"><h2>🖨️ Stampa</h2><button class="tb" id="ppX">Annulla</button><button class="tb primary" id="ppGo">Stampa</button></div>
    <div class="ppwrap"><div class="ppopts">
      <label><input type="radio" name="ppr" value="all" checked> Tutte le pagine (${pdf.numPages})</label>
      <label><input type="radio" name="ppr" value="cur"> Pagina corrente (${S.cur})</label>
      <label><input type="radio" name="ppr" value="range"> Pagine: <input type="text" id="ppRange" placeholder="es. 1-3,5" size="9"></label>
      <hr><label>Orientamento<select id="ppOr"><option value="auto">Automatico</option><option value="portrait">Verticale</option><option value="landscape">Orizzontale</option></select></label>
      <label>Qualità<select id="ppQ"><option value="110">Bozza</option><option value="150" selected>Normale</option><option value="220">Alta</option></select></label>
      <label><input type="checkbox" id="ppGray"> Scala di grigi</label>
      <p class="muted" id="ppInfo" style="font-size:12.5px"></p>
      <p class="muted" style="font-size:12px">Annotazioni, firme e campi compilati vengono stampati. Stampante e numero di copie si scelgono nella finestra successiva.</p>
    </div><div class="ppview"><div class="ppnav"><button class="tb icon" id="ppPrev" title="Pagina precedente">◀</button><span id="ppPg"></span><button class="tb icon" id="ppNext" title="Pagina successiva">▶</button></div><div class="ppstage" id="ppStage"></div></div></div>`, true);
  let token = 0, closed = false;
  const cleanup = () => { closed = true; if (own) pdf.destroy(); };
  const sel = () => { const v = b.querySelector('input[name=ppr]:checked').value;
    if (v === 'cur') return [S.cur]; if (v === 'range') return parsePages(b.querySelector('#ppRange').value, pdf.numPages); return Array.from({length: pdf.numPages}, (_, i) => i + 1); };
  let pv = 0, pvPages = [];
  const showPv = async () => {
    const stage = b.querySelector('#ppStage'), tok = ++token;
    if (!pvPages.length){ stage.innerHTML = ''; b.querySelector('#ppPg').textContent = ''; return; }
    pv = clamp(pv, 0, pvPages.length - 1); const n = pvPages[pv];
    b.querySelector('#ppPg').textContent = `Pagina ${n} (${pv + 1} di ${pvPages.length})`;
    b.querySelector('#ppPrev').disabled = pv === 0; b.querySelector('#ppNext').disabled = pv >= pvPages.length - 1;
    const pg = await pdf.getPage(n), v1 = pg.getViewport({scale: 1}), dpr = window.devicePixelRatio || 1;
    const k = Math.min((stage.clientWidth - 30) / v1.width, (stage.clientHeight - 30) / v1.height), cv = await renderCanvas(pdf, n, Math.max(.2, k) * dpr);
    if (closed || tok !== token) return;
    cv.style.width = (cv.width / dpr) + 'px'; cv.style.height = (cv.height / dpr) + 'px';
    if (b.querySelector('#ppGray').checked) cv.style.filter = 'grayscale(1)';
    stage.innerHTML = ''; stage.append(cv);
  };
  const preview = () => {
    const pages = sel();
    if (!pages || !pages.length){ b.querySelector('#ppInfo').textContent = 'Indica le pagine così: 1-3,5'; pvPages = []; showPv(); return; }
    b.querySelector('#ppInfo').textContent = `${pages.length} pagin${pages.length > 1 ? 'e' : 'a'} da stampare.`;
    const curN = pvPages[pv]; pvPages = pages; pv = Math.max(0, pages.indexOf(curN)); showPv();
  };
  b.querySelector('#ppPrev').onclick = () => { pv--; showPv(); }; b.querySelector('#ppNext').onclick = () => { pv++; showPv(); };
  b.querySelector('#ppStage').addEventListener('wheel', e => { if (Math.abs(e.deltaY) < 20) return; e.preventDefault(); pv += e.deltaY > 0 ? 1 : -1; showPv(); }, {passive: false});
  b.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' && e.target.type === 'text') return; if (e.key === 'ArrowRight' || e.key === 'PageDown'){ pv++; showPv(); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp'){ pv--; showPv(); } });
  b.querySelectorAll('input[name=ppr],#ppGray').forEach(x => x.onchange = preview);
  b.querySelector('#ppRange').oninput = debounce(() => { b.querySelector('input[value=range]').checked = true; preview(); }, 400);
  b.querySelector('#ppX').onclick = () => { cleanup(); closeModal(); window.removeEventListener('resize', onRs); };
  const onRs = debounce(() => { if (!closed) showPv(); }, 150); window.addEventListener('resize', onRs);
  b.querySelector('#ppGo').onclick = async () => {
    const pages = sel(); if (!pages || !pages.length){ toast('Indica le pagine così: 1-3,5', true); return; }
    const dpi = +b.querySelector('#ppQ').value, gray = b.querySelector('#ppGray').checked, or = b.querySelector('#ppOr').value;
    b.querySelector('#ppGo').disabled = true; toast('Preparo la stampa…');
    try {
      let area = $('#printArea'); if (!area){ area = el('div'); area.id = 'printArea'; document.body.append(area); } area.innerHTML = '';
      let land = 0;
      for (const n of pages){ const cv = await renderCanvas(pdf, n, dpi / 72); if (cv.width > cv.height) land++; if (gray) cv.style.filter = 'grayscale(1)'; area.append(cv); }
      const orient = or === 'auto' ? (land > pages.length / 2 ? 'landscape' : 'portrait') : or;
      let st = $('#printOrient'); if (!st){ st = document.createElement('style'); st.id = 'printOrient'; document.head.append(st); }
      st.textContent = `@page{size:${orient};margin:0}`;
      cleanup(); closeModal();
      window.addEventListener('afterprint', () => { area.innerHTML = ''; }, {once: true});
      setTimeout(() => window.print(), 50);
    } catch(e){ console.error(e); toast('Stampa non riuscita: ' + (e.message || e), true); b.querySelector('#ppGo').disabled = false; }
  };
  preview();
}
$('#bPrint').onclick = openPrintPreview;

/* ---------- Pannello laterale ridimensionabile ---------- */
(function sideGrip(){
  const g = $('#sideGrip'), side = $('#side');
  const setW = w => { side.style.width = clamp(w, 150, Math.min(560, window.innerWidth * .6)) + 'px'; };
  const w0 = LS.get('sideW', 0); if (w0) setW(w0);
  const sync = () => { g.hidden = side.classList.contains('hidden'); };
  new MutationObserver(sync).observe(side, {attributes: true, attributeFilter: ['class']}); sync();
  g.addEventListener('pointerdown', e => {
    e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('drag'); const x0 = e.clientX, start = side.getBoundingClientRect().width;
    const mv = ev => setW(start + ev.clientX - x0);
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.classList.remove('drag');
      LS.set('sideW', side.getBoundingClientRect().width); if (S.doc && S.zoomMode !== 'num') applyZoom(true); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });
  g.ondblclick = () => { side.style.width = ''; LS.set('sideW', 0); if (S.doc && S.zoomMode !== 'num') applyZoom(true); };
})();

/* ---------- Scorciatoie ---------- */
document.addEventListener('keydown', e => {
  const typing = /input|textarea|select/i.test(e.target.tagName || '') || e.target.isContentEditable;
  if (e.key === 'Escape'){ closeMenus(); closeCtx(); }
  if (e.key === 'F4'){ e.preventDefault(); $('#side').classList.toggle('hidden'); return; }
  if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase();
  if (k === 's'){ e.preventDefault(); if (e.shiftKey) saveAsCmd(false); else saveCmd(); }
  else if (k === 'w'){ e.preventDefault(); closeCmd(); }
  else if (k === 'q' && D && D.quit){ e.preventDefault(); D.quit(); }
  else if (k === 'g' && !typing){ e.preventDefault(); gotoAsk(); }
  else if (k === 'd' && !typing){ e.preventDefault(); openMeta(); }
  else if (k === '0' && !typing){ e.preventDefault(); setZoom('1'); }
}, true);

buildMenubar();
