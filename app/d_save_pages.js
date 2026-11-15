
/* =====================================================================
   SALVATAGGIO: applica annotazioni e campi al PDF con pdf-lib
   ===================================================================== */
const hex2rgb = h => { const n = parseInt(h.replace('#', ''), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const hex3 = h => { const n = parseInt(h.replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

function pageGeom(page){
  const box = page.getCropBox(), rot = (((page.getRotation().angle) % 360) + 360) % 360, W = box.width, H = box.height;
  const dispW = rot % 180 === 0 ? W : H, dispH = rot % 180 === 0 ? H : W;
  const to = (fx, fy) => {
    let x, y;
    if (rot === 0){ x = fx * W; y = H - fy * H; }
    else if (rot === 90){ x = fy * W; y = fx * H; }
    else if (rot === 180){ x = W - fx * W; y = fy * H; }
    else { x = W - fy * W; y = H - fx * H; }
    return {x: x + box.x, y: y + box.y};
  };
  return {rot, W, H, dispW, dispH, to};
}
function safeText(font, t){
  let out = '';
  for (const ch of String(t)){ if (ch === '\n'){ out += ch; continue; } try { font.encodeText(ch); out += ch; } catch(e){ out += '?'; } }
  return out;
}

async function applyFormValues(doc){
  if (!S.touched.size) return;
  const form = doc.getForm();
  for (const name of S.touched){
    const v = S.fields[name]; let f;
    try { f = form.getField(name); } catch(e){ continue; }
    try {
      if (f instanceof PDFTextField){ try { f.setText(String(v == null ? '' : v)); } catch(e){ f.setText(String(v).replace(/[^\x20-\xFF]/g, '?')); } }
      else if (f instanceof PDFCheckBox){ if (v && v !== 'Off') f.check(); else f.uncheck(); }
      else if (f instanceof PDFRadioGroup){ const opts = f.getOptions(); if (opts.includes(v)) f.select(v); else if (/^\d+$/.test(String(v)) && opts[+v]) f.select(opts[+v]); }
      else if (f instanceof PDFDropdown){ if (v) f.select(Array.isArray(v) ? v[0] : v); else f.clear(); }
      else if (f instanceof PDFOptionList){ if (v && v.length) f.select(v); else f.clear(); }
    } catch(e){ console.warn('campo non applicato', name, e); }
  }
  try { form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica)); } catch(e){ console.warn(e); }
}

async function buildPdf(){
  const doc = await PDFDocument.load(S.bytes, {ignoreEncryption: true, updateMetadata: false});
  await applyFormValues(doc);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const imgCache = {};
  for (const a of S.anns){
    const page = doc.getPage(a.page - 1); if (!page) continue;
    const g = pageGeom(page);
    if (MARKUP.includes(a.type)){
      const col = hex2rgb(a.color);
      for (const [fx, fy, fw, fh] of a.rects){
        if (a.type === 'highlight'){
          const p1 = g.to(fx, fy), p2 = g.to(fx + fw, fy + fh);
          page.drawRectangle({x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y),
            color: col, opacity: .55, blendMode: BlendMode.Multiply, borderWidth: 0});
        } else {
          const yy = a.type === 'underline' ? fy + fh : fy + fh / 2;
          page.drawLine({start: g.to(fx, yy), end: g.to(fx + fw, yy), thickness: Math.max(.8, fh * g.dispH * .07), color: col});
        }
      }
    } else if (a.type === 'pen'){
      const col = hex2rgb(a.color), pts = a.points;
      if (pts.length === 1){ const c = g.to(pts[0][0], pts[0][1]); page.drawCircle({x: c.x, y: c.y, size: a.width / 2, color: col}); }
      for (let i = 1; i < pts.length; i++)
        page.drawLine({start: g.to(pts[i-1][0], pts[i-1][1]), end: g.to(pts[i][0], pts[i][1]), thickness: a.width, color: col, lineCap: LineCapStyle.Round});
    } else if (a.type === 'note'){
      const c = g.to(a.x, a.y), col = hex3(a.color || '#ffd84a');
      const annot = doc.context.obj({Type: 'Annot', Subtype: 'Text', Rect: [c.x - 10, c.y - 10, c.x + 10, c.y + 10],
        Contents: PDFLib.PDFHexString.fromText(a.text || ''), T: PDFLib.PDFHexString.fromText('Lyonel Burton'), Name: 'Comment', C: col, F: 28, Open: false});
      page.node.addAnnot(doc.context.register(annot));
    } else if (a.type === 'text'){
      const size = a.size, txt = safeText(helv, a.text);
      const org = g.to(a.x + 3 / g.dispW, a.y + (2 + size * .95) / g.dispH);
      page.drawText(txt, {x: org.x, y: org.y, size, font: helv, color: hex2rgb(a.color), lineHeight: size * 1.2,
        maxWidth: Math.max(10, a.w * g.dispW - 6), rotate: degrees(g.rot)});
    } else if (a.type === 'cover'){
      const p1 = g.to(a.x, a.y), p2 = g.to(a.x + a.w, a.y + a.h);
      page.drawRectangle({x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y), color: rgb(1, 1, 1), borderWidth: 0});
    } else if (a.type === 'image'){
      let im = imgCache[a.data]; if (!im){ im = await doc.embedPng(a.data); imgCache[a.data] = im; }
      const wpt = a.w * g.dispW, hpt = wpt / a.ar, org = g.to(a.x, a.y + hpt / g.dispH);
      page.drawImage(im, {x: org.x, y: org.y, width: wpt, height: hpt, rotate: degrees(g.rot)});
    }
  }
  let out = await doc.save();
  const reds = S.anns.filter(a => a.type === 'redact');
  if (reds.length) out = await applyRedactions(out, reds);
  return out;
}

