
/* =====================================================================
   ANNOTAZIONI
   Posizioni normalizzate (0-1) rispetto alla pagina visualizzata:
   restano corrette a qualsiasi zoom.
   ===================================================================== */
const MARKUP = ['highlight', 'underline', 'strike'];
const CAPTURE = ['pen', 'note', 'text', 'sign', 'stamp', 'redact', 'picture', 'shape', 'crop'];
const getAnn = id => S.anns.find(a => a.id === id);
const pageOf = n => S.pages[n - 1];
const captureClass = () => CAPTURE.includes(S.tool) ? ' capture t-' + S.tool : '';

function snap(){
  S.hist.push(JSON.stringify(S.anns)); if (S.hist.length > 100) S.hist.shift(); S.redo = []; updUndo();
}
function rerenderAll(){ S.pages.forEach(p => { if (p.state === 'done') buildAnnLayer(p); }); refreshLists(); }
async function undo(){
  if (S.hist.length){
    S.redo.push(JSON.stringify(S.anns)); S.anns = JSON.parse(S.hist.pop()); S.sel = null; rerenderAll(); updUndo();
  } else if (S.docUndo.length) await restoreDoc();
}
function redo(){
  if (!S.redo.length) return;
  S.hist.push(JSON.stringify(S.anns)); S.anns = JSON.parse(S.redo.pop()); S.sel = null; rerenderAll(); updUndo();
}
function updUndo(){
  $('#bUndo').disabled = !(S.hist.length || S.docUndo.length);
  $('#bRedo').disabled = !S.redo.length;
  $('#bDel').disabled = !S.sel;
}
function addAnn(a){
  snap(); S.anns.push(a); const p = pageOf(a.page); if (p && p.state === 'done') buildAnnLayer(p); refreshLists();
}
function delAnn(id, noSnap){
  const a = getAnn(id); if (!a) return;
  if (!noSnap) snap();
  S.anns = S.anns.filter(x => x.id !== id); if (S.sel === id) S.sel = null;
  const p = pageOf(a.page); if (p && p.state === 'done') buildAnnLayer(p); refreshLists(); updUndo();
}

/* ---------- Disegno del livello annotazioni ---------- */
function buildAnnLayer(p){
  p.el.querySelectorAll('.annLayer').forEach(x => x.remove());
  const layer = el('div', 'annLayer' + captureClass()); p.el.append(layer);
  bindLayer(p, layer);
  S.anns.filter(a => a.page === p.num).forEach(a => { const n = mkAnn(p, a); if (n) layer.append(n); });
  if (S.sel) decorateSel();
}
const pct = v => (v * 100).toFixed(3) + '%';

