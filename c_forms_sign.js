
/* =====================================================================
   MODULI (campi compilabili) E COLLEGAMENTI
   ===================================================================== */
const fieldVal = a => { const v = S.fields[a.fieldName]; return v !== undefined ? v : a.fieldValue; };
function setField(name, v){ S.fields[name] = v; S.touched.add(name); }

async function buildFormLayer(p, page, vp){
  let annots = [];
  try { annots = await page.getAnnotations({intent: 'display'}); } catch(e){ return; }
  const widgets = annots.filter(a => a.subtype === 'Widget' && a.fieldType && !a.hidden);
  const links = annots.filter(a => a.subtype === 'Link' && (a.url || a.dest));
  if (!widgets.length && !links.length) return;
  const layer = el('div', 'formLayer' + (S.showFields ? '' : ' nohl')); p.el.append(layer);
  const box = a => {
    const r = vp.convertToViewportRectangle(a.rect);
    return {x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1])};
  };
  const place = (n, b) => { n.style.left = b.x + 'px'; n.style.top = b.y + 'px'; n.style.width = b.w + 'px'; n.style.height = b.h + 'px'; };

  for (const a of links){
    const b = box(a); let n;
    if (a.url && /^(https?:|mailto:)/i.test(a.url)){
      n = el('a', 'lnk'); n.href = a.url; n.target = '_blank'; n.rel = 'noopener noreferrer'; n.title = a.url;
    } else {
      n = el('a', 'lnk'); n.href = '#'; n.title = 'Vai al collegamento';
      n.onclick = async ev => {
        ev.preventDefault();
        try { let d = a.dest; if (typeof d === 'string') d = await S.doc.getDestination(d); if (d) goToPage((await S.doc.getPageIndex(d[0])) + 1); } catch(e){}
      };
    }
    place(n, b); layer.append(n);
  }

  for (const a of widgets){
    const b = box(a), name = a.fieldName; if (!name && a.fieldType !== 'Sig') continue;
    let n = null;
    if (a.fieldType === 'Tx'){
      const multi = !!a.multiLine; n = el(multi ? 'textarea' : 'input', 'fld');
      if (!multi) n.type = a.password ? 'password' : 'text';
      let v = fieldVal(a); if (Array.isArray(v)) v = v.join(', '); n.value = v == null ? '' : v;
      if (a.maxLen) n.maxLength = a.maxLen;
      const fs = a.defaultAppearanceData && a.defaultAppearanceData.fontSize;
      n.style.fontSize = (fs ? fs * S.scale : multi ? 12 * S.scale : Math.min(b.h * .7, 16 * S.scale)) + 'px';
      n.style.textAlign = ['left', 'center', 'right'][a.textAlignment || 0] || 'left';
      n.oninput = () => setField(name, n.value);
    } else if (a.fieldType === 'Btn' && !a.pushButton){
      n = el('input', 'fld');
      if (a.radioButton){
        n.type = 'radio'; n.name = 'rg_' + name; n.value = a.buttonValue; n.checked = fieldVal(a) === a.buttonValue;
        n.onchange = () => { if (n.checked) setField(name, a.buttonValue); };
      } else {
        n.type = 'checkbox'; const v = fieldVal(a); n.checked = !!v && v !== 'Off' && v !== false;
        n.onchange = () => setField(name, n.checked ? (a.exportValue && a.exportValue !== 'Off' ? a.exportValue : 'Yes') : 'Off');
      }
    } else if (a.fieldType === 'Ch'){
      n = el('select', 'fld'); const opts = a.options || [];
      if (a.combo){ const o0 = el('option', null, ''); o0.value = ''; n.append(o0); }
      else { n.multiple = !!a.multiSelect; n.size = Math.max(2, Math.floor(b.h / 18)); }
      opts.forEach(o => { const op = el('option', null, esc(o.displayValue || o.exportValue)); op.value = o.exportValue; n.append(op); });
      const v = fieldVal(a), vs = Array.isArray(v) ? v : (v ? [v] : []);
      [...n.options].forEach(o => o.selected = vs.includes(o.value));
      n.style.fontSize = Math.min(b.h * .7, 15 * S.scale) + 'px';
      n.onchange = () => setField(name, n.multiple ? [...n.selectedOptions].map(o => o.value) : n.value);
    } else if (a.fieldType === 'Sig'){
      n = el('button', 'fld sigfld', '✍️ Firma qui'); n.type = 'button'; n.style.fontSize = Math.min(b.h * .45, 14 * S.scale) + 'px';
      n.onclick = () => {
        const put = () => placeSigIn(p, b);
        if (S.sig) put(); else openSignModal(put);
      };
    }
    if (!n) continue;
    if (a.readOnly && a.fieldType !== 'Sig'){ n.disabled = true; }
    place(n, b); layer.append(n);
  }
}
function placeSigIn(p, b){
  if (!S.sig) return;
  let w = b.w, h = w / S.sig.ar; if (h > b.h){ h = b.h; w = h * S.sig.ar; }
  const W = p.vw, H = p.vh;
  addAnn({id: uid(), type: 'image', page: p.num, x: (b.x + (b.w - w) / 2) / W, y: (b.y + (b.h - h) / 2) / H, w: w / W, ar: S.sig.ar, data: S.sig.data});
  setTool('select');
}