async function ensureEditable(){
  if (S.encrypted){ toast('Questo PDF è protetto da password: puoi leggerlo, ma non modificarlo.', true); return false; }
  return true;
}
async function saveCurrent(){
  if (!S.doc || !(await ensureEditable())) return;
  toast('Preparo il PDF…');
  try {
    const out = await buildPdf();
    const ok = await saveFile(baseName() + '-modificato.pdf', out, 'application/pdf');
    if (ok){ toast('PDF pronto.'); markClean(); }
  } catch(e){ console.error(e); toast('Errore nel salvataggio: ' + (e && e.message || e), true); }
}
$('#bSave').onclick = saveCurrent;

/* ---------- Cronologia a livello di documento (modifiche alle pagine) ---------- */
function pushDocUndo(){
  S.docUndo.push({bytes: S.bytes, anns: JSON.stringify(S.anns), fields: JSON.parse(JSON.stringify(S.fields)), touched: [...S.touched], name: S.name});
  if (S.docUndo.length > 10) S.docUndo.shift();
}
async function restoreDoc(){
  const u = S.docUndo.pop(); if (!u) return;
  S.anns = JSON.parse(u.anns); S.fields = u.fields; S.touched = new Set(u.touched); S.hist = []; S.redo = [];
  await loadBytes(u.bytes, u.name, true); toast('Modifica alle pagine annullata.');
}
async function commitEdits(){ return (S.anns.length || S.touched.size) ? await buildPdf() : S.bytes; }

/* =====================================================================
   STRUMENTI PAGINA: ruota, elimina, duplica, riordina, unisci, estrai, dividi
   ===================================================================== */
const ORG = {items: [], ext: {}, last: -1, token: 0, q: Promise.resolve()};
const mod360 = v => ((v % 360) + 360) % 360;

async function openOrganizer(){
  if (!S.doc || !(await ensureEditable())) return;
  ORG.items = []; ORG.ext = {}; ORG.last = -1; ORG.token++; ORG.q = Promise.resolve();
  for (let i = 0; i < S.n; i++) ORG.items.push({key: uid(), src: 'main', idx: i, rot: 0, sel: false, dup: false});
  drawOrg();
}
function orgClose(){ ORG.token++; Object.values(ORG.ext).forEach(x => { try { x.pdf.destroy(); } catch(e){} }); ORG.ext = {}; closeModal(); }
const orgSel = () => ORG.items.filter(i => i.sel);