function mkAnn(p, a){
  if (MARKUP.includes(a.type)){
    const g = el('div', 'agrp'); g.dataset.id = a.id;
    a.rects.forEach(r => {
      const d = el('div', a.type === 'highlight' ? 'hl' : a.type === 'underline' ? 'ul' : 'st'); d.dataset.id = a.id;
      d.style.cssText = `left:${pct(r[0])};top:${pct(r[1])};width:${pct(r[2])};height:${pct(r[3])};`;
      if (a.type === 'highlight') d.style.background = a.color;
      else if (a.type === 'underline') d.style.borderBottomColor = a.color;
      else d.style.background = `linear-gradient(transparent calc(50% - 1px), ${a.color} calc(50% - 1px), ${a.color} calc(50% + 1px), transparent calc(50% + 1px))`;
      g.append(d);
    });
    return g;
  }
  if (a.type === 'pen'){
    const W = p.vw || p.el.clientWidth, H = p.vh || p.el.clientHeight;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'apen'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.dataset.id = a.id;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', penPath(a.points, W, H)); path.setAttribute('stroke', a.color);
    path.setAttribute('stroke-width', Math.max(1, a.width * S.scale)); path.dataset.id = a.id;
    svg.append(path); return svg;
  }
  if (a.type === 'shape'){
    const W = p.vw || p.el.clientWidth, H = p.vh || p.el.clientHeight;
    const svg = shapeSvg(a, W, H, 'apen ashape'); svg.dataset.id = a.id; svg.firstChild.dataset.id = a.id; return svg;
  }
  if (a.type === 'note'){
    const d = el('div', 'anote', '💬'); d.dataset.id = a.id; d.style.left = pct(a.x); d.style.top = pct(a.y); d.style.background = a.color || '#ffd84a';
    d.title = a.text || 'Nota vuota'; return d;
  }
  if (a.type === 'text'){
    const d = el('div', 'atext'); d.dataset.id = a.id; d.style.cssText = `left:${pct(a.x)};top:${pct(a.y)};width:${pct(a.w)};font-size:${(a.size * S.scale).toFixed(2)}px;color:${a.color};`;
    d.textContent = a.text; return d;
  }
  if (a.type === 'redact' || a.type === 'cover'){
    const d = el('div', a.type === 'redact' ? 'ared' : 'acover'); d.dataset.id = a.id;
    d.style.cssText = `left:${pct(a.x)};top:${pct(a.y)};width:${pct(a.w)};height:${pct(a.h)};`;
    if (a.type === 'redact') d.title = 'Zona da oscurare (rimozione definitiva al salvataggio)';
    return d;
  }
  if (a.type === 'image'){
    const d = el('div', 'aimg'); d.dataset.id = a.id; d.style.cssText = `left:${pct(a.x)};top:${pct(a.y)};width:${pct(a.w)};aspect-ratio:${a.ar};`;
    const im = document.createElement('img'); im.src = a.data; im.draggable = false; d.append(im); return d;
  }
  return null;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function shapeSvg(a, W, H, cls){
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', cls); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H, sw = Math.max(1, a.width * S.scale);
  let d;
  if (a.kind === 'rect') d = `M${Math.min(x1, x2)} ${Math.min(y1, y2)}h${Math.abs(x2 - x1)}v${Math.abs(y2 - y1)}h${-Math.abs(x2 - x1)}Z`;
  else if (a.kind === 'ellipse'){ const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2 || .5, ry = Math.abs(y2 - y1) / 2 || .5; d = `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`; }
  else {
    d = `M${x1} ${y1}L${x2} ${y2}`;
    if (a.kind === 'arrow'){
      const ang = Math.atan2(y2 - y1, x2 - x1), L = Math.max(8, sw * 4.5), sp = .45;
      d += `M${x2 - L * Math.cos(ang - sp)} ${y2 - L * Math.sin(ang - sp)}L${x2} ${y2}L${x2 - L * Math.cos(ang + sp)} ${y2 - L * Math.sin(ang + sp)}`;
    }
  }
  const path = document.createElementNS(SVGNS, 'path'); path.setAttribute('d', d); path.setAttribute('stroke', a.color); path.setAttribute('stroke-width', sw);
  path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); return svg;
}
function startShape(e, p, layer, pr){
  e.preventDefault(); layer.setPointerCapture(e.pointerId);
  const W = pr.width, H = pr.height, P = ev => [clamp((ev.clientX - pr.left) / W, 0, 1), clamp((ev.clientY - pr.top) / H, 0, 1)];
  const [x0, y0] = P(e); const a = {kind: S.shapeKind || 'rect', x1: x0, y1: y0, x2: x0, y2: y0, color: S.toolColor.shape, width: S.shapeW};
  let tmp = null;
  const mv = ev => { let [x, y] = P(ev);
    if (ev.shiftKey){ if (a.kind === 'line' || a.kind === 'arrow'){ if (Math.abs(x - x0) * W > Math.abs(y - y0) * H) y = y0; else x = x0; } else { const s = Math.max(Math.abs(x - x0) * W, Math.abs(y - y0) * H); x = clamp(x0 + Math.sign(x - x0 || 1) * s / W, 0, 1); y = clamp(y0 + Math.sign(y - y0 || 1) * s / H, 0, 1); } }
    a.x2 = x; a.y2 = y; if (tmp) tmp.remove(); tmp = shapeSvg(a, W, H, 'tempPen'); layer.append(tmp); };
  const up = () => {
    layer.removeEventListener('pointermove', mv); layer.removeEventListener('pointerup', up); layer.removeEventListener('pointercancel', up);
    if (tmp) tmp.remove();
    if (Math.hypot((a.x2 - a.x1) * W, (a.y2 - a.y1) * H) > 6) addAnn(Object.assign({id: uid(), type: 'shape', page: p.num}, a));
  };
  layer.addEventListener('pointermove', mv); layer.addEventListener('pointerup', up); layer.addEventListener('pointercancel', up);
}
function moveShape(e, a, p){
  e.preventDefault(); e.stopPropagation();
  const pr = p.el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, o = [a.x1, a.y1, a.x2, a.y2]; let moved = false;
  const mv = ev => {
    if (!moved){ if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true; snap(); }
    let dx = (ev.clientX - sx) / pr.width, dy = (ev.clientY - sy) / pr.height;
    dx = clamp(dx, -Math.min(o[0], o[2]), 1 - Math.max(o[0], o[2])); dy = clamp(dy, -Math.min(o[1], o[3]), 1 - Math.max(o[1], o[3]));
    a.x1 = o[0] + dx; a.x2 = o[2] + dx; a.y1 = o[1] + dy; a.y2 = o[3] + dy; buildAnnLayer(p);
  };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) refreshLists(); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function penPath(pts, W, H){
  if (!pts.length) return '';
  let d = `M${(pts[0][0] * W).toFixed(1)} ${(pts[0][1] * H).toFixed(1)}`;
  if (pts.length === 1) d += ` l0.1 0.1`;
  for (let i = 1; i < pts.length; i++) d += ` L${(pts[i][0] * W).toFixed(1)} ${(pts[i][1] * H).toFixed(1)}`;
  return d;
}

