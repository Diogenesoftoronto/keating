(() => {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('aside') && getComputedStyle(e.closest('aside')).position === 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 2 && r.width > 0 && getComputedStyle(e).position !== 'fixed') {
      let clipped = false;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') { clipped = true; break; } }
      if (!clipped) { out.push(e.tagName + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).slice(0, 50) + ' r' + Math.round(r.right)); if (out.length > 5) break; }
    }
  }
  const h1 = document.querySelector('h1');
  return JSON.stringify({ path: location.pathname, h1: h1 && h1.textContent.slice(0, 60), h: document.documentElement.scrollHeight, overflow: out, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 260) });
})()
