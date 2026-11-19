(() => {
  // Inventory of every icon on the page: which are Keating glyphs, which are something else, and whether
  // each glyph sits inside a control that can light and animate it.
  const hosts = 'button,a,[role=tab],[role=menuitem],[role=option],summary,[data-glyph-host]';
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const svgs = [...document.querySelectorAll('svg')].filter(visible).filter((s) => !s.closest('aside[class*="devtools"], [id*="devtools"], .keating-bot'));
  const glyphs = svgs.filter((s) => s.hasAttribute('data-glyph'));
  const foreign = svgs.filter((s) => !s.hasAttribute('data-glyph'));
  const sizes = {};
  for (const g of glyphs) { const k = Math.round(g.getBoundingClientRect().width); sizes[k] = (sizes[k] || 0) + 1; }
  const describe = (s) => {
    const host = s.closest(hosts);
    return (s.getAttribute('data-glyph') || 'svg') + '@' + Math.round(s.getBoundingClientRect().width) + (host ? ':' + (host.getAttribute('aria-label') || host.getAttribute('title') || host.textContent || '').trim().slice(0, 22) : ':NO-HOST');
  };
  const imgs = [...document.querySelectorAll('img')].filter(visible).filter((i) => i.getBoundingClientRect().width <= 28 && !i.closest('.keating-bot')).map((i) => (i.getAttribute('src') || '').slice(-30));
  return JSON.stringify({
    glyphs: glyphs.length,
    hostless: glyphs.filter((s) => !s.closest(hosts)).map(describe).slice(0, 12),
    sizes,
    foreign: foreign.map((s) => (s.getAttribute('class') || s.parentElement.className || '').toString().slice(0, 40) + '@' + Math.round(s.getBoundingClientRect().width)).slice(0, 14),
    smallImages: imgs.slice(0, 8),
    sample: glyphs.slice(0, 40).map(describe),
  });
})()
