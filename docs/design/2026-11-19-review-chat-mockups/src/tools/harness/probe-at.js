(() => {
  // Who is at window.__at = [x, y]? The element and its ancestors, with classes, labels and the stylesheet-ish facts.
  const [x, y] = window.__at || [0, 0];
  const out = [];
  for (let e = document.elementFromPoint(x, y), i = 0; e && i < 6; e = e.parentElement, i++) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    out.push(e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className : '') + ' [' + (e.getAttribute('aria-label') || e.getAttribute('title') || '') + '] ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' border ' + cs.borderTopWidth + ' ' + cs.borderRadius + ' text "' + (e.textContent || '').trim().slice(0, 20) + '"');
  }
  return out.join('\n');
})()
