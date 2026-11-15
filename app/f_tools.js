
/* =====================================================================
   ESTENSIONI 2: oscuramento, confronto, esporta/comprimi, filigrana,
   numeri di pagina, firma digitale, OCR
   ===================================================================== */
const needDoc = () => { if (!S.doc){ toast('Apri prima un PDF.', true); return false; } return true; };
const cvBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
const blobBytes = async b => new Uint8Array(await b.arrayBuffer());

/* ---------- Oscuramento definitivo ---------- */
async function applyRedactions(bytes, reds){
  const task = openPdf(bytes), pdf = await task.promise;
  const doc = await PDFDocument.load(bytes, {ignoreEncryption: true, updateMetadata: false});
  const SC = 2.6, pages = [...new Set(reds.map(a => a.page))].sort((a, b) => a - b);
  for (const pn of pages){
    const pg = await pdf.getPage(pn), vp = pg.getViewport({scale: SC});
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE}).promise;
    ctx.fillStyle = '#000';
    reds.filter(a => a.page === pn).forEach(a => ctx.fillRect(Math.floor(a.x * cv.width), Math.floor(a.y * cv.height), Math.ceil(a.w * cv.width) + 1, Math.ceil(a.h * cv.height) + 1));
    const jb = await blobBytes(await cvBlob(cv, 'image/jpeg', .9));
    const old = doc.getPage(pn - 1);
    try {
      const form = doc.getForm(), annots = old.node.Annots();
      if (annots){
        const dicts = []; for (let i = 0; i < annots.size(); i++) dicts.push(doc.context.lookup(annots.get(i)));
        for (const f of form.getFields()) if (f.acroField.getWidgets().some(w => dicts.includes(w.dict))){ try { form.removeField(f); } catch(e){} }
      }
    } catch(e){}
    const img = await doc.embedJpg(jb), w = vp.width / SC, h = vp.height / SC;
    const np = doc.insertPage(pn - 1, [w, h]); np.drawImage(img, {x: 0, y: 0, width: w, height: h});
    doc.removePage(pn);
  }
  pdf.destroy();
  return await doc.save();
}

/* ---------- Operazione sul documento intero (con annulla) ---------- */
async function docOp(fn, msg){
  if (!S.doc || !(await ensureEditable())) return false;
  try {
    toast('Elaboro…');
    const base = await commitEdits();
    const doc = await PDFDocument.load(base, {ignoreEncryption: true, updateMetadata: false});
    await fn(doc, base);
    const out = await doc.save();
    pushDocUndo(); S.anns = []; S.fields = {}; S.touched = new Set(); S.hist = []; S.redo = [];
    closeModal(); await loadBytes(out, null, true); updUndo(); toast(msg); return true;
  } catch(e){ console.error(e); toast('Errore: ' + (e && e.message || e), true); return false; }
}
async function renderCanvas(pdf, n, scale, ann){
  const pg = await pdf.getPage(n), vp = pg.getViewport({scale});
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({canvasContext: ctx, viewport: vp, annotationMode: ann === false ? pdfjsLib.AnnotationMode.DISABLE : pdfjsLib.AnnotationMode.ENABLE}).promise;
  return cv;
}

