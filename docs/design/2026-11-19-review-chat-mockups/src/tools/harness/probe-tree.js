(() => {
  const root = document.querySelector(window.__probeRoot || '.cw-rail');
  if (!root) return 'no root';
  const out = [];
  const walk = (e, d) => {
    if (out.length > 90 || d > 7) return;
    const cls = String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(/\s+/).filter(c => /^(cw-|k-|rm-|lr-)/.test(c)).join('.');
    const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 18);
    if (e.tagName !== 'svg' && e.tagName !== 'path') out.push(' '.repeat(d) + e.tagName.toLowerCase() + (cls ? '.' + cls : '') + (own ? ' "' + own + '"' : ''));
    if (e.tagName === 'svg') return;
    for (const c of e.children) walk(c, d + 1);
  };
  walk(root, 0);
  return out.join('\n');
})()
