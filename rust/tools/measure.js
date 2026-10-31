window.__pathOf = el => { const parts = []; while (el && el !== document.body) { const p = el.parentElement; parts.unshift(el.tagName.toLowerCase() + ':' + (p ? [...p.children].indexOf(el) : 0)); el = p; } return parts.join('/'); };
window.__send = (name, data) => fetch('http://127.0.0.1:4174/' + name, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) }).then(r => r.text());
window.__tab = async name => { const b = [...document.querySelectorAll('button')].find(t => t.textContent.trim() === name); b.click(); await new Promise(r => setTimeout(r, 300)); };
window.__dump4 = function () {
  const out = { W: innerWidth, H: innerHeight, items: [] };
  const R = r => [Math.round(r.x*100)/100, Math.round(r.y*100)/100, Math.round(r.width*100)/100, Math.round(r.height*100)/100];
  const vis = el => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0; };
  const ancestorsVisible = el => { for (let e = el; e && e !== document.body; e = e.parentElement) if (!vis(e)) return false; return true; };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (!ancestorsVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    const s = getComputedStyle(el); const tag = el.tagName.toLowerCase();
    const it = { p: __pathOf(el), tag, r: R(r), op: s.opacity };
    const det = el.closest('details');
    if (det && !det.open && !el.closest('summary')) continue;
    if (det) it.det = __pathOf(det);
    if (el.matches('button, a, input, select, summary, [role=button], [role=tab], [role=menuitem], label'))
      it.click = { label: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '', text: (el.innerText || '').trim().slice(0, 60), type: el.type || '', cls: (el.className || '').toString().slice(0, 80), pressed: el.getAttribute('aria-pressed') };
    if (tag === 'svg') { it.svg = el.outerHTML; it.color = s.color; it.sw = s.strokeWidth; out.items.push(it); continue; }
    const bw = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat);
    const bc = [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];
    if ((s.backgroundColor !== 'rgba(0, 0, 0, 0)') || bw.some(w => w > 0) || s.borderImageSource !== 'none' || s.backgroundImage !== 'none' || s.boxShadow !== 'none' || (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0))
      it.box = { bg: s.backgroundColor, bw, bc, bs: [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle], rad: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius], img: s.backgroundImage !== 'none' ? s.backgroundImage : '', sh: s.boxShadow !== 'none' ? s.boxShadow : '', ol: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ? [s.outlineWidth, s.outlineColor, s.outlineOffset] : null, bi: s.borderImageSource !== 'none' ? s.borderImageSource : '' };
    if (tag === 'input') it.input = { type: el.type, value: el.value, min: el.min, max: el.max, checked: el.checked };
    if (tag === 'select') it.input = { type: 'select', value: el.options[el.selectedIndex]?.text || '' };
    if (tag === 'canvas') it.canvas = { w: el.width, h: el.height };
    if (tag === 'img') it.img = { src: el.getAttribute('src'), natural: [el.naturalWidth, el.naturalHeight] };
    const runs = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const raw = n.textContent; if (!raw.trim()) continue;
      const words = []; const re = /\S+/g; let m;
      while ((m = re.exec(raw))) { const wr = document.createRange(); wr.setStart(n, m.index); wr.setEnd(n, m.index + m[0].length); words.push({ w: m[0], r: R(wr.getBoundingClientRect()) }); }
      const lines = [];
      for (const w of words) { const last = lines[lines.length - 1]; if (last && Math.abs(last.r[1] - w.r[1]) < 2) { last.t += ' ' + w.w; last.r[2] = Math.round((w.r[0] + w.r[2] - last.r[0])*100)/100; } else lines.push({ t: w.w, r: w.r.slice() }); }
      runs.push({ t: raw.replace(/\s+/g, ' ').trim(), lines });
    }
    if (runs.length) it.text = { runs, color: s.color, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, ls: s.letterSpacing, tt: s.textTransform, align: s.textAlign, ws: s.whiteSpace };
    if (it.box || it.text || it.click || it.input || it.canvas || it.img) out.items.push(it);
  }
  return out;
};
// Every ribbon tab and every open menu at the current window size, as
// { name: dump }; with history: also three strokes and the filled state.
window.__measureAll = async (withHistory) => {
  const out = {}; const sz = `${innerWidth}x${innerHeight}`;
  const tabs = [...document.querySelectorAll('nav.ribbon-tabs button')].map(b => b.textContent.trim()).filter(t => t !== 'Bestand');
  for (const name of tabs) { await __tab(name); out[`${sz}-${name}`] = __dump4(); }
  await __tab('Start');
  const dets = [...document.querySelectorAll('details')].filter(d => d.getBoundingClientRect().width > 0);
  for (let i = 0; i < dets.length; i++) { dets[i].open = true; await new Promise(r => setTimeout(r, 150)); out[`${sz}-Start-open${i}`] = __dump4(); dets[i].open = false; await new Promise(r => setTimeout(r, 80)); }
  const file = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Bestand');
  file.click(); await new Promise(r => setTimeout(r, 300)); out[`${sz}-backstage`] = __dump4();
  const close = document.querySelector('.backstage header button'); if (close) close.click(); await new Promise(r => setTimeout(r, 200));
  if (withHistory) {
    const canvases = [...document.querySelectorAll('canvas')]; const top = canvases[canvases.length - 1]; const r = top.getBoundingClientRect();
    const fire = (type, x, y) => top.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.x + x, clientY: r.y + y, pointerId: 1, pointerType: 'mouse', buttons: type === 'pointerup' ? 0 : 1, button: 0, isPrimary: true }));
    for (const [a, b] of [[[100,100],[400,300]], [[500,150],[700,400]], [[200,400],[600,500]]]) {
      fire('pointerdown', ...a); for (let i = 1; i <= 10; i++) fire('pointermove', a[0] + (b[0]-a[0])*i/10, a[1] + (b[1]-a[1])*i/10); fire('pointerup', ...b);
      await new Promise(r => setTimeout(r, 150));
    }
    // Until the local draft is saved, so the status bar is at rest.
    await new Promise(r => setTimeout(r, 2500));
    out[`${sz}-history`] = __dump4();
  }
  return out;
};
'ready'