/* ---------- Confronto tra due PDF ---------- */
function wordDiff(a, b){
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  if (A.length * B.length > 6e6){
    const m = new Map(); A.forEach(w => m.set(w, (m.get(w) || 0) + 1)); let common = 0;
    B.forEach(w => { const c = m.get(w) || 0; if (c > 0){ common++; m.set(w, c - 1); } });
    return {removed: A.length - common, added: B.length - common};
  }
  const n = A.length, m = B.length, dp = new Uint16Array((n + 1) * (m + 1)), W = m + 1;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const lcs = dp[0]; return {removed: n - lcs, added: m - lcs};
}
async function openCompare(){
  if (!needDoc()) return;
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,application/pdf';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let B; try { B = await openPdf(new Uint8Array(await f.arrayBuffer())).promise; } catch(e){ toast('Impossibile aprire «' + f.name + '» (se è protetto da password, rimuovila prima).', true); return; }
    runCompare(B, f.name);
  };
  inp.click();
}
async function runCompare(B, nameB){
  const A = S.doc, N = Math.max(A.numPages, B.numPages), st = {cur: 1, closed: false, res: new Array(N + 1).fill(null)};
  const b = showModal(`<div class="mhead"><h2>Confronto · A: ${esc(S.name)} ↔ B: ${esc(nameB)}</h2>
      <button class="tb" id="cmpPrev">◀</button><span id="cmpPg"></span><button class="tb" id="cmpNext">▶</button><button class="tb primary" id="cmpX">Chiudi</button></div>
    <div class="cmpgrid"><figure><canvas id="cA"></canvas><figcaption>A (originale)</figcaption></figure><figure><canvas id="cB"></canvas><figcaption>B (nuovo)</figcaption></figure><figure><canvas id="cD"></canvas><figcaption>Differenze visive (in rosso)</figcaption></figure></div>
    <div id="cmpInfo" style="padding:4px 14px;font-size:13px"></div><div class="cmplist" id="cmpList"></div>`, true);
  const W = 440;
  async function pageCanvases(n, w){
    const mk = async (doc, ref) => {
      if (n > doc.numPages) return null; const pg = await doc.getPage(n), v1 = pg.getViewport({scale: 1}); return {cv: await renderCanvas(doc, n, w / v1.width), v1};
    };
    const a = await mk(A), c = await mk(B);
    const wA = a ? a.cv.width : (c ? w : w), hA = a ? a.cv.height : (c ? Math.round(w * c.v1.height / c.v1.width) : 10);
    const ca = document.createElement('canvas'); ca.width = wA; ca.height = hA; const xa = ca.getContext('2d'); xa.fillStyle = '#fff'; xa.fillRect(0, 0, wA, hA); if (a) xa.drawImage(a.cv, 0, 0);
    const cb = document.createElement('canvas'); cb.width = wA; cb.height = hA; const xb = cb.getContext('2d'); xb.fillStyle = '#fff'; xb.fillRect(0, 0, wA, hA);
    if (c){ const s = Math.min(wA / c.cv.width, hA / c.cv.height); xb.drawImage(c.cv, 0, 0, c.cv.width * s, c.cv.height * s); }
    const da = xa.getImageData(0, 0, wA, hA), db = xb.getImageData(0, 0, wA, hA), dd = xa.createImageData(wA, hA); let cnt = 0;
    for (let i = 0; i < da.data.length; i += 4){
      const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
      if (d > 90){ cnt++; dd.data[i] = 230; dd.data[i + 1] = 40; dd.data[i + 2] = 40; }
      else { const l = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3 * .25 + 190; dd.data[i] = dd.data[i + 1] = dd.data[i + 2] = l; }
      dd.data[i + 3] = 255;
    }
    const cd = document.createElement('canvas'); cd.width = wA; cd.height = hA; cd.getContext('2d').putImageData(dd, 0, 0);
    return {ca, cb, cd, ratio: cnt / (wA * hA), missA: !a, missB: !c};
  }
  async function textInfo(n){
    const ta = n <= A.numPages ? await pageText(A, n) : '', tb = n <= B.numPages ? await pageText(B, n) : '';
    if (ta.trim() === tb.trim()) return {same: true, added: 0, removed: 0};
    const d = wordDiff(ta, tb); return {same: d.added + d.removed === 0, added: d.added, removed: d.removed};
  }
  const list = b.querySelector('#cmpList');
  const btns = []; for (let i = 1; i <= N; i++){ const x = el('button', null, String(i)); x.onclick = () => show(i); btns.push(x); list.append(x); }
  function paint(i){ const r = st.res[i]; if (!r) return; btns[i - 1].className = (r.same ? 'same' : 'diff') + (i === st.cur ? ' cur' : ''); btns[i - 1].title = r.same ? 'Identica' : 'Con differenze'; }
  async function show(n){
    st.cur = n; b.querySelector('#cmpPg').textContent = `Pagina ${n} di ${N}`; btns.forEach((x, i) => x.classList.toggle('cur', i + 1 === n));
    b.querySelector('#cmpInfo').textContent = 'Calcolo…';
    const r = await pageCanvases(n, W), t = await textInfo(n); if (st.closed || st.cur !== n) return;
    ['cA', 'cB', 'cD'].forEach((id, k) => { const c = b.querySelector('#' + id), s = [r.ca, r.cb, r.cd][k]; c.width = s.width; c.height = s.height; c.getContext('2d').drawImage(s, 0, 0); });
    const same = r.ratio < .0004 && t.same; st.res[n] = {same}; paint(n);
    const parts = [];
    if (r.missA) parts.push('la pagina non esiste in A'); if (r.missB) parts.push('la pagina non esiste in B');
    parts.push(same ? '✅ Pagina identica' : `Differenze visive: ${(r.ratio * 100).toFixed(2)}% dei pixel`);
    parts.push(t.same ? 'testo uguale' : `testo: ${t.removed} parole rimosse, ${t.added} aggiunte`);
    b.querySelector('#cmpInfo').textContent = parts.join(' · ');
  }
  b.querySelector('#cmpPrev').onclick = () => show(Math.max(1, st.cur - 1)); b.querySelector('#cmpNext').onclick = () => show(Math.min(N, st.cur + 1));
  b.querySelector('#cmpX').onclick = () => { st.closed = true; closeModal(); };
  show(1);
  (async () => { for (let i = 1; i <= N && !st.closed; i++){ if (st.res[i]) continue; try { const r = await pageCanvases(i, 180), t = await textInfo(i); st.res[i] = {same: r.ratio < .0004 && t.same}; paint(i); } catch(e){} } })();
}
$('#bCmp').onclick = openCompare;