function drawOrg(){
  const first = !$('#orgGrid');
  if (first){
    showModal(`<div class="orgTop">
        <button class="tb" id="oAll">☑ Tutte</button><button class="tb" id="oNone">☐ Nessuna</button>
        <button class="tb" id="oL" title="Ruota a sinistra">⟲ Ruota</button><button class="tb" id="oR" title="Ruota a destra">⟳ Ruota</button>
        <button class="tb" id="oDup">⧉ Duplica</button><button class="tb" id="oDel">🗑️ Elimina</button>
        <button class="tb" id="oBack" title="Sposta indietro">⬅</button><button class="tb" id="oFwd" title="Sposta avanti">➡</button>
        <button class="tb" id="oAdd">➕ Aggiungi PDF</button><button class="tb" id="oExt">📤 Estrai</button><button class="tb" id="oSplit">✂️ Dividi</button>
        <span class="sp"></span><span class="muted" id="oInfo"></span>
        <button class="tb" id="oCancel">Annulla</button><button class="tb primary" id="oApply">✔ Applica</button>
      </div>
      <div class="orgBody"><p class="muted" style="margin:0 0 10px">Clicca per selezionare (Maiusc per un intervallo), trascina per riordinare. Le modifiche si applicano al PDF solo con «Applica» e si possono annullare con ↶.</p><div class="orgGrid" id="orgGrid"></div></div>`, true);
    const B = id => $(id);
    B('#oAll').onclick = () => { ORG.items.forEach(i => i.sel = true); drawOrg(); };
    B('#oNone').onclick = () => { ORG.items.forEach(i => i.sel = false); drawOrg(); };
    B('#oL').onclick = () => rotSel(-90); B('#oR').onclick = () => rotSel(90);
    B('#oDup').onclick = dupSel; B('#oDel').onclick = delSel;
    B('#oBack').onclick = () => moveSel(-1); B('#oFwd').onclick = () => moveSel(1);
    B('#oAdd').onclick = orgAddPdf; B('#oExt').onclick = orgExtract; B('#oSplit').onclick = orgSplit;
    B('#oCancel').onclick = orgClose; B('#oApply').onclick = orgApply;
  }
  const grid = $('#orgGrid'); grid.innerHTML = '';
  ORG.items.forEach((it, i) => {
    const c = el('div', 'pcard' + (it.sel ? ' sel' : '')); c.draggable = true; c.dataset.key = it.key;
    const src = it.src === 'main' ? `Pag. ${it.idx + 1}` : `${esc(ORG.ext[it.src].name.slice(0, 14))} · ${it.idx + 1}`;
    c.innerHTML = `<span class="bdg">${i + 1}</span>${it.src !== 'main' ? '<span class="ext">aggiunta</span>' : it.dup ? '<span class="ext">copia</span>' : ''}<div class="tw"></div><div class="lab">${src}${it.rot ? ' · ' + (mod360(it.rot)) + '°' : ''}</div>
      <div class="mini"><button data-a="l" title="Ruota a sinistra">⟲</button><button data-a="r" title="Ruota a destra">⟳</button><button data-a="d" title="Duplica">⧉</button><button data-a="x" title="Elimina">🗑</button></div>`;
    const tw = c.querySelector('.tw'); if (!it.canvas){ it.canvas = document.createElement('canvas'); it.stale = true; } tw.append(it.canvas);
    c.onclick = e => {
      const btn = e.target.closest('button');
      if (btn){
        const a = btn.dataset.a;
        if (a === 'l'){ it.rot -= 90; it.stale = true; } else if (a === 'r'){ it.rot += 90; it.stale = true; }
        else if (a === 'd'){ ORG.items.splice(i + 1, 0, {key: uid(), src: it.src, idx: it.idx, rot: it.rot, sel: false, dup: true}); }
        else if (a === 'x'){ ORG.items.splice(i, 1); }
        drawOrg(); return;
      }
      if (e.shiftKey && ORG.last >= 0){ const [a, b] = [Math.min(ORG.last, i), Math.max(ORG.last, i)]; for (let k = a; k <= b; k++) ORG.items[k].sel = true; }
      else it.sel = !it.sel;
      ORG.last = i; drawOrg();
    };
    c.ondragstart = e => { ORG.drag = it.key; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', it.key); } catch(_){} };
    c.ondragend = () => c.classList.remove('dragging');
    c.ondragover = e => { e.preventDefault(); c.classList.add('over'); };
    c.ondragleave = () => c.classList.remove('over');
    c.ondrop = e => {
      e.preventDefault(); e.stopPropagation(); c.classList.remove('over');
      const dragged = ORG.items.find(x => x.key === ORG.drag); if (!dragged || dragged.key === it.key) return;
      const moving = dragged.sel ? ORG.items.filter(x => x.sel) : [dragged];
      if (moving.includes(it)) return;
      const rest = ORG.items.filter(x => !moving.includes(x)), at = rest.indexOf(it);
      rest.splice(at, 0, ...moving); ORG.items = rest; drawOrg();
    };
    grid.append(c);
  });
  $('#oInfo').textContent = `${ORG.items.length} pagine · ${orgSel().length} selezionate`;
  orgRenderThumbs();
}
function orgRenderThumbs(){
  const token = ORG.token;
  ORG.items.forEach(it => {
    if (!it.stale) return; it.stale = false;
    ORG.q = ORG.q.then(async () => {
      if (token !== ORG.token) return;
      try {
        const d = it.src === 'main' ? S.doc : ORG.ext[it.src].pdf, pg = await d.getPage(it.idx + 1), rot = mod360(pg.rotate + it.rot);
        const v0 = pg.getViewport({scale: 1, rotation: rot}), sc = 140 / Math.max(v0.width, v0.height), vp = pg.getViewport({scale: sc, rotation: rot});
        it.canvas.width = Math.floor(vp.width); it.canvas.height = Math.floor(vp.height);
        await pg.render({canvasContext: it.canvas.getContext('2d'), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS}).promise;
      } catch(e){ it.stale = false; }
    });
  });
}
function rotSel(d){ const s = orgSel(); if (!s.length){ toast('Seleziona prima una o più pagine.'); return; } s.forEach(i => { i.rot += d; i.stale = true; }); drawOrg(); }
function delSel(){ const s = orgSel(); if (!s.length){ toast('Seleziona prima una o più pagine.'); return; } ORG.items = ORG.items.filter(i => !i.sel); drawOrg(); }
function dupSel(){
  const s = orgSel(); if (!s.length){ toast('Seleziona prima una o più pagine.'); return; }
  const out = []; ORG.items.forEach(i => { out.push(i); if (i.sel) out.push({key: uid(), src: i.src, idx: i.idx, rot: i.rot, sel: false, dup: true}); });
  ORG.items = out; drawOrg();
}
function moveSel(d){
  const s = orgSel(); if (!s.length){ toast('Seleziona prima una o più pagine.'); return; }
  const a = ORG.items.slice();
  if (d < 0){ for (let i = 1; i < a.length; i++) if (a[i].sel && !a[i-1].sel){ [a[i-1], a[i]] = [a[i], a[i-1]]; } }
  else { for (let i = a.length - 2; i >= 0; i--) if (a[i].sel && !a[i+1].sel){ [a[i+1], a[i]] = [a[i], a[i+1]]; } }
  ORG.items = a; drawOrg();
}
function orgAddPdf(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf'; inp.multiple = true;
  inp.onchange = async () => {
    for (const f of inp.files){
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const task = openPdf(bytes);
        let locked = false; task.onPassword = () => { locked = true; task.destroy(); };
        let pdf; try { pdf = await task.promise; } catch(e){ toast(locked ? `«${f.name}» è protetto da password e non può essere unito.` : `Impossibile leggere «${f.name}».`, true); continue; }
        const id = 'x' + uid(); ORG.ext[id] = {name: f.name, bytes, pdf, n: pdf.numPages};
        for (let i = 0; i < pdf.numPages; i++) ORG.items.push({key: uid(), src: id, idx: i, rot: 0, sel: false, dup: false});
      } catch(e){ toast('Errore nel leggere ' + f.name, true); }
    }
    drawOrg();
  };
  inp.click();
}