/* ---------- Selezione ---------- */
function decorateSel(){
  $$('.selected').forEach(x => x.classList.remove('selected'));
  $$('.handle').forEach(x => x.remove());
  if (!S.sel) return;
  const a = getAnn(S.sel); if (!a) return;
  $$(`[data-id="${S.sel}"]`).forEach(x => {
    if (x.classList.contains('agrp') || x.tagName === 'svg') return;
    x.classList.add('selected');
    if (a.type === 'image' || a.type === 'text'){
      const rs = el('div', 'handle rs'); rs.dataset.h = 'rs'; x.append(rs);
      if (a.type === 'text'){ const mv = el('div', 'handle mv', '✥'); mv.dataset.h = 'mv'; x.append(mv); }
    }
  });
}
function selectAnn(id){
  S.sel = id; decorateSel(); updUndo();
  if (!id) closeNote();
}
function pageOfEl(node){
  const pe = node.closest('.page'); return pe ? pageOf(parseInt(pe.dataset.n)) : null;
}
$('#pages').addEventListener('pointerdown', e => {
  if (S.tool !== 'select' || e._annHandled) return;
  const h = e.target.closest('.handle');
  const t = e.target.closest('[data-id]');
  if (!t){ if (!e.target.closest('.fld')) selectAnn(null); return; }
  const a = getAnn(t.dataset.id); if (!a) return;
  const p = pageOfEl(t);
  if (S.sel !== a.id) selectAnn(a.id);
  if (e.target.closest('.atext.editing')) return;
  const node = p.el.querySelector(`.annLayer [data-id="${a.id}"]:not(.agrp)`);
  if (h && h.dataset.h === 'rs') beginDrag(e, a, p, node, 'resize');
  else if (a.type === 'note' || a.type === 'image') beginDrag(e, a, p, node, 'move');
  else if (a.type === 'shape') moveShape(e, a, p);
  else if (h && h.dataset.h === 'mv') beginDrag(e, a, p, node, 'move');
});
$('#pages').addEventListener('click', e => {
  if (S.tool !== 'select') return;
  const t = e.target.closest('.anote'); if (t){ const a = getAnn(t.dataset.id); if (a && !t.dataset.dragged) openNote(a, t); }
  if (t) delete t.dataset.dragged;
});
$('#pages').addEventListener('dblclick', e => {
  const t = e.target.closest('.atext'); if (!t || S.tool !== 'select') return;
  const a = getAnn(t.dataset.id); if (a) startTextEdit(t, a);
});