/* ---------- Esporta (immagini, testo) e comprimi ---------- */
async function openExport(){
  if (!needDoc()) return;
  const b = showModal(`<h2>Esporta e comprimi</h2>
    <div class="sect"><h3>🖼️ Pagine come immagini</h3>
      <div class="rowgrid"><label>Formato<select id="xFmt"><option value="png">PNG (nitido)</option><option value="jpg">JPG (più leggero)</option></select></label>
      <label>Risoluzione<select id="xDpi"><option value="72">72 dpi (schermo)</option><option value="100">100 dpi</option><option value="150" selected>150 dpi</option><option value="200">200 dpi</option><option value="300">300 dpi (stampa)</option></select></label>
      <label style="grid-column:1/3">Pagine (es. 1-3,5; vuoto = tutte)<input type="text" id="xPages" placeholder="tutte"></label></div>
      <button class="tb primary" id="xImg">Esporta immagini</button></div>
    <div class="sect"><h3>📄 Estrai il testo</h3><p>Salva tutto il testo del documento in un file .txt.</p><button class="tb primary" id="xTxt">Esporta testo (.txt)</button></div>
    <div class="sect"><h3>🗜️ Comprimi il PDF</h3><p>Dimensione attuale: <b>${fmtSize(S.bytes.length)}</b></p>
      <div class="rowgrid"><label style="grid-column:1/3">Metodo<select id="zMode"><option value="lossless">Ottimizza senza perdita (struttura del file)</option><option value="lossy">Riduci il peso: converte le pagine in immagini JPEG</option></select></label>
      <label>Risoluzione (solo riduzione)<select id="zDpi"><option value="96">96 dpi</option><option value="120" selected>120 dpi</option><option value="150">150 dpi</option></select></label>
      <label>Qualità (solo riduzione)<select id="zQ"><option value=".5">Bassa</option><option value=".7" selected>Media</option><option value=".85">Alta</option></select></label></div>
      <p style="font-size:12px">La riduzione toglie il testo selezionabile e i campi del modulo (resta solo l'immagine): usala per file da inviare o archiviare.</p>
      <button class="tb primary" id="zGo">Comprimi e salva</button></div>
    <div class="mrow"><button class="tb" id="xClose">Chiudi</button></div>`);
  const busy = (btn, f) => async () => { btn.disabled = true; try { await f(); } catch(e){ console.error(e); toast('Errore: ' + (e && e.message || e), true); } btn.disabled = false; };
  b.querySelector('#xClose').onclick = closeModal;
  const bImg = b.querySelector('#xImg');
  bImg.onclick = busy(bImg, async () => {
    const pages = parsePages(b.querySelector('#xPages').value, S.n); if (!pages){ toast('Indica le pagine così: 1-3,5', true); return; }
    const fmt = b.querySelector('#xFmt').value, dpi = +b.querySelector('#xDpi').value, mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    toast('Creo le immagini…'); const pdf = await openPdf(await commitEdits()).promise; const files = [];
    for (const n of pages){ const cv = await renderCanvas(pdf, n, dpi / 72); files.push({name: `${baseName()}-p${String(n).padStart(2, '0')}.${fmt}`, data: await blobBytes(await cvBlob(cv, mime, .92))}); }
    pdf.destroy();
    if (files.length === 1) await saveFile(files[0].name, files[0].data, mime);
    else { const z = new JSZip(); files.forEach(f => z.file(f.name, f.data)); await saveFile(baseName() + '-immagini.zip', await z.generateAsync({type: 'uint8array'}), 'application/zip'); }
    toast('Fatto.');
  });
  const bTxt = b.querySelector('#xTxt');
  bTxt.onclick = busy(bTxt, async () => {
    let out = '';
    for (let n = 1; n <= S.n; n++) out += `--- Pagina ${n} ---\n` + (await pageText(S.doc, n)).replace(/ *\n */g, '\n').replace(/[ \t]+/g, ' ').trim() + '\n\n';
    if (out.replace(/--- Pagina \d+ ---/g, '').trim() === ''){ toast('Il documento non contiene testo selezionabile (è una scansione?): prova prima l\'OCR.', true); return; }
    await saveFile(baseName() + '.txt', new TextEncoder().encode(out), 'text/plain'); toast('Testo esportato.');
  });
  const bZ = b.querySelector('#zGo');
  bZ.onclick = busy(bZ, async () => {
    if (!(await ensureEditable())) return;
    toast('Comprimo…'); const src = await commitEdits(); let out;
    if (b.querySelector('#zMode').value === 'lossless'){
      const d = await PDFDocument.load(src, {ignoreEncryption: true, updateMetadata: false}); out = await d.save({useObjectStreams: true, addDefaultPage: false});
    } else {
      const dpi = +b.querySelector('#zDpi').value, q = +b.querySelector('#zQ').value, pdf = await openPdf(src).promise, d = await PDFDocument.create();
      for (let n = 1; n <= pdf.numPages; n++){
        const pg = await pdf.getPage(n), v1 = pg.getViewport({scale: 1}), cv = await renderCanvas(pdf, n, dpi / 72);
        const img = await d.embedJpg(await blobBytes(await cvBlob(cv, 'image/jpeg', q))); d.addPage([v1.width, v1.height]).drawImage(img, {x: 0, y: 0, width: v1.width, height: v1.height});
      }
      pdf.destroy(); out = await d.save();
    }
    const pctv = Math.round((1 - out.length / S.bytes.length) * 100);
    if (out.length >= S.bytes.length && b.querySelector('#zMode').value === 'lossless'){ toast(`Il file era già ottimizzato (${fmtSize(S.bytes.length)}).`); return; }
    await saveFile(baseName() + '-compresso.pdf', out, 'application/pdf');
    toast(`Da ${fmtSize(S.bytes.length)} a ${fmtSize(out.length)} (${pctv >= 0 ? '−' + pctv : '+' + (-pctv)}%).`);
  });
}
$('#bExp').onclick = openExport;

