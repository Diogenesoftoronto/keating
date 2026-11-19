(() => {
  // What makes the document taller (or wider) than the window? Lists the outermost elements that extend past it.
  const doc = document.scrollingElement;
  const out = ['window ' + innerWidth + 'x' + innerHeight + ' document ' + doc.scrollWidth + 'x' + doc.scrollHeight + ' html overflow ' + getComputedStyle(document.documentElement).overflowY + ' body overflow ' + getComputedStyle(document.body).overflowY + ' body height ' + Math.round(document.body.getBoundingClientRect().height)];
  const past = (e) => { const r = e.getBoundingClientRect(); return r.bottom + doc.scrollTop > innerHeight + 2 && r.height > 0; };
  const clipped = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/auto|scroll|hidden|clip/.test(cs.overflowY) && p.getBoundingClientRect().bottom + doc.scrollTop <= innerHeight + 2) return true; } return false; };
  const culprits = [...document.querySelectorAll('body *')].filter((e) => past(e) && !clipped(e));
  const outer = culprits.filter((e) => !culprits.includes(e.parentElement)).concat(culprits.filter((e) => getComputedStyle(e).position !== 'static').slice(0, 6));
  for (const e of [...new Set(outer)].slice(0, 12)) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    out.push(e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className.split(/\s+/).slice(0, 4).join('.') : '') + ' [' + (e.getAttribute('aria-label') || e.id || '') + '] top ' + Math.round(r.top) + ' bottom ' + Math.round(r.bottom) + ' h ' + Math.round(r.height) + ' pos ' + cs.position + ' overflowY ' + cs.overflowY + ' minH ' + cs.minHeight + ' height ' + cs.height);
  }
  return out.join('\n');
})()