function beginDrag(e, a, p, node, mode){
  e.preventDefault(); e.stopPropagation();
  const pr = p.el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = a.x, oy = a.y, ow = a.w; let moved = false;
  const mv = ev => {
    if (!moved){ if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true; snap(); }
    const dx = (ev.clientX - sx) / pr.width, dy = (ev.clientY - sy) / pr.height;
    if (mode === 'move'){ a.x = clamp(ox + dx, 0, .98); a.y = clamp(oy + dy, 0, .98); node.style.left = pct(a.x); node.style.top = pct(a.y); }
    else { a.w = clamp(ow + dx, .04, 1 - a.x); node.style.width = pct(a.w); }
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    if (moved){ if (node && node.classList.contains('anote')) node.dataset.dragged = 1; refreshLists(); }
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}

/* ---------- Testo ---------- */
function startTextEdit(d, a){
  if (!a.fresh) snap();
  d.contentEditable = 'true'; d.classList.add('editing'); d.querySelectorAll('.handle').forEach(h => h.remove()); d.focus();
  const r = document.createRange(); r.selectNodeContents(d); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  d.oninput = () => { a.text = d.innerText; };
  d.onpaste = ev => { ev.preventDefault(); document.execCommand('insertText', false, (ev.clipboardData || window.clipboardData).getData('text')); };
  d.onkeydown = ev => { if (ev.key === 'Escape'){ ev.preventDefault(); d.blur(); } ev.stopPropagation(); };
  d.onblur = () => {
    d.contentEditable = 'false'; d.classList.remove('editing');
    a.text = d.innerText.replace(/\n+$/, '');
    if (!a.text.trim()){
      if (a.fresh) S.hist.pop();
      S.anns = S.anns.filter(x => x.id !== a.id); if (S.sel === a.id) S.sel = null; buildAnnLayer(pageOf(a.page));
    } else { a.fresh = false; decorateSel(); }
    refreshLists(); updUndo();
  };
}

/* ---------- Note ---------- */
let noteCur = null;
function openNote(a, anchor){
  noteCur = a; const pop = $('#notePop');
  if (a.text && !a.fresh) snap();
  pop.innerHTML = `<textarea placeholder="Scrivi la nota…"></textarea><div class="nrow"><button class="tb" id="nDel">🗑️ Elimina</button><button class="tb primary" id="nOk">Fatto</button></div>`;
  const ta = pop.querySelector('textarea'); ta.value = a.text || '';
  const node = anchor || document.querySelector(`.anote[data-id="${a.id}"]`);
  const r = node ? node.getBoundingClientRect() : {left: 200, bottom: 200};
  pop.style.left = clamp(r.left, 8, window.innerWidth - 256) + 'px'; pop.style.top = clamp(r.bottom + 8, 8, window.innerHeight - 190) + 'px';
  pop.hidden = false; ta.focus();
  ta.oninput = () => { a.text = ta.value; const n = document.querySelector(`.anote[data-id="${a.id}"]`); if (n) n.title = a.text || 'Nota vuota'; };
  pop.querySelector('#nOk').onclick = closeNote;
  pop.querySelector('#nDel').onclick = () => { const id = a.id; if (a.fresh){ S.hist.pop(); delAnn(id, true); } else delAnn(id, true); noteCur = null; pop.hidden = true; };
}
function closeNote(){
  const pop = $('#notePop'); if (pop.hidden) return; const a = noteCur; pop.hidden = true; noteCur = null;
  if (a){
    if (a.fresh && !(a.text || '').trim()){ S.hist.pop(); delAnn(a.id, true); }
    else { a.fresh = false; const n = document.querySelector(`.anote[data-id="${a.id}"]`); if (n) n.title = a.text || 'Nota vuota'; }
    refreshLists(); updUndo();
  }
}
document.addEventListener('pointerdown', e => {
  if (!$('#notePop').hidden && !e.target.closest('#notePop') && !e.target.closest('.anote')) closeNote();
}, true);

/* ---------- Strumenti che catturano il puntatore ---------- */
function bindLayer(p, layer){
  layer.addEventListener('pointerdown', e => {
    if (!layer.classList.contains('capture')) return;
    e._annHandled = true;
    const pr = p.el.getBoundingClientRect();
    const fx = clamp((e.clientX - pr.left) / pr.width, 0, 1), fy = clamp((e.clientY - pr.top) / pr.height, 0, 1);
    if (S.tool === 'pen') return startPen(e, p, layer, pr);
    if (S.tool === 'shape') return startShape(e, p, layer, pr);
    if (S.tool === 'crop') return startCrop(e, p, layer, pr);
    if (S.tool === 'redact') return startRect(e, p, layer, pr);
    e.preventDefault();
    if (S.tool === 'note'){
      const a = {id: uid(), type: 'note', page: p.num, x: fx, y: fy, text: '', color: S.toolColor.note, fresh: true};
      addAnn(a); setTool('select'); selectAnn(a.id); setTimeout(() => { if (getAnn(a.id)) openNote(a); }, 80);
    } else if (S.tool === 'text'){
      const a = {id: uid(), type: 'text', page: p.num, x: Math.min(fx, .7), y: Math.min(fy, .95), w: .3, size: S.textSize, color: S.toolColor.text, text: '', fresh: true};
      addAnn(a); setTool('select'); selectAnn(a.id);
      setTimeout(() => { const d = document.querySelector(`.atext[data-id="${a.id}"]`); if (d && getAnn(a.id)) startTextEdit(d, a); }, 80);
    } else if (S.tool === 'sign' || S.tool === 'stamp' || S.tool === 'picture'){
      const sg = S.tool === 'stamp' ? S.stamp : S.tool === 'picture' ? S.pic : S.sig;
      if (!sg){ if (S.tool === 'stamp') openStampModal(); else if (S.tool === 'picture') pickImage(); else openSignModal(); return; }
      let w = S.tool === 'stamp' ? Math.min(.4, sg.w || .24) : S.tool === 'picture' ? .4 : .25, h = w * pr.width / sg.ar / pr.height;
      if (h > .6){ h = .6; w = h * pr.height * sg.ar / pr.width; }
      const a = {id: uid(), type: 'image', page: p.num, x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, ar: sg.ar, data: sg.data};
      if (S.tool === 'picture') a.kind = 'picture';
      addAnn(a); setTool('select'); selectAnn(a.id);
    }
  });
}
function startRect(e, p, layer, pr){
  e.preventDefault(); layer.setPointerCapture(e.pointerId);
  const W = pr.width, H = pr.height, x0 = clamp((e.clientX - pr.left) / W, 0, 1), y0 = clamp((e.clientY - pr.top) / H, 0, 1);
  const box = el('div', 'ared tmp'); layer.append(box); let x1 = x0, y1 = y0;
  const draw = () => { const x = Math.min(x0, x1), y = Math.min(y0, y1); box.style.cssText = `left:${pct(x)};top:${pct(y)};width:${pct(Math.abs(x1 - x0))};height:${pct(Math.abs(y1 - y0))};`; };
  const mv = ev => { x1 = clamp((ev.clientX - pr.left) / W, 0, 1); y1 = clamp((ev.clientY - pr.top) / H, 0, 1); draw(); };
  const up = () => {
    layer.removeEventListener('pointermove', mv); layer.removeEventListener('pointerup', up); layer.removeEventListener('pointercancel', up);
    box.remove(); const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (w * W > 6 && h * H > 6) addAnn({id: uid(), type: 'redact', page: p.num, x: Math.min(x0, x1), y: Math.min(y0, y1), w, h});
  };
  layer.addEventListener('pointermove', mv); layer.addEventListener('pointerup', up); layer.addEventListener('pointercancel', up);
}
function startPen(e, p, layer, pr){
  e.preventDefault(); layer.setPointerCapture(e.pointerId);
  const W = pr.width, H = pr.height, pts = [], color = S.toolColor.pen, wpt = S.penW;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tempPen'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke', color); path.setAttribute('stroke-width', Math.max(1, wpt * S.scale)); path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); layer.append(svg);
  const add = ev => {
    const pt = [clamp((ev.clientX - pr.left) / W, 0, 1), clamp((ev.clientY - pr.top) / H, 0, 1)];
    const last = pts[pts.length - 1];
    if (last && Math.hypot((pt[0] - last[0]) * W, (pt[1] - last[1]) * H) < 1.5) return;
    pts.push(pt); path.setAttribute('d', penPath(pts, W, H));
  };
  add(e);
  const mv = ev => add(ev);
  const up = () => {
    layer.removeEventListener('pointermove', mv); layer.removeEventListener('pointerup', up); layer.removeEventListener('pointercancel', up);
    svg.remove();
    if (pts.length >= 1) addAnn({id: uid(), type: 'pen', page: p.num, points: pts, color, width: wpt});
  };
  layer.addEventListener('pointermove', mv); layer.addEventListener('pointerup', up); layer.addEventListener('pointercancel', up);
}

