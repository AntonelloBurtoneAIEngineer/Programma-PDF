
/* =====================================================================
   ESTENSIONI 5: conversione in Word (.docx), menu tasto destro sulle
   miniature (elimina / sostituisci / estrai pagina)
   ===================================================================== */
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const TW = pt => Math.round(pt * 20), EMU = pt => Math.round(pt * 12700);

/* Ricostruisce righe e paragrafi dal testo di una pagina */
async function pageBlocks(pdf, n){
  const pg = await pdf.getPage(n), vp = pg.getViewport({scale: 1}), tc = await pg.getTextContent();
  try { await pg.getOperatorList(); } catch(e){}
  const fontInfo = {};
  const fi = fn => {
    if (fontInfo[fn]) return fontInfo[fn];
    let name = '', fam = (tc.styles[fn] || {}).fontFamily || '';
    try { if (pg.commonObjs.has(fn)){ const f = pg.commonObjs.get(fn); name = (f && (f.name || f.loadedName)) || ''; } } catch(e){}
    const nm = (name || fam).replace(/^[A-Z]{6}\+/, '');
    return (fontInfo[fn] = {bold: /bold|black|heavy|semibold|demi/i.test(nm), italic: /italic|oblique/i.test(nm), mono: /mono|courier|consol/i.test(nm) || fam === 'monospace', serif: /times|serif|georgia|garamond|cambria|book/i.test(nm) && !/sans/i.test(nm)});
  };
  const items = [];
  for (const it of tc.items){
    if (!it.str || !it.transform) continue;
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(t[2], t[3]) || it.height || 10;
    if (Math.abs(t[1]) > Math.abs(t[0]) * .3) continue; // testo ruotato: ignorato
    const str = it.str.replace(/[\uf0b7\uf0a7\uf076\uf0d8\uf0fc\uf06e\uf0a8\u25aa\u25cf\u2023\u2043]/g, '•');
    items.push({str, x: t[4], y: t[5], w: it.width * (vp.scale || 1), size, f: fi(it.fontName), eol: it.hasEOL});
  }
  items.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines = [];
  for (const it of items){
    if (!it.str.trim() && !lines.length) continue;
    const L = lines.find(l => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.size, it.size) * .45) && lines.indexOf(l) >= lines.length - 3);
    if (L){ L.items.push(it); L.size = Math.max(L.size, it.size); } else lines.push({y: it.y, size: it.size, items: [it]});
  }
  lines.forEach(l => {
    l.items.sort((a, b) => a.x - b.x); const runs = []; let last = null;
    for (const it of l.items){
      let s = it.str;
      if (last){ const gap = it.x - (last.x + last.w); if (gap > it.size * .22 && !/\s$/.test(runs[runs.length - 1].t) && !/^\s/.test(s)) s = (gap > it.size * 3 ? '\t' : ' ') + s; }
      const r = runs[runs.length - 1];
      if (r && r.bold === it.f.bold && r.italic === it.f.italic && Math.abs(r.size - it.size) < .6 && r.mono === it.f.mono) r.t += s;
      else runs.push({t: s, bold: it.f.bold, italic: it.f.italic, mono: it.f.mono, serif: it.f.serif, size: it.size});
      last = it;
    }
    l.runs = runs; l.x0 = l.items[0].x; const e = l.items[l.items.length - 1]; l.x1 = e.x + e.w;
    l.text = runs.map(r => r.t).join('');
  });
  return {w: vp.width, h: vp.height, lines: lines.filter(l => l.text.trim())};
}
function bodySize(pages){
  const cnt = {}; pages.forEach(p => p.lines.forEach(l => l.runs.forEach(r => { const k = Math.round(r.size * 2) / 2; cnt[k] = (cnt[k] || 0) + r.t.length; })));
  let best = 11, m = 0; for (const k in cnt) if (cnt[k] > m){ m = cnt[k]; best = +k; } return best;
}
const LIST_RE = /^\s*([•▪◦·\-–—*o]|\d+[.)]|[a-z][.)])\s/;
function paragraphsOf(p, body){
  const paras = []; let cur = null, prev = null;
  const left = Math.min(...p.lines.map(l => l.x0)), right = Math.max(...p.lines.map(l => l.x1)), colW = Math.max(1, right - left);
  for (const l of p.lines){
    const center = Math.abs((l.x0 + l.x1) / 2 - p.w / 2) < p.w * .04 && l.x0 - left > colW * .12;
    let brk = !cur;
    if (cur && prev){
      const gap = l.y - prev.y, lh = Math.max(prev.size, l.size);
      if (gap > lh * 1.7 || gap < 0) brk = true;
      else if (Math.abs(l.size - prev.size) > Math.max(1, prev.size * .15)) brk = true;
      else if (center !== cur.center) brk = true;
      else if (prev.x1 < left + colW * .72 && !cur.center) brk = true;
      else if (LIST_RE.test(l.text)) brk = true;
      else if (cur.list && Math.abs(l.x0 - cur.textX) < body * 1.2) brk = false;
      else if (l.x0 - left > body * 1.5 && prev.x0 - left < body * .5) brk = true;
    }
    if (brk){
      const list = LIST_RE.test(l.text), it2 = l.items.find((it, k) => k > 0 && it.str.trim()) || l.items[0];
      cur = {lines: [], center, list, textX: list ? it2.x : l.x0, indent: Math.max(0, l.x0 - left), size: l.size, spaceBefore: prev ? Math.max(0, l.y - prev.y - prev.size * 1.25) : 0}; paras.push(cur);
    }
    cur.lines.push(l); prev = l;
  }
  paras.forEach(pa => {
    const runs = [];
    pa.lines.forEach((l, i) => {
      l.runs.forEach((r, j) => {
        let t = r.t; if (i > 0 && j === 0){ const lr = runs[runs.length - 1]; if (lr && /-$/.test(lr.t) && /^[a-zà-ú]/.test(t)) lr.t = lr.t.slice(0, -1); else t = ' ' + t.replace(/^\s+/, ''); }
        const lr = runs[runs.length - 1];
        if (lr && lr.bold === r.bold && lr.italic === r.italic && Math.abs(lr.size - r.size) < .6 && lr.mono === r.mono) lr.t += t; else runs.push(Object.assign({}, r, {t}));
      });
    });
    if (pa.list && runs.length) runs[0].t = runs[0].t.replace(/^\s*([•▪◦·\-–—*o]|\d+[.)]|[a-z][.)])\s+/, '$1\t');
    pa.runs = runs; pa.heading = pa.size >= body * 1.25 ? (pa.size >= body * 1.7 ? 1 : 2) : 0;
    pa.text = runs.map(r => r.t).join('');
  });
  return {paras, left, right};
}
function runXml(r, forceBold){
  const sz = Math.max(8, Math.min(144, Math.round(r.size * 2)));
  const font = r.mono ? 'Consolas' : r.serif ? 'Times New Roman' : 'Calibri';
  const parts = r.t.split('\t'), out = [];
  parts.forEach((t, i) => { if (i) out.push('<w:tab/>'); if (t) out.push(`<w:t xml:space="preserve">${xmlEsc(t)}</w:t>`); });
  return `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${r.bold || forceBold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>${out.join('')}</w:r>`;
}
function docxPackage(bodyXml, sect, media){
  const z = new JSZip();
  const imgTypes = media.length ? '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' : '';
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imgTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  z.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(baseName())}</dc:title><dc:creator>Lyonel Burton</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  z.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lyonel Burton</Application></Properties>`);
  z.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`);
  const rels = media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('');
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>`);
  media.forEach(m => z.file('word/media/' + m.name, m.data));
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${bodyXml}${sect}</w:body></w:document>`);
  return z.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
}
function imgXml(rid, id, wpt, hpt){
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${EMU(wpt)}" cy="${EMU(hpt)}"/><wp:docPr id="${id}" name="Pagina ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="pagina${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${EMU(wpt)}" cy="${EMU(hpt)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
const sectXml = (w, h, m) => `<w:sectPr><w:pgSz w:w="${TW(w)}" w:h="${TW(h)}"${w > h ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${TW(m.t)}" w:right="${TW(m.r)}" w:bottom="${TW(m.b)}" w:left="${TW(m.l)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

async function pdfToDocx(pdf, mode, onProg){
  const N = pdf.numPages, body = [];
  if (mode === 'image'){
    const media = [];
    for (let n = 1; n <= N; n++){
      onProg(n, N);
      const pg = await pdf.getPage(n), v1 = pg.getViewport({scale: 1}), cv = await renderCanvas(pdf, n, 150 / 72);
      media.push({name: `pagina${n}.jpeg`, data: await blobBytes(await cvBlob(cv, 'image/jpeg', .88))});
      const k = .985, w = v1.width * k, h = v1.height * k;
      const sect = n < N ? `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/>${sectXml(v1.width, v1.height, {t: 0, r: 0, b: 0, l: 0})}</w:pPr>` : `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>`;
      body.push(`<w:p>${sect}${imgXml('rIdImg' + n, n, w, h)}</w:p>`);
      if (n === N) var last = sectXml(v1.width, v1.height, {t: 0, r: 0, b: 0, l: 0});
    }
    return {bytes: await docxPackage(body.join(''), last, media), chars: 0};
  }
  const pages = [];
  for (let n = 1; n <= N; n++){ onProg(n, N, true); pages.push(await pageBlocks(pdf, n)); }
  const bs = bodySize(pages); let chars = 0;
  pages.forEach((p, i) => {
    if (!p.lines.length){ body.push(`<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`); }
    else {
      const {paras} = paragraphsOf(p, bs);
      paras.forEach(pa => {
        chars += pa.text.length;
        const style = pa.heading ? `<w:pStyle w:val="Heading${pa.heading}"/>` : '';
        const ind = pa.list ? `<w:ind w:left="${TW(Math.min(pa.indent, 200) + Math.max(14, Math.min(40, pa.textX - pa.lines[0].x0)))}" w:hanging="${TW(Math.max(14, Math.min(40, pa.textX - pa.lines[0].x0)))}"/>` : (!pa.center && pa.indent > 6 ? `<w:ind w:left="${TW(Math.min(pa.indent, 200))}"/>` : '');
        const sb = TW(Math.min(36, pa.spaceBefore));
        body.push(`<w:p><w:pPr>${style}<w:spacing w:before="${sb}" w:after="80"/>${ind}${pa.center ? '<w:jc w:val="center"/>' : ''}</w:pPr>${pa.runs.map(r => runXml(r, false)).join('')}</w:p>`);
      });
    }
    if (i < pages.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });
  const p0 = pages[0], lines0 = pages.flatMap(p => p.lines);
  const l = lines0.length ? Math.max(28, Math.min(...pages.filter(p => p.lines.length).map(p => Math.min(...p.lines.map(x => x.x0))))) : 56;
  const r = lines0.length ? Math.max(28, Math.min(...pages.filter(p => p.lines.length).map(p => p.w - Math.max(...p.lines.map(x => x.x1))))) : 56;
  return {bytes: await docxPackage(body.join(''), sectXml(p0.w, p0.h, {t: 50, b: 50, l: Math.min(l, 90), r: Math.min(r, 90)}), []), chars};
}
async function openWordExport(){
  if (!needDoc()) return;
  const b = showModal(`<h2>📝 Converti in Word (.docx)</h2>
    <div class="sect"><label style="display:flex;gap:8px;align-items:flex-start"><input type="radio" name="wm" value="text" checked><span><b>Testo modificabile</b><br><span class="muted" style="font-size:12.5px">Ricostruisce paragrafi, titoli, grassetto, corsivo e dimensioni del testo, con un'interruzione di pagina tra le pagine. Il testo è tutto modificabile in Word. Tabelle, colonne e immagini non vengono ricostruite.</span></span></label></div>
    <div class="sect"><label style="display:flex;gap:8px;align-items:flex-start"><input type="radio" name="wm" value="image"><span><b>Aspetto identico all'originale</b><br><span class="muted" style="font-size:12.5px">Ogni pagina diventa un'immagine in Word: l'impaginazione resta perfetta, ma il testo non è modificabile.</span></span></label></div>
    <p class="muted" style="font-size:12.5px">Per i PDF scansionati usa prima l'OCR (versione desktop), poi la modalità «Testo modificabile». Le annotazioni e i campi compilati vengono inclusi.</p>
    <div class="progress" id="wBar" hidden><i></i></div><p id="wMsg" style="font-size:13px"></p>
    <div class="mrow"><button class="tb" id="wNo">Annulla</button><button class="tb primary" id="wGo">Converti e salva</button></div>`);
  let busy = false;
  b.querySelector('#wNo').onclick = () => { if (!busy) closeModal(); };
  b.querySelector('#wGo').onclick = async () => {
    const mode = b.querySelector('input[name=wm]:checked').value; busy = true; b.querySelector('#wGo').disabled = true; b.querySelector('#wBar').hidden = false;
    const fill = b.querySelector('#wBar i'), msg = t => b.querySelector('#wMsg').textContent = t;
    let pdf, own = false;
    try {
      const bytes = (S.anns.length || S.touched.size) ? await commitEdits() : S.bytes; pdf = bytes === S.bytes ? S.doc : await openPdf(bytes).promise; own = pdf !== S.doc;
      const r = await pdfToDocx(pdf, mode, (n, N, t) => { msg(`${t ? 'Analizzo' : 'Converto'} la pagina ${n} di ${N}…`); fill.style.width = Math.round(n / N * 100) + '%'; });
      if (mode === 'text' && r.chars < 20){ msg('Il PDF non contiene testo selezionabile (forse è una scansione). Prova con l\'OCR oppure con «Aspetto identico».'); busy = false; b.querySelector('#wGo').disabled = false; return; }
      msg('Salvo il file…');
      if (await saveFile(baseName() + '.docx', r.bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')){ closeModal(); toast('Documento Word creato: ' + baseName() + '.docx'); }
    } catch(e){ console.error(e); msg('Errore: ' + (e.message || e)); b.querySelector('#wGo').disabled = false; }
    finally { busy = false; if (own && pdf) pdf.destroy(); }
  };
}
$('#bWord').onclick = openWordExport;

/* ---------- Menu tasto destro sulle miniature ---------- */
async function extractOnePage(n){
  try { const base = await commitEdits(), src = await PDFDocument.load(base, {ignoreEncryption: true}), out = await PDFDocument.create();
    const [pg] = await out.copyPages(src, [n - 1]); out.addPage(pg);
    if (await saveFile(`${baseName()}-pagina-${n}.pdf`, await out.save(), 'application/pdf')) toast('Pagina ' + n + ' estratta.');
  } catch(e){ toast('Errore: ' + (e.message || e), true); }
}
function replacePage(n){
  if (!S.doc) return;
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf,image/png,image/jpeg,image/gif,image/webp,image/bmp';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      if (/^image\//.test(f.type)){
        const pic = await imageFromFile(f);
        await docOp(async doc => {
          const {width, height} = doc.getPage(n - 1).getSize(), im = /^data:image\/jpe?g/i.test(pic.data) ? await doc.embedJpg(pic.data) : await doc.embedPng(pic.data);
          const np = doc.insertPage(n - 1, [width, height]), k = Math.min(width / im.width, height / im.height), w = im.width * k, h = im.height * k;
          np.drawImage(im, {x: (width - w) / 2, y: (height - h) / 2, width: w, height: h}); doc.removePage(n);
        }, `Pagina ${n} sostituita con l'immagine (puoi annullare con ↶).`);
        return;
      }
      const bytes = new Uint8Array(await f.arrayBuffer()); let src;
      try { src = await PDFDocument.load(bytes, {ignoreEncryption: true}); } catch(e){ toast('Impossibile leggere il PDF scelto.', true); return; }
      let k = 1;
      if (src.getPageCount() > 1){
        const v = await askText('Sostituisci pagina ' + n, `«${f.name}» ha ${src.getPageCount()} pagine. Quale vuoi usare? (1–${src.getPageCount()})`, '1'); if (v == null) return;
        k = parseInt(v, 10); if (!(k >= 1 && k <= src.getPageCount())){ toast('Numero di pagina non valido.', true); return; }
      }
      await docOp(async doc => { const [pg] = await doc.copyPages(src, [k - 1]); doc.insertPage(n - 1, pg); doc.removePage(n); },
        `Pagina ${n} sostituita con la pagina ${k} di «${f.name}» (puoi annullare con ↶).`);
    } catch(e){ console.error(e); toast('Errore: ' + (e.message || e), true); }
  };
  inp.click();
}
$('#tab-thumbs').addEventListener('contextmenu', e => {
  const t = e.target.closest('.thumb'); if (!t || !S.doc) return;
  e.preventDefault(); closeMenus();
  const n = parseInt(t.dataset.n, 10);
  const items = [
    [`📄 Vai alla pagina ${n}`, '', () => goToPage(n)],
    SEP,
    ['↻ Ruota a destra', '', () => rotatePage(n, 90)],
    ['↺ Ruota a sinistra', '', () => rotatePage(n, -90)],
    SEP,
    ['🔁 Sostituisci pagina con…', '', () => replacePage(n)],
    ['➕ Inserisci pagina vuota dopo', '', () => blankPage(n)],
    ['📤 Estrai pagina come PDF…', '', () => extractOnePage(n)],
    SEP,
    [`🗑️ Elimina pagina ${n}`, 'Canc', () => deletePage(n), () => S.n > 1],
    SEP,
    ['🗂️ Organizza tutte le pagine…', '', () => $('#bOrg').click()]
  ];
  const m = $('#ctxMenu'); fillMenu(m, items); m.hidden = false;
  m.style.left = Math.min(e.clientX, window.innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 6) + 'px';
  goToPage(n);
});
$('#tab-thumbs').addEventListener('keydown', e => { if (e.key === 'Delete' && S.doc){ e.preventDefault(); deletePage(S.cur); } });
