(() => {
  const pre = document.querySelector('pre');
  if (!pre) return 'no pre';
  pre.scrollIntoView({ block: 'center' });
  const out = [];
  const walk = (e, d) => {
    if (d > 5 || out.length > 14) return;
    const cs = getComputedStyle(e);
    out.push('  '.repeat(d) + e.tagName + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).slice(0, 50) + ' bg=' + cs.backgroundColor + ' c=' + cs.color + ' disp=' + cs.display + (e.getAttribute('style') ? ' style=' + e.getAttribute('style').slice(0, 80) : ''));
    for (const c of [...e.children].slice(0, 3)) walk(c, d + 1);
  };
  let top = pre; for (let i = 0; i < 3 && top.parentElement; i++) top = top.parentElement;
  walk(top, 0);
  return out.join('\n');
})()
