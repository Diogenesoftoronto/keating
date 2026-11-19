(() => {
  const root = document.querySelector(window.__probeRoot || '.rm-rail');
  if (!root) return 'no root';
  const seen = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim(); if (!t) continue;
    const e = n.parentElement, cs = getComputedStyle(e);
    if (cs.display === 'none' || !e.getClientRects().length) continue;
    const key = Math.round(parseFloat(cs.fontSize) * 10) / 10 + 'px ' + cs.fontFamily.split(',')[0].replace(/"/g, '').slice(0, 14) + ' ' + cs.fontWeight;
    if (!seen.has(key)) seen.set(key, []);
    if (seen.get(key).length < 4) seen.get(key).push(e.tagName.toLowerCase() + ':' + t.slice(0, 22));
  }
  for (const e of root.querySelectorAll('input,textarea,select')) { const cs = getComputedStyle(e); const key = 'CONTROL ' + Math.round(parseFloat(cs.fontSize) * 10) / 10 + 'px h' + Math.round(e.getBoundingClientRect().height); if (!seen.has(key)) seen.set(key, []); seen.get(key).push(e.tagName.toLowerCase()); }
  return [...seen].map(([k, v]) => k + ' => ' + v.join(' | ')).join('\n');
})()