/* ---------- Filigrana e numeri di pagina ---------- */
function placeBaseline(page, g, font, text, size, align, fyBase, margin, extra){
  const w = font.widthOfTextAtSize(text, size);
  const fx = align === 'l' ? margin / g.dispW : align === 'r' ? 1 - (margin + w) / g.dispW : .5 - w / 2 / g.dispW;
  const o = g.to(fx, fyBase);
  page.drawText(text, Object.assign({x: o.x, y: o.y, size, font, rotate: degrees(g.rot)}, extra));
}
function openMark(){
  if (!needDoc()) return;
  const b = showModal(`<h2>Filigrana e numeri di pagina</h2>
    <div class="sect"><h3>💧 Filigrana di testo</h3>
      <div class="rowgrid"><label>Testo<input type="text" id="wmTxt" value="RISERVATO"></label>
      <label>Colore<select id="wmCol"><option value="#808080">Grigio</option><option value="#c0262d">Rosso</option><option value="#1b3f9c">Blu</option></select></label>
      <label>Dimensione (pt)<input type="number" id="wmSize" value="80" min="10" max="300"></label>
      <label>Trasparenza (%)<input type="number" id="wmOp" value="20" min="5" max="100"></label>
      <label>Inclinazione (°)<input type="number" id="wmAng" value="45" min="0" max="90"></label>
      <label>Pagine<input type="text" id="wmPg" placeholder="tutte"></label></div>
      <button class="tb primary" id="wmGo">Applica filigrana</button></div>
    <div class="sect"><h3>🔢 Numeri di pagina</h3>
      <div class="rowgrid"><label>Formato<input type="text" id="pnFmt" value="Pagina {n} di {N}"></label>
      <label>Posizione<select id="pnPos"><option value="bc">In basso, al centro</option><option value="br">In basso, a destra</option><option value="bl">In basso, a sinistra</option><option value="tc">In alto, al centro</option><option value="tr">In alto, a destra</option><option value="tl">In alto, a sinistra</option></select></label>
      <label>Dimensione (pt)<input type="number" id="pnSize" value="10" min="6" max="48"></label>
      <label>Parti dal numero<input type="number" id="pnStart" value="1" min="0"></label>
      <label>Margine (pt)<input type="number" id="pnMar" value="28" min="8" max="120"></label>
      <label>Pagine<input type="text" id="pnPg" placeholder="tutte"></label></div>
      <button class="tb primary" id="pnGo">Applica numerazione</button></div>
    <div class="mrow"><button class="tb" id="mkClose">Chiudi</button></div>`);
  b.querySelector('#mkClose').onclick = closeModal;
  b.querySelector('#wmGo').onclick = async () => {
    const txt = b.querySelector('#wmTxt').value.trim(), pages = parsePages(b.querySelector('#wmPg').value, S.n);
    if (!txt){ toast('Scrivi il testo della filigrana.', true); return; } if (!pages){ toast('Indica le pagine così: 1-3,5', true); return; }
    const size = +b.querySelector('#wmSize').value || 80, op = clamp((+b.querySelector('#wmOp').value || 20) / 100, .05, 1), ang = +b.querySelector('#wmAng').value || 0, col = hex2rgb(b.querySelector('#wmCol').value);
    await docOp(async doc => {
      const font = await doc.embedFont(StandardFonts.HelveticaBold), t = safeText(font, txt), w = font.widthOfTextAtSize(t, size), th = ang * Math.PI / 180;
      for (const n of pages){
        const page = doc.getPage(n - 1), g = pageGeom(page);
        const cx = g.dispW / 2, cy = g.dispH / 2;
        const sx = cx - (w / 2) * Math.cos(th) + .35 * size * Math.sin(th), sy = cy + (w / 2) * Math.sin(th) + .35 * size * Math.cos(th);
        const o = g.to(sx / g.dispW, sy / g.dispH);
        page.drawText(t, {x: o.x, y: o.y, size, font, color: col, opacity: op, rotate: degrees(g.rot + ang)});
      }
    }, 'Filigrana applicata (puoi annullare con ↶).');
  };
  b.querySelector('#pnGo').onclick = async () => {
    const pages = parsePages(b.querySelector('#pnPg').value, S.n); if (!pages){ toast('Indica le pagine così: 1-3,5', true); return; }
    const fmt = b.querySelector('#pnFmt').value || '{n}', pos = b.querySelector('#pnPos').value, size = +b.querySelector('#pnSize').value || 10, start = +b.querySelector('#pnStart').value || 1, mar = +b.querySelector('#pnMar').value || 28;
    await docOp(async doc => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      pages.forEach((n, i) => {
        const page = doc.getPage(n - 1), g = pageGeom(page);
        const t = safeText(font, fmt.replace(/\{n\}/g, start + i).replace(/\{N\}/g, start + pages.length - 1));
        const fy = pos[0] === 'b' ? 1 - mar / g.dispH : (mar + size * .8) / g.dispH;
        placeBaseline(page, g, font, t, size, pos[1], fy, mar, {color: rgb(.2, .2, .2)});
      });
    }, 'Numeri di pagina aggiunti (puoi annullare con ↶).');
  };
}
$('#bMark').onclick = openMark;

