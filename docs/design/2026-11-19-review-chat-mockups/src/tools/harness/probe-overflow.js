(() => {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 2 && r.width > 0) {
      out.push(e.tagName + '.' + String(e.className || '').slice(0, 60) + ' pos=' + getComputedStyle(e).position + ' r' + Math.round(r.right) + ' w' + Math.round(r.width));
      if (out.length > 7) break;
    }
  }
  const card = document.querySelector('[aria-label^="Open session"]');
  return JSON.stringify({ sw: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, vw: innerWidth, out, card: card ? card.parentElement.outerHTML.replace(/\s+/g, ' ').slice(0, 1100) : null });
})()
