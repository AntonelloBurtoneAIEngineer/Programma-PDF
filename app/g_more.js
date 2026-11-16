
/* =====================================================================
   ESTENSIONI 3: forme (UI), ritaglio, PDF da immagini, proprietà,
   ricerca in tutti i documenti, presentazione
   ===================================================================== */
$('#shapeKind').onchange = e => { if (!e.target.value) return; S.shapeKind = e.target.value; setTool('shape'); };

/* ---------- Ritaglio pagine ---------- */
function startCrop(e, p, layer, pr){
  e.preventDefault(); layer.setPointerCapture(e.pointerId);
  const W = pr.width, H = pr.height, P = ev => [clamp((ev.clientX - pr.left) / W, 0, 1), clamp((ev.clientY - pr.top) / H, 0, 1)];
  const [x0, y0] = P(e); let x1 = x0, y1 = y0; const box = el('div', 'acrop'); layer.append(box);
  const draw = () => { box.style.cssText = `left:${pct(Math.min(x0, x1))};top:${pct(Math.min(y0, y1))};width:${pct(Math.abs(x1 - x0))};height:${pct(Math.abs(y1 - y0))};`; };
  const mv = ev => { [x1, y1] = P(ev); draw(); };
  const up = async () => {
    layer.removeEventListener('pointermove', mv); layer.removeEventListener('pointerup', up); layer.removeEventListener('pointercancel', up);
    const r = {x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0)};
    if (r.w * W < 20 || r.h * H < 20){ box.remove(); return; }
    const b = showModal(`<h2>Ritaglia</h2><p>Resterà visibile solo la zona selezionata. Il contenuto esterno viene nascosto (non cancellato): per eliminarlo davvero usa «Oscura».</p>
      <div class="mrow"><button class="tb" id="crNo">Annulla</button><button class="tb" id="crAll">Tutte le pagine</button><button class="tb primary" id="crOne">Solo pagina ${p.num}</button></div>`);
    const done = () => { box.remove(); setTool('select'); };
    b.querySelector('#crNo').onclick = () => { closeModal(); done(); };
    const apply = pages => { done(); docOp(async doc => {
      for (const n of pages){
        const page = doc.getPage(n - 1), g = pageGeom(page), a = g.to(r.x, r.y), c = g.to(r.x + r.w, r.y + r.h);
        const x = Math.min(a.x, c.x), y = Math.min(a.y, c.y), w = Math.abs(c.x - a.x), h = Math.abs(c.y - a.y);
        page.setCropBox(x, y, w, h); page.setMediaBox(x, y, w, h);
        try { page.node.delete(PDFLib.PDFName.of('TrimBox')); page.node.delete(PDFLib.PDFName.of('BleedBox')); page.node.delete(PDFLib.PDFName.of('ArtBox')); } catch(e){}
      }
    }, pages.length > 1 ? 'Pagine ritagliate (puoi annullare con ↶).' : 'Pagina ritagliata (puoi annullare con ↶).'); };
    b.querySelector('#crOne').onclick = () => apply([p.num]);
    b.querySelector('#crAll').onclick = () => apply(Array.from({length: S.n}, (_, i) => i + 1));
  };
  layer.addEventListener('pointermove', mv); layer.addEventListener('pointerup', up); layer.addEventListener('pointercancel', up);
}