async function orgBase(){
  const bytes = await commitEdits();
  const main = await PDFDocument.load(bytes, {ignoreEncryption: true, updateMetadata: false});
  const ext = {}; for (const id of Object.keys(ORG.ext)) ext[id] = await PDFDocument.load(ORG.ext[id].bytes, {ignoreEncryption: true, updateMetadata: false});
  return {bytes, main, ext};
}
async function buildSub(items, base){
  const out = await PDFDocument.create();
  for (const it of items){
    const src = it.src === 'main' ? base.main : base.ext[it.src];
    const [pg] = await out.copyPages(src, [it.idx]); pg.setRotation(degrees(mod360(pg.getRotation().angle + it.rot))); out.addPage(pg);
  }
  return await out.save();
}
async function orgExtract(){
  const items = orgSel().length ? orgSel() : ORG.items;
  if (!items.length){ toast('Non ci sono pagine.', true); return; }
  toast('Preparo il file…');
  try { const base = await orgBase(); const bytes = await buildSub(items, base); if (await saveFile(baseName() + '-estratto.pdf', bytes, 'application/pdf')) toast('File estratto pronto.'); }
  catch(e){ console.error(e); toast('Errore: ' + (e.message || e), true); }
}
function parseRanges(str, max){
  const out = [];
  for (const part of str.split(',').map(s => s.trim()).filter(Boolean)){
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/); if (!m) return null;
    let a = +m[1], b = m[2] ? +m[2] : a; if (a < 1 || b < a || b > max) return null;
    out.push([a, b]);
  }
  return out.length ? out : null;
}
async function orgSplit(){
  const n = ORG.items.length; if (n < 2){ toast('Servono almeno due pagine per dividere.', true); return; }
  const half = Math.ceil(n / 2);
  const str = await askText('Dividi il documento', `Indica gli intervalli di pagine, separati da virgola: ogni intervallo diventa un file PDF (tutti raccolti in un archivio ZIP). Pagine disponibili: 1-${n}.`, `1-${half},${half + 1}-${n}`);
  if (str == null) return;
  const ranges = parseRanges(str, n); if (!ranges){ toast('Intervalli non validi. Esempio: 1-3, 4-6, 7', true); return; }
  toast('Divido il documento…');
  try {
    const base = await orgBase(), zip = new JSZip();
    for (let k = 0; k < ranges.length; k++){
      const [a, b] = ranges[k]; const bytes = await buildSub(ORG.items.slice(a - 1, b), base);
      zip.file(`${baseName()}-parte-${k + 1}-pag-${a}${b > a ? '-' + b : ''}.pdf`, bytes);
    }
    const data = await zip.generateAsync({type: 'uint8array'});
    if (await saveFile(baseName() + '-diviso.zip', data, 'application/zip')) toast(`Creati ${ranges.length} file PDF in un archivio ZIP.`);
  } catch(e){ console.error(e); toast('Errore: ' + (e.message || e), true); }
}
async function orgApply(){
  if (!ORG.items.length){ toast('Il documento non può restare senza pagine.', true); return; }
  const unchanged = ORG.items.length === S.n && !Object.keys(ORG.ext).length && ORG.items.every((it, i) => it.src === 'main' && it.idx === i && !it.rot && !it.dup);
  if (unchanged){ orgClose(); return; }
  if (S.anns.length || S.touched.size){
    const ok = await askConfirm('Applicare le modifiche?', 'Le annotazioni e i campi compilati verranno incorporati nel PDF prima di modificare le pagine. Potrai annullare con ↶.', 'Applica');
    if (!ok) return;
  }
  toast('Applico le modifiche…');
  try {
    const bytesBase = await commitEdits();
    const doc = await PDFDocument.load(bytesBase, {ignoreEncryption: true, updateMetadata: false});
    const ext = {}; for (const id of Object.keys(ORG.ext)) ext[id] = await PDFDocument.load(ORG.ext[id].bytes, {ignoreEncryption: true, updateMetadata: false});
    const orig = doc.getPages(), list = [];
    for (const it of ORG.items){
      if (it.src === 'main' && !it.dup) list.push({pg: orig[it.idx], rot: it.rot});
      else { const [cp] = await doc.copyPages(it.src === 'main' ? doc : ext[it.src], [it.idx]); list.push({pg: cp, rot: it.rot}); }
    }
    const bases = list.map(x => mod360(x.pg.getRotation().angle));
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    list.forEach((x, i) => { doc.addPage(x.pg); x.pg.setRotation(degrees(mod360(bases[i] + x.rot))); });
    const out = await doc.save();
    pushDocUndo(); orgClose();
    S.anns = []; S.fields = {}; S.touched = new Set(); S.hist = []; S.redo = [];
    await loadBytes(out, null, true); updUndo();
    toast(`Modifiche applicate: ora il documento ha ${S.n} pagine.`);
  } catch(e){ console.error(e); toast('Errore nell\'applicare le modifiche: ' + (e.message || e), true); }
}
$('#bOrg').onclick = openOrganizer;