/* =====================================================================
   FIRMA: disegnata con il mouse/dito oppure digitata
   ===================================================================== */
const SIG_COLORS = [['#111111', 'Nero'], ['#1b3f9c', 'Blu'], ['#7a1020', 'Bordeaux']];
function openSignModal(after){
  let color = '#1b3f9c', mode = 'draw', ink = false;
  const b = showModal(`<h2>La tua firma</h2>
    <p>Disegnala con il mouse o con il dito, scrivi il nome oppure carica l'immagine della tua firma. Resta solo in questa sessione, a meno che tu non la salvi da «Timbri / firme».</p>
    <div class="sigtabs"><button class="tb on" id="stD">✍️ Disegna</button><button class="tb" id="stT">⌨️ Scrivi</button><button class="tb" id="stI">🖼️ Carica immagine</button></div>
    <div id="sigDraw"><canvas id="sigCanvas" width="1000" height="360"></canvas></div>
    <div id="sigType" hidden><input class="sigtext" id="sigText" placeholder="Scrivi il tuo nome"></div>
    <div id="sigImg" hidden><div class="sigimgbox" id="sigImgBox"><span class="muted">Nessuna immagine: premi «Scegli immagine…» (PNG, JPG…). Va bene anche una foto della firma su carta bianca.</span></div>
      <div class="mrow" style="justify-content:flex-start;margin-top:6px"><button class="tb" id="sigPick">📂 Scegli immagine…</button>
      <label style="font-size:13px"><input type="checkbox" id="sigWhite" checked> Rendi trasparente lo sfondo bianco</label></div></div>
    <div class="sigcolors">Colore: <span class="swatches" id="sigSw"></span></div>
    <div class="mrow"><button class="tb" id="sigClr">Cancella</button><button class="tb" id="sigNo">Annulla</button><button class="tb primary" id="sigOk">Usa firma</button></div>`);
  const cv = b.querySelector('#sigCanvas'), ctx = cv.getContext('2d');
  const sw = b.querySelector('#sigSw');
  const drawSw = () => { sw.innerHTML = ''; SIG_COLORS.forEach(([c, n]) => { const x = el('button', 'sw' + (c === color ? ' on' : '')); x.style.background = c; x.title = n; x.onclick = () => { color = c; drawSw(); b.querySelector('#sigText').style.color = c; }; sw.append(x); }); };
  drawSw(); b.querySelector('#sigText').style.color = color;
  let drawing = false, last = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); ink = true; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(last[0], last[1], 3.5, 0, 7); ctx.fill(); };
  cv.onpointermove = e => {
    if (!drawing) return; const p = pos(e);
    ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p;
  };
  cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
  let imgCanvas = null, imgSrc = null;
  const buildImg = () => {
    if (!imgSrc) return; const M = 1400, k = Math.min(1, M / Math.max(imgSrc.naturalWidth, imgSrc.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(imgSrc.naturalWidth * k)); c.height = Math.max(1, Math.round(imgSrc.naturalHeight * k));
    const x = c.getContext('2d'); x.drawImage(imgSrc, 0, 0, c.width, c.height);
    if (b.querySelector('#sigWhite').checked){
      const id = x.getImageData(0, 0, c.width, c.height), d = id.data;
      for (let i = 0; i < d.length; i += 4){ const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l > 215) d[i + 3] = 0; else if (l > 160) d[i + 3] = Math.round(d[i + 3] * (215 - l) / 55); }
      x.putImageData(id, 0, 0);
    }
    imgCanvas = c; const box = b.querySelector('#sigImgBox'); box.innerHTML = ''; const pv = new Image(); pv.src = c.toDataURL('image/png'); box.append(pv);
  };
  b.querySelector('#sigPick').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const url = URL.createObjectURL(f), im = new Image();
      im.onload = () => { imgSrc = im; buildImg(); URL.revokeObjectURL(url); }; im.onerror = () => toast('Immagine non leggibile.', true); im.src = url; };
    inp.click();
  };
  b.querySelector('#sigWhite').onchange = buildImg;
  const setMode = m => {
    mode = m; b.querySelector('#stD').classList.toggle('on', m === 'draw'); b.querySelector('#stT').classList.toggle('on', m === 'type'); b.querySelector('#stI').classList.toggle('on', m === 'img');
    b.querySelector('#sigDraw').hidden = m !== 'draw'; b.querySelector('#sigType').hidden = m !== 'type'; b.querySelector('#sigImg').hidden = m !== 'img';
    b.querySelector('.sigcolors').style.display = m === 'img' ? 'none' : '';
    if (m === 'type') b.querySelector('#sigText').focus();
  };
  b.querySelector('#stD').onclick = () => setMode('draw'); b.querySelector('#stT').onclick = () => setMode('type'); b.querySelector('#stI').onclick = () => setMode('img');
  b.querySelector('#sigClr').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); ink = false; b.querySelector('#sigText').value = ''; imgCanvas = imgSrc = null; b.querySelector('#sigImgBox').innerHTML = '<span class="muted">Nessuna immagine.</span>'; };
  b.querySelector('#sigNo').onclick = () => { closeModal(); if (!S.sig && S.tool === 'sign') setTool('select'); };
  b.querySelector('#sigOk').onclick = () => {
    let src = cv;
    if (mode === 'type'){
      const txt = b.querySelector('#sigText').value.trim(); if (!txt){ toast('Scrivi il tuo nome.', true); return; }
      src = document.createElement('canvas'); const c2 = src.getContext('2d');
      const font = 'italic 150px "Segoe Script","Brush Script MT","Snell Roundhand","Lucida Handwriting",cursive';
      c2.font = font; const w = Math.ceil(c2.measureText(txt).width) + 60; src.width = Math.min(w, 3000); src.height = 260;
      c2.font = font; c2.fillStyle = color; c2.textBaseline = 'middle'; c2.fillText(txt, 30, 140);
    } else if (mode === 'img'){ if (!imgCanvas){ toast('Scegli prima un\'immagine.', true); return; } src = imgCanvas; }
    else if (!ink){ toast('Disegna prima la firma.', true); return; }
    const t = trimCanvas(src); if (!t){ toast('Firma vuota.', true); return; }
    S.sig = t; closeModal();
    if (after) after(); else toast('Firma pronta: clicca sulla pagina per inserirla.');
  };
}
function trimCanvas(cv){
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ if (d[(y * W + x) * 4 + 3] > 12){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return null;
  const pad = 10; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
  return {data: out.toDataURL('image/png'), ar: w / h};
}
