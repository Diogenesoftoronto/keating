(() => {
  // Compact outline of a subtree: tag.classes[attrs] "own text" WxH, for comparing markup with a board.
  const sel = window.__domRoot || 'body';
  const max = window.__domDepth || 7;
  const root = document.querySelector(sel);
  if (!root) return 'no ' + sel;
  const out = [];
  const walk = (e, d) => {
    if (d > max || out.length > 140) return;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const cls = typeof e.className === 'string' ? e.className.split(/\s+/).filter((c) => c && !/_/.test(c)).slice(0, 3).join('.') : (e.getAttribute('data-glyph') ? 'glyph:' + e.getAttribute('data-glyph') : '');
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 30);
    const attrs = ['aria-label', 'role', 'data-active', 'data-section', 'aria-pressed', 'data-branch'].filter((a) => e.hasAttribute(a)).map((a) => a.replace('aria-', '').replace('data-', '') + '=' + (e.getAttribute(a) || '').slice(0, 22)).join(',');
    const cs = getComputedStyle(e);
    out.push('  '.repeat(d) + e.tagName.toLowerCase() + (cls ? '.' + cls : '') + (attrs ? '[' + attrs + ']' : '') + (own ? ' "' + own + '"' : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (own ? ' ' + Math.round(parseFloat(cs.fontSize) * 10) / 10 + 'px ' + cs.fontFamily.split(',')[0].replace(/"/g, '').slice(0, 14) : ''));
    if (e.tagName.toLowerCase() === 'svg') return;
    for (const c of e.children) walk(c, d + 1);
  };
  walk(root, 0);
  return out.join('\n');
})()