/* =====================================================================
   PDF DI ESEMPIO (con modulo compilabile)
   ===================================================================== */
async function createDemoPdf(){
  const doc = await PDFDocument.create(), f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.11, .14, .2), red = rgb(.84, .19, .23);
  const p1 = doc.addPage([595, 842]);
  p1.drawRectangle({x: 0, y: 770, width: 595, height: 72, color: red});
  p1.drawText('Modulo di iscrizione', {x: 50, y: 800, size: 26, font: fb, color: rgb(1, 1, 1)});
  p1.drawText('Documento di esempio per provare il lettore', {x: 50, y: 779, size: 11, font: f, color: rgb(1, 1, 1)});
  p1.drawText('Compila i campi qui sotto: clicca, scrivi e poi salva il PDF.', {x: 50, y: 730, size: 12, font: f, color: ink});
  const form = doc.getForm();
  const lab = (t, y) => p1.drawText(t, {x: 50, y, size: 11, font: fb, color: ink});
  lab('Nome', 692); form.createTextField('nome').addToPage(p1, {x: 50, y: 662, width: 230, height: 24, font: f});
  p1.drawText('Cognome', {x: 300, y: 692, size: 11, font: fb, color: ink}); form.createTextField('cognome').addToPage(p1, {x: 300, y: 662, width: 245, height: 24, font: f});
  lab('Email', 632); form.createTextField('email').addToPage(p1, {x: 50, y: 602, width: 495, height: 24, font: f});
  lab('Città', 572); const dd = form.createDropdown('citta'); dd.addOptions(['Catania', 'Palermo', 'Messina', 'Siracusa', 'Ragusa', 'Trapani', 'Altro']); dd.addToPage(p1, {x: 50, y: 542, width: 230, height: 24, font: f});
  p1.drawText('Come preferisci essere contattato?', {x: 300, y: 572, size: 11, font: fb, color: ink});
  const rg = form.createRadioGroup('contatto');
  rg.addOptionToPage('Email', p1, {x: 300, y: 548, width: 14, height: 14}); p1.drawText('Email', {x: 320, y: 550, size: 11, font: f, color: ink});
  rg.addOptionToPage('Telefono', p1, {x: 380, y: 548, width: 14, height: 14}); p1.drawText('Telefono', {x: 400, y: 550, size: 11, font: f, color: ink});
  lab('Note', 512); const nt = form.createTextField('note'); nt.enableMultiline(); nt.addToPage(p1, {x: 50, y: 412, width: 495, height: 94, font: f});
  const cb = form.createCheckBox('privacy'); cb.addToPage(p1, {x: 50, y: 372, width: 16, height: 16});
  p1.drawText('Accetto il trattamento dei dati personali', {x: 74, y: 376, size: 11, font: f, color: ink});
  p1.drawText('Data e firma', {x: 50, y: 330, size: 11, font: fb, color: ink});
  p1.drawLine({start: {x: 50, y: 270}, end: {x: 300, y: 270}, thickness: 1, color: ink});
  p1.drawText('Usa «Firma» nella barra per inserire la tua firma sulla linea.', {x: 50, y: 252, size: 10, font: f, color: rgb(.4, .44, .52)});

  const txt = (page, lines, y0, size = 12) => lines.forEach((l, i) => page.drawText(l, {x: 60, y: y0 - i * (size + 7), size, font: f, color: ink}));
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Pagina 2 · Prova le annotazioni', {x: 60, y: 780, size: 22, font: fb, color: red});
  txt(p2, [
    'Seleziona questo testo con il mouse e usa «Evidenzia», «Sottolinea» o «Barra».',
    'Con «Nota» puoi lasciare un commento in un punto qualsiasi della pagina.',
    'Con «Penna» disegni a mano libera e con «Testo» scrivi direttamente sul documento.',
    '',
    'La Sicilia è la più grande isola del Mediterraneo. Al centro dell\'isola',
    'si trovano colline coltivate a grano; a est si alza l\'Etna, il vulcano attivo',
    'più alto d\'Europa. Tra le città principali ci sono Palermo, Catania e Messina.',
    '',
    'Cerca una parola (per esempio «Etna») nel campo in alto per trovarla nel documento.'
  ], 730);
  const p3 = doc.addPage([595, 842]);
  p3.drawText('Pagina 3 · Strumenti pagina', {x: 60, y: 780, size: 22, font: fb, color: red});
  txt(p3, ['Apri «Pagine» per ruotare, eliminare, duplicare o riordinare le pagine,', 'oppure per unire altri PDF e dividere il documento in più file.'], 730);
  doc.setTitle('Modulo di esempio'); doc.setAuthor('Lyonel Burton');
  return await doc.save();
}
$('#wDemo').onclick = async () => { try { await loadBytes(await createDemoPdf(), 'modulo-esempio.pdf'); } catch(e){ toast('Errore: ' + e.message, true); } };

/* ---------- Avvio ---------- */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's'){ e.preventDefault(); if (S.doc) saveCurrent(); }
});
window.addEventListener('drop', e => { if (!$('#modal').hidden) e.stopImmediatePropagation(); }, true);
buildSwatches(); setTool('select'); updUndo();
window.__S = S;