/* ---------- PDF da immagini ---------- */
function openImgPdf(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';
  inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    const b = showModal(`<h2>Crea un PDF da ${files.length} immagin${files.length > 1 ? 'i' : 'e'}</h2>
      <div class="rowgrid"><label>Formato pagina<select id="ipSize"><option value="a4">A4 (orientamento automatico)</option><option value="letter">Lettera USA</option><option value="fit">Come l'immagine</option></select></label>
      <label>Margine<select id="ipMar"><option value="0">Nessuno</option><option value="20" selected>Piccolo</option><option value="40">Medio</option></select></label>
      <label style="grid-column:1/3">Ordine<select id="ipOrd"><option value="sel">Come selezionate</option><option value="name">Per nome del file</option></select></label></div>
      <p class="muted" id="ipMsg"></p><div class="mrow"><button class="tb" id="ipNo">Annulla</button><button class="tb primary" id="ipGo">Crea PDF</button></div>`);
    b.querySelector('#ipNo').onclick = closeModal;
    b.querySelector('#ipGo').onclick = async () => {
      const size = b.querySelector('#ipSize').value, mar = +b.querySelector('#ipMar').value;
      if (b.querySelector('#ipOrd').value === 'name') files.sort((x, y) => x.name.localeCompare(y.name, 'it', {numeric: true}));
      b.querySelector('#ipGo').disabled = true;
      try {
        const doc = await PDFDocument.create(); doc.setTitle(files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Immagini'); doc.setCreator('Lyonel Burton');
        for (let i = 0; i < files.length; i++){
          b.querySelector('#ipMsg').textContent = `Elaboro ${i + 1} di ${files.length}: ${files[i].name}`;
          const pic = await imageFromFile(files[i]);
          const im = /^data:image\/jpe?g/i.test(pic.data) ? await doc.embedJpg(pic.data) : await doc.embedPng(pic.data);
          let pw, ph;
          if (size === 'fit'){ pw = Math.min(im.width * .75, 1440); ph = pw / pic.ar; pw += 2 * mar; ph += 2 * mar; }
          else { const base = size === 'a4' ? [595.28, 841.89] : [612, 792]; [pw, ph] = pic.ar > 1 ? [base[1], base[0]] : base; }
          const aw = pw - 2 * mar, ah = ph - 2 * mar, k = Math.min(aw / im.width, ah / im.height), w = im.width * k, h = im.height * k;
          doc.addPage([pw, ph]).drawImage(im, {x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h});
        }
        const out = await doc.save(); closeModal();
        await loadBytes(out, files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') + '.pdf' : 'immagini.pdf');
        S.clean = undefined; S.clean = 'nuovo'; renderTabs(); updTitle();
        toast('PDF creato: premi «Salva» per scaricarlo.');
      } catch(e){ console.error(e); toast('Errore: ' + (e.message || e), true); b.querySelector('#ipGo').disabled = false; }
    };
  };
  inp.click();
}
$('#bImgPdf').onclick = $('#wImg').onclick = openImgPdf;

/* ---------- Proprietà del documento (metadati) ---------- */
async function openMeta(){
  if (!needDoc()) return;
  let info = {};
  try { const doc = await PDFDocument.load(S.bytes, {ignoreEncryption: true, updateMetadata: false});
    info = {t: doc.getTitle() || '', a: doc.getAuthor() || '', s: doc.getSubject() || '', k: doc.getKeywords() || '', c: doc.getCreator() || '', p: doc.getProducer() || '',
      cd: doc.getCreationDate(), md: doc.getModificationDate()}; } catch(e){}
  const d = x => x ? x.toLocaleString('it-IT') : '–', v = x => esc(x || '');
  const b = showModal(`<h2>Proprietà del documento</h2>
    <div class="rowgrid"><label style="grid-column:1/3">Titolo<input type="text" id="mT" value="${v(info.t)}"></label>
    <label>Autore<input type="text" id="mA" value="${v(info.a)}"></label><label>Oggetto<input type="text" id="mS" value="${v(info.s)}"></label>
    <label style="grid-column:1/3">Parole chiave (separate da virgola)<input type="text" id="mK" value="${v(info.k)}"></label>
    <label>Applicazione<input type="text" id="mC" value="${v(info.c)}"></label><label>Produttore<input type="text" value="${v(info.p)}" disabled></label></div>
    <p class="muted" style="font-size:12.5px">File: ${esc(S.name)} · ${fmtSize(S.bytes.length)} · ${S.n} pagine<br>Creato: ${d(info.cd)} · Modificato: ${d(info.md)}</p>
    <div class="mrow"><button class="tb" id="mNo">Chiudi</button><button class="tb primary" id="mOk">Applica</button></div>`);
  b.querySelector('#mNo').onclick = closeModal;
  b.querySelector('#mOk').onclick = () => {
    const g = id => b.querySelector(id).value.trim();
    const vals = {t: g('#mT'), a: g('#mA'), s: g('#mS'), k: g('#mK'), c: g('#mC')};
    docOp(async doc => {
      doc.setTitle(vals.t, {showInWindowTitleBar: !!vals.t}); doc.setAuthor(vals.a); doc.setSubject(vals.s);
      doc.setKeywords(vals.k ? vals.k.split(/\s*,\s*/).filter(Boolean) : []); doc.setCreator(vals.c); doc.setProducer('Lyonel Burton'); doc.setModificationDate(new Date());
    }, 'Proprietà aggiornate: premi «Salva» per scaricare il file.');
  };
}
$('#bMeta').onclick = openMeta;

/* ---------- Cerca in tutti i documenti aperti ---------- */
async function docTexts(t){
  if (t.textPages && t.textLen === t.bytesLen) return t.textPages;
  const active = t.id === ACTIVE, bytes = active ? S.bytes : t.bytes;
  let pdf, own = false;
  if (active) pdf = S.doc; else { PW_HINT = t.pw; pdf = await openPdf(bytes).promise; own = true; }
  const out = []; for (let n = 1; n <= pdf.numPages; n++) out.push(await pageText(pdf, n));
  if (own) pdf.destroy();
  t.textPages = out; t.textLen = t.bytesLen = bytes.length; return out;
}
function openFindAll(){
  if (!TABS.length){ toast('Apri prima uno o più PDF.', true); return; }
  snapTab();
  const b = showModal(`<h2>Cerca in tutti i documenti aperti</h2>
    <div class="mrow" style="justify-content:flex-start;margin-top:0"><input type="text" id="faQ" placeholder="Parola o frase…" style="flex:1;padding:7px 9px;font:inherit;border:1px solid var(--barline);border-radius:7px">
    <label style="font-size:13px"><input type="checkbox" id="faCase"> Maiuscole/minuscole</label><button class="tb primary" id="faGo">Cerca</button></div>
    <div id="faRes" style="max-height:52vh;overflow:auto;margin-top:8px;font-size:13.5px"></div>
    <div class="mrow"><button class="tb" id="faX">Chiudi</button></div>`);
  const q = b.querySelector('#faQ'), res = b.querySelector('#faRes'); q.value = $('#searchIn').value || ''; setTimeout(() => q.focus(), 30);
  b.querySelector('#faX').onclick = closeModal;
  const go = async () => {
    const term = q.value.trim(); if (!term){ return; } const cs = b.querySelector('#faCase').checked;
    res.innerHTML = '<p class="muted">Cerco…</p>'; let total = 0; const frag = document.createDocumentFragment();
    for (const t of TABS){
      let pages; try { pages = await docTexts(t); } catch(e){ continue; }
      const hits = [];
      pages.forEach((txt, i) => {
        const flat = txt.replace(/\s+/g, ' '), hay = cs ? flat : flat.toLowerCase(), needle = cs ? term : term.toLowerCase(); let pos = hay.indexOf(needle);
        while (pos >= 0 && hits.length < 200){ hits.push({page: i + 1, snip: flat.slice(Math.max(0, pos - 40), pos + needle.length + 40), at: Math.min(40, pos)}); pos = hay.indexOf(needle, pos + needle.length); }
      });
      if (!hits.length) continue; total += hits.length;
      const h = el('div', null, `<b>📄 ${esc(t.id === ACTIVE ? S.name : t.name)}</b> <span class="muted">(${hits.length})</span>`); h.style.margin = '10px 0 4px'; frag.append(h);
      hits.slice(0, 60).forEach(hit => {
        const row = el('div', 'annItem'), pre = hit.snip.slice(0, hit.at), mid = hit.snip.slice(hit.at, hit.at + term.length), post = hit.snip.slice(hit.at + term.length);
        row.innerHTML = `<small>Pagina ${hit.page}</small> …${esc(pre)}<mark>${esc(mid)}</mark>${esc(post)}…`; row.style.cursor = 'pointer';
        row.onclick = async () => { closeModal(); if (t.id !== ACTIVE) await switchTab(t.id); $('#searchIn').value = term; goToPage(hit.page); await new Promise(r => setTimeout(r, 60)); S.cur = hit.page; await runSearch(term); };
        frag.append(row);
      });
    }
    res.innerHTML = total ? '' : '<p class="muted">Nessun risultato in nessun documento.</p>';
    if (total){ const s = el('p', 'muted', `${total} risultati in ${TABS.length} document${TABS.length > 1 ? 'i' : 'o'}.`); res.append(s, frag); }
  };
  b.querySelector('#faGo').onclick = go; q.onkeydown = e => { if (e.key === 'Enter') go(); e.stopPropagation(); };
}
$('#bFindAll').onclick = openFindAll;

/* ---------- Presentazione ---------- */
let PRES = null;
async function startPresentation(){
  if (!needDoc()) return;
  const bytes = isDirty() && (S.anns.length || S.touched.size) ? await commitEdits() : S.bytes;
  const pdf = bytes === S.bytes ? S.doc : await openPdf(bytes).promise;
  const ov = el('div', null, '<canvas></canvas><div class="pinfo"></div>'); ov.id = 'presOv'; document.body.append(ov);
  const cv = ov.querySelector('canvas'), info = ov.querySelector('.pinfo');
  PRES = {pdf, own: pdf !== S.doc, n: S.cur, ov, busy: 0};
  try { await ov.requestFullscreen(); } catch(e){}
  const show = async n => {
    n = clamp(n, 1, pdf.numPages); PRES.n = n; const tok = ++PRES.busy;
    const pg = await pdf.getPage(n), v1 = pg.getViewport({scale: 1}), dpr = window.devicePixelRatio || 1;
    const k = Math.min(window.innerWidth / v1.width, window.innerHeight / v1.height), vp = pg.getViewport({scale: k * dpr});
    const off = document.createElement('canvas'); off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
    await pg.render({canvasContext: off.getContext('2d'), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE}).promise;
    if (!PRES || tok !== PRES.busy) return;
    cv.width = off.width; cv.height = off.height; cv.style.width = (off.width / dpr) + 'px'; cv.style.height = (off.height / dpr) + 'px';
    cv.getContext('2d').drawImage(off, 0, 0);
    info.textContent = `${n} / ${pdf.numPages}  ·  ← → per cambiare pagina, Esc per uscire`; info.classList.remove('hide');
    clearTimeout(PRES.it); PRES.it = setTimeout(() => info.classList.add('hide'), 2200);
  };
  PRES.show = show;
  PRES.key = e => {
    if (!PRES) return; const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)){ e.preventDefault(); show(PRES.n + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)){ e.preventDefault(); show(PRES.n - 1); }
    else if (k === 'Home'){ e.preventDefault(); show(1); } else if (k === 'End'){ e.preventDefault(); show(pdf.numPages); }
    else if (k === 'Escape'){ e.preventDefault(); stopPresentation(); }
    e.stopPropagation();
  };
  document.addEventListener('keydown', PRES.key, true);
  ov.onclick = e => show(PRES.n + (e.clientX < window.innerWidth / 3 ? -1 : 1));
  ov.oncontextmenu = e => { e.preventDefault(); show(PRES.n - 1); };
  PRES.fs = () => { if (!document.fullscreenElement && PRES) stopPresentation(); };
  document.addEventListener('fullscreenchange', PRES.fs);
  PRES.rs = debounce(() => PRES && show(PRES.n), 150); window.addEventListener('resize', PRES.rs);
  show(PRES.n);
}
function stopPresentation(){
  if (!PRES) return; const P = PRES; PRES = null;
  document.removeEventListener('keydown', P.key, true); document.removeEventListener('fullscreenchange', P.fs); window.removeEventListener('resize', P.rs);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  P.ov.remove(); if (P.own) P.pdf.destroy(); goToPage(P.n);
}
$('#bPres').onclick = startPresentation;
document.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === 'F5'){ e.preventDefault(); if (!PRES) startPresentation(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f'){ e.preventDefault(); openFindAll(); }
});

/* ---------- Aggiornamenti (versione desktop) ---------- */
if (window.desktop && window.desktop.onUpdate) window.desktop.onUpdate(info => {
  const b = showModal(`<h2>È disponibile una nuova versione</h2><p>Lyonel Burton <b>${esc(info.latest)}</b> è disponibile (tu hai la ${esc(info.current)}).</p>
    ${info.notes ? `<div class="sect" style="max-height:30vh;overflow:auto;white-space:pre-wrap;font-size:13px">${esc(info.notes)}</div>` : ''}
    <div class="mrow"><button class="tb" id="upLater">Più tardi</button><button class="tb primary" id="upGo">Scarica</button></div>`);
  b.querySelector('#upLater').onclick = closeModal;
  b.querySelector('#upGo').onclick = () => { window.desktop.openExternal(info.url); closeModal(); };
});
