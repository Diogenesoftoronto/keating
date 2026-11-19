(() => {
  // Vertical rhythm around the last learner message: every box with its top-bottom and its margins and padding.
  const you = [...document.querySelectorAll('.you-bubble')].at(-1);
  if (!you) return 'no learner message';
  const root = you.closest('[data-learning-message-ids]');
  const out = [];
  const desc = (e, d) => {
    if (d > 4) return;
    const r = e.getBoundingClientRect();
    if (!r.height) return;
    const cs = getComputedStyle(e);
    const cls = typeof e.className === 'string' ? e.className.split(' ').filter((c) => c && !/_/.test(c)).join('.') : '';
    out.push('  '.repeat(d) + e.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' m ' + cs.marginTop + '/' + cs.marginBottom + ' p ' + cs.paddingTop + '/' + cs.paddingBottom);
    for (const c of e.children) desc(c, d + 1);
  };
  out.push('PREV'); if (root.previousElementSibling) desc(root.previousElementSibling, 0);
  out.push('YOU'); desc(root, 0);
  out.push('NEXT'); if (root.nextElementSibling) desc(root.nextElementSibling, 0);
  const pcs = getComputedStyle(root.parentElement);
  out.push('parent ' + pcs.display + ' gap ' + pcs.rowGap);
  return out.join('\n');
})()