/* ---------- Firma digitale con certificato ---------- */
const u8ToBin = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return s; };
function certInfo(p12bytes, pw){
  const F = PdfSig.forge, p12 = F.pkcs12.pkcs12FromAsn1(F.asn1.fromDer(u8ToBin(p12bytes)), pw);
  const bags = p12.getBags({bagType: F.pki.oids.certBag})[F.pki.oids.certBag] || []; if (!bags.length) throw new Error('Nessun certificato nel file.');
  const keyBags = p12.getBags({bagType: F.pki.oids.pkcs8ShroudedKeyBag})[F.pki.oids.pkcs8ShroudedKeyBag] || [];
  if (!keyBags.length) throw new Error('Il file non contiene una chiave privata.');
  let cert = bags[0].cert; const keyPub = keyBags[0].key && keyBags[0].key.n;
  for (const bg of bags) if (keyPub && bg.cert.publicKey.n.compareTo(keyPub) === 0) cert = bg.cert;
  const cn = (cert.subject.getField('CN') || {}).value || 'Firmatario', org = (cert.subject.getField('O') || {}).value || '';
  return {cn, org, until: cert.validity.notAfter, from: cert.validity.notBefore};
}
async function signWithP12(p12bytes, pw, o){
  const P = PdfSig, info = certInfo(p12bytes, pw), now = new Date();
  if (now > info.until || now < info.from) throw new Error('Il certificato non è in corso di validità.');
  const base = await commitEdits(), doc = await PDFDocument.load(base, {ignoreEncryption: true, updateMetadata: false});
  if (o.visible){
    const page = doc.getPage(doc.getPageCount() - 1), g = pageGeom(page), font = await doc.embedFont(StandardFonts.Helvetica);
    const l1 = safeText(font, 'Firmato digitalmente da ' + info.cn), l2 = 'Data: ' + now.toLocaleString('it-IT') + (o.reason ? ' · ' + safeText(font, o.reason) : '');
    const w = Math.max(font.widthOfTextAtSize(l1, 9), font.widthOfTextAtSize(l2, 8)) + 16, org = g.to(28 / g.dispW, 1 - 28 / g.dispH), r2 = g.to(28 / g.dispW, 1 - (28 + 26) / g.dispH);
    const A = g.to(24 / g.dispW, 1 - 24 / g.dispH), B = g.to((24 + w) / g.dispW, 1 - (24 + 30) / g.dispH);
    page.drawRectangle({x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), width: Math.abs(B.x - A.x), height: Math.abs(B.y - A.y), color: rgb(.95, .97, 1), borderColor: rgb(.1, .25, .6), borderWidth: .8});
    const t1 = g.to(30 / g.dispW, 1 - 38 / g.dispH), t2 = g.to(30 / g.dispW, 1 - 49 / g.dispH);
    page.drawText(l1, {x: t1.x, y: t1.y, size: 9, font, color: rgb(.1, .25, .6), rotate: degrees(g.rot)});
    page.drawText(l2, {x: t2.x, y: t2.y, size: 8, font, color: rgb(.25, .25, .3), rotate: degrees(g.rot)});
  }
  P.pdflibAddPlaceholder({pdfDoc: doc, reason: o.reason || 'Firma', contactInfo: o.contact || '', name: info.cn, location: o.location || '', signingTime: now, signatureLength: 16384, subFilter: P.SUBFILTER_ADOBE_PKCS7_DETACHED, appName: 'Lettore PDF'});
  const bytes = await doc.save({useObjectStreams: false});
  const signer = new P.P12Signer(P.Buffer.from(p12bytes), {passphrase: pw});
  const signed = await P.signpdf.sign(P.Buffer.from(bytes), signer, now);
  return {bytes: new Uint8Array(signed), info};
}
function openCert(){
  if (!needDoc()) return;
  if (!window.PdfSig){ toast('Modulo di firma non disponibile.', true); return; }
  const b = showModal(`<h2>Firma digitale con certificato</h2>
    <p>Firma il PDF con un tuo certificato (.p12 / .pfx). La firma è verificabile in Adobe Reader e in altri lettori: qualsiasi modifica successiva al file la invalida, quindi firma per ultima.</p>
    <div class="sect"><label style="display:block;font-size:12.5px;color:#4a5266">File del certificato<input type="file" id="ceFile" accept=".p12,.pfx"></label>
      <div class="rowgrid"><label>Password del certificato<input type="password" id="cePw"></label><label>Motivo<input type="text" id="ceWhy" value="Approvazione"></label>
      <label>Luogo<input type="text" id="ceLoc"></label><label>Contatto<input type="text" id="ceCon"></label></div>
      <label style="font-size:13px"><input type="checkbox" id="ceVis" checked> Aggiungi una dicitura visibile nell'ultima pagina</label>
      <div class="mrow"><button class="tb primary" id="ceGo">🔏 Firma e salva</button></div></div>
    <div class="sect"><h3>Non hai un certificato?</h3><p>Puoi crearne uno <b>autofirmato</b>, utile per provare. I lettori lo mostreranno come «identità non verificata»: per una firma con valore legale serve un certificato rilasciato da un ente accreditato.</p>
      <div class="rowgrid"><label>Nome e cognome<input type="text" id="gnName"></label><label>Organizzazione (facoltativa)<input type="text" id="gnOrg"></label>
      <label>Email (facoltativa)<input type="text" id="gnMail"></label><label>Password del nuovo file<input type="password" id="gnPw"></label></div>
      <button class="tb" id="gnGo">Crea certificato di prova (.p12)</button></div>
    <div class="mrow"><button class="tb" id="ceClose">Chiudi</button></div>`);
  b.querySelector('#ceClose').onclick = closeModal;
  const go = b.querySelector('#ceGo');
  go.onclick = async () => {
    const f = b.querySelector('#ceFile').files[0], pw = b.querySelector('#cePw').value;
    if (!f){ toast('Scegli il file del certificato.', true); return; } if (!(await ensureEditable())) return;
    go.disabled = true; toast('Firmo…');
    try {
      const r = await signWithP12(new Uint8Array(await f.arrayBuffer()), pw, {reason: b.querySelector('#ceWhy').value, location: b.querySelector('#ceLoc').value, contact: b.querySelector('#ceCon').value, visible: b.querySelector('#ceVis').checked});
      if (await saveFile(baseName() + '-firmato.pdf', r.bytes, 'application/pdf')){ closeModal(); toast('Firmato da ' + r.info.cn + '. Non modificare più il file.'); }
    } catch(e){ console.error(e); toast('Firma non riuscita: ' + (/mac|password|PKCS#12/i.test(e.message || '') ? 'password errata o file non valido.' : (e.message || e)), true); }
    go.disabled = false;
  };
  const gn = b.querySelector('#gnGo');
  gn.onclick = async () => {
    const name = b.querySelector('#gnName').value.trim(), pw = b.querySelector('#gnPw').value; if (!name || !pw){ toast('Inserisci nome e password.', true); return; }
    gn.disabled = true; toast('Genero la chiave (qualche secondo)…');
    try {
      const {keys, cert} = await PdfSig.createSelfSigned({name, org: b.querySelector('#gnOrg').value.trim(), email: b.querySelector('#gnMail').value.trim()});
      await saveFile('certificato-' + name.replace(/\W+/g, '-').toLowerCase() + '.p12', PdfSig.toP12Bytes(keys, cert, pw), 'application/x-pkcs12');
      toast('Certificato creato: ora sceglilo qui sopra e firma.');
    } catch(e){ toast('Errore: ' + (e.message || e), true); }
    gn.disabled = false;
  };
}
$('#bCert').onclick = openCert;

/* ---------- OCR (versione desktop) ---------- */
let TESS_LOADED = null;
function loadTesseract(){
  if (window.Tesseract) return Promise.resolve();
  return TESS_LOADED || (TESS_LOADED = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('ocr/tesseract.min.js', location.href).href;
    s.onload = res; s.onerror = () => { TESS_LOADED = null; rej(new Error('Motore OCR non trovato.')); }; document.head.append(s);
  }));
}
async function openOcr(){
  if (!needDoc()) return;
  if (!DESKTOP){ toast('L\'OCR è disponibile nella versione desktop (.exe): funziona offline e legge le scansioni.', true); return; }
  if (!(await ensureEditable())) return;
  const b = showModal(`<h2>OCR: rendi ricercabile il testo</h2>
    <p>Riconosce il testo nelle pagine scansionate e lo aggiunge in modo invisibile: potrai cercarlo e selezionarlo. Funziona offline.</p>
    <div class="rowgrid"><label>Lingua<select id="ocLang"><option value="ita+eng">Italiano + Inglese</option><option value="ita">Italiano</option><option value="eng">Inglese</option></select></label>
      <label>Pagine<select id="ocWhich"><option value="auto">Solo quelle senza testo</option><option value="all">Tutte</option><option value="range">Indicate qui sotto</option></select></label>
      <label style="grid-column:1/3">Intervallo (se scelto)<input type="text" id="ocRange" placeholder="es. 1-3,5"></label></div>
    <div class="progress" id="ocBar" hidden><i></i></div><p id="ocMsg" style="font-size:13px"></p>
    <div class="mrow"><button class="tb" id="ocNo">Chiudi</button><button class="tb primary" id="ocGo">Avvia OCR</button></div>`);
  let cancel = false, running = false; const msg = t => b.querySelector('#ocMsg').textContent = t, bar = b.querySelector('#ocBar'), fill = bar.querySelector('i');
  b.querySelector('#ocNo').onclick = () => { cancel = true; if (!running) closeModal(); };
  b.querySelector('#ocGo').onclick = async () => {
    const which = b.querySelector('#ocWhich').value; let pages;
    if (which === 'range'){ pages = parsePages(b.querySelector('#ocRange').value, S.n); if (!pages){ toast('Indica le pagine così: 1-3,5', true); return; } }
    running = true; b.querySelector('#ocGo').disabled = true; bar.hidden = false;
    let worker = null;
    try {
      msg('Preparo il motore OCR…'); await loadTesseract();
      const base = await commitEdits(), pdf = await openPdf(base).promise;
      if (which === 'all') pages = Array.from({length: S.n}, (_, i) => i + 1);
      else if (which === 'auto'){ pages = []; for (let n = 1; n <= pdf.numPages; n++){ if ((await pageText(pdf, n)).replace(/\s+/g, '').length < 12) pages.push(n); } }
      if (!pages.length){ msg('Tutte le pagine contengono già del testo: non serve l\'OCR.'); pdf.destroy(); running = false; b.querySelector('#ocGo').disabled = false; return; }
      const u = p => new URL(p, location.href).href;
      worker = await Tesseract.createWorker(b.querySelector('#ocLang').value, 1, {workerPath: u('ocr/worker.min.js'), corePath: u('ocr/core/'), langPath: u('ocr/lang'), workerBlobURL: false, gzip: true});
      const doc = await PDFDocument.load(base, {ignoreEncryption: true, updateMetadata: false}), font = await doc.embedFont(StandardFonts.Helvetica); let done = 0, words = 0;
      for (const n of pages){
        if (cancel) break;
        msg(`Leggo la pagina ${n} (${done + 1} di ${pages.length})…`);
        const cv = await renderCanvas(pdf, n, 3, false), {data} = await worker.recognize(cv, {}, {blocks: true});
        const page = doc.getPage(n - 1), g = pageGeom(page), W = cv.width, H = cv.height;
        const lines = data.lines || (data.blocks || []).flatMap(bl => (bl.paragraphs || []).flatMap(p => p.lines || []));
        for (const ln of lines){
          const t = safeText(font, (ln.text || '').replace(/\s+/g, ' ').trim()); if (!t || /^\?+$/.test(t) || (ln.confidence != null && ln.confidence < 35)) continue;
          const bb = ln.bbox, wpt = (bb.x1 - bb.x0) / W * g.dispW, hpt = (bb.y1 - bb.y0) / H * g.dispH, wid1 = font.widthOfTextAtSize(t, 1); if (wid1 <= 0 || wpt < 2) continue;
          const size = clamp(wpt / wid1, 2, Math.max(4, hpt * 1.8)), o = g.to(bb.x0 / W, (bb.y1 - (bb.y1 - bb.y0) * .22) / H);
          page.drawText(t, {x: o.x, y: o.y, size, font, opacity: 0, rotate: degrees(g.rot)}); words += t.split(' ').length;
        }
        done++; fill.style.width = Math.round(done / pages.length * 100) + '%';
      }
      await worker.terminate(); worker = null; pdf.destroy();
      if (cancel){ msg('Operazione annullata.'); running = false; closeModal(); return; }
      const out = await doc.save(); pushDocUndo(); S.anns = []; S.fields = {}; S.touched = new Set(); S.hist = []; S.redo = [];
      closeModal(); await loadBytes(out, null, true); updUndo(); toast(`OCR completato su ${done} pagine (${words} parole). Prova a cercare una parola.`);
    } catch(e){
      console.error(e); msg('Errore: ' + (e && e.message || e)); toast('OCR non riuscito: ' + (e && e.message || e), true);
      try { worker && await worker.terminate(); } catch(_){}
      b.querySelector('#ocGo').disabled = false;
    }
    running = false;
  };
}
$('#bOcr').onclick = openOcr;

/* ---------- Stampa ---------- */
async function printDoc(){
  if (!needDoc()) return;
  try {
    toast('Preparo la stampa…'); const pdf = await openPdf(await commitEdits()).promise;
    let area = $('#printArea'); if (!area){ area = el('div'); area.id = 'printArea'; document.body.append(area); } area.innerHTML = '';
    for (let n = 1; n <= pdf.numPages; n++) area.append(await renderCanvas(pdf, n, 150 / 72));
    pdf.destroy();
    window.addEventListener('afterprint', () => { area.innerHTML = ''; }, {once: true});
    window.print();
  } catch(e){ console.error(e); toast('Stampa non disponibile qui: ' + (e && e.message || e), true); }
}
$('#bPrint').onclick = printDoc;