/* ---------- Evidenzia / sottolinea / barra dal testo selezionato ---------- */
function markFromSelection(){
  if (!MARKUP.includes(S.tool)) return false;
  const sel = window.getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!$('#pages').contains(range.commonAncestorContainer)) return false;
  const rects = [...range.getClientRects()].filter(r => r.width > 2 && r.height > 3);
  const byPage = new Map();
  for (const r of rects){
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const p = S.pages.find(q => { if (q.state !== 'done') return false; const b = q.el.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
    if (!p) continue;
    if (!byPage.has(p.num)) byPage.set(p.num, []); byPage.get(p.num).push(r);
  }
  if (!byPage.size) return false;
  snap();
  for (const [n, list] of byPage){
    const p = pageOf(n), b = p.el.getBoundingClientRect();
    list.sort((x, y) => x.top - y.top || x.left - y.left);
    const merged = [];
    for (const r of list){
      const m = merged[merged.length - 1];
      if (m && Math.abs(m.top - r.top) < Math.min(m.height, r.height) * .6 && r.left <= m.right + 3){
        m.right = Math.max(m.right, r.right); m.left = Math.min(m.left, r.left); m.bottom = Math.max(m.bottom, r.bottom); m.top = Math.min(m.top, r.top);
      } else merged.push({left: r.left, right: r.right, top: r.top, bottom: r.bottom});
    }
    const norm = merged.map(m => [(m.left - b.left) / b.width, (m.top - b.top) / b.height, (m.right - m.left) / b.width, (m.bottom - m.top) / b.height]);
    S.anns.push({id: uid(), type: S.tool, page: n, rects: norm, color: S.toolColor[S.tool]});
    buildAnnLayer(p);
  }
  sel.removeAllRanges(); refreshLists(); updUndo(); return true;
}
document.addEventListener('mouseup', () => { if (MARKUP.includes(S.tool)) setTimeout(markFromSelection, 0); });
document.addEventListener('touchend', () => { if (MARKUP.includes(S.tool)) setTimeout(markFromSelection, 250); });

/* ---------- Strumenti e barra ---------- */
function setTool(t){
  const prev = S.tool; S.tool = t;
  $$('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  $('#viewer').classList.toggle('sel-mode', t === 'select');
  $$('.annLayer').forEach(l => l.className = 'annLayer' + captureClass());
  if (t !== 'select') selectAnn(null);
  buildSwatches();
  if (t === 'pen') $('#sizeRange').value = S.penW;
  if (t === 'shape') $('#sizeRange').value = S.shapeW;
  if (t === 'crop' && prev !== 'crop') toast('Trascina un rettangolo sulla pagina: resterà solo quella parte.');
  if (t === 'text') $('#sizeRange').value = clamp((S.textSize - 8) / 2, 1, 12);
  if (MARKUP.includes(t)) markFromSelection();
  if (t === 'sign' && (!S.sig || prev === 'sign')) openSignModal();
  if (t === 'stamp' && (!S.stamp || prev === 'stamp')) openStampModal();
  if (t === 'picture' && (!S.pic || prev === 'picture')) pickImage();
  if (t === 'redact' && prev !== 'redact') toast('Trascina sul testo da oscurare. Al salvataggio la pagina viene rasterizzata: il testo sotto sparisce davvero.');
  if (t === 'edittext' && prev !== 'edittext') toast('Clicca su una riga di testo per modificarla.');
}
$$('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
function buildSwatches(){
  const box = $('#swatches'); box.innerHTML = '';
  const cur = S.tool === 'select' ? null : S.toolColor[S.tool];
  PALETTE.forEach(([c, n]) => {
    const b = el('button', 'sw' + (cur && c.toLowerCase() === cur.toLowerCase() ? ' on' : '')); b.style.background = c; b.title = n; b.setAttribute('aria-label', n);
    b.onclick = () => {
      const a = S.sel && getAnn(S.sel);
      if (a && a.color !== undefined && S.tool === 'select'){ snap(); a.color = c; buildAnnLayer(pageOf(a.page)); }
      else if (S.tool !== 'select'){ S.toolColor[S.tool] = c; buildSwatches(); }
    };
    box.append(b);
  });
}
$('#sizeRange').oninput = e => {
  const v = +e.target.value, a = S.sel && getAnn(S.sel);
  if (S.tool === 'pen') S.penW = v;
  else if (S.tool === 'shape') S.shapeW = v;
  else if (a && a.type === 'shape'){ snap(); a.width = v; buildAnnLayer(pageOf(a.page)); }
  else if (S.tool === 'text') S.textSize = 8 + 2 * v;
  else if (a && a.type === 'pen'){ snap(); a.width = v; buildAnnLayer(pageOf(a.page)); }
  else if (a && a.type === 'text'){ snap(); a.size = 8 + 2 * v; buildAnnLayer(pageOf(a.page)); }
};
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
$('#bDel').onclick = () => { if (S.sel) delAnn(S.sel); };
$('#bFields').onclick = () => {
  S.showFields = !S.showFields; $('#bFields').setAttribute('aria-pressed', S.showFields);
  $$('.formLayer').forEach(l => l.classList.toggle('nohl', !S.showFields));
};

/* ---------- Elenco annotazioni (pannello Note) ---------- */
const ICONS = {highlight: '🖍️ Evidenziazione', underline: 'U̲ Sottolineatura', strike: 'S̶ Barrato', note: '💬 Nota', pen: '✏️ Disegno', text: '🅣 Testo', image: '✍️ Firma / timbro', shape: '▭ Forma', redact: '⬛ Oscuramento', cover: '⬜ Testo sostituito'};
function refreshLists(){
  const box = $('#tab-annots'); box.innerHTML = '';
  if (!S.anns.length){ box.innerHTML = '<div class="empty">Nessuna annotazione. Usa gli strumenti nella barra per evidenziare, scrivere note, disegnare o firmare.</div>'; return; }
  [...S.anns].sort((a, b) => a.page - b.page).forEach(a => {
    const d = el('div', 'annItem'); d.innerHTML = `${a.kind === 'picture' ? '🖼️ Immagine' : (ICONS[a.type] || a.type)}<small>Pagina ${a.page}${a.text ? ' · ' + esc(a.text.slice(0, 60)) : ''}</small>`;
    d.onclick = () => { goToPage(a.page); setTool('select'); setTimeout(() => selectAnn(a.id), 150); };
    box.append(d);
  });
}
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && !typing){
    if (e.key === 'z'){ e.preventDefault(); undo(); }
    else if (e.key === 'y' || (e.shiftKey && e.key === 'Z')){ e.preventDefault(); redo(); }
    else if (e.key === 'f'){ e.preventDefault(); $('#searchIn').focus(); }
    else if (e.key === '+' || e.key === '='){ e.preventDefault(); S.doc && zoomBy(1.2); }
    else if (e.key === '-'){ e.preventDefault(); S.doc && zoomBy(1 / 1.2); }
    return;
  }
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel){ e.preventDefault(); delAnn(S.sel); }
  else if (e.key === 'Escape'){ setTool('select'); selectAnn(null); }
  else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && S.zoomMode !== 'num' && false)){ }
});
