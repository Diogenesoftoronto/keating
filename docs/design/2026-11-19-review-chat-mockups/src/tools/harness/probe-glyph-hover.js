(() => {
  // After hovering a control: is its glyph lit, and are its parts moving?
  const el = window.__hoverTarget && window.__hoverTarget();
  if (!el) return 'no target';
  const svg = el.matches('svg[data-glyph]') ? el : el.querySelector('svg[data-glyph]');
  if (!svg) return 'no glyph in ' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
  const parts = [...svg.querySelectorAll('[data-p]')];
  const accent = svg.querySelector('[data-role="accent"], [data-role="accentFill"]');
  const cs = accent && getComputedStyle(accent);
  return JSON.stringify({
    glyph: svg.getAttribute('data-glyph'),
    lit: svg.hasAttribute('data-lit'),
    hover: el.matches(':hover'),
    accent: cs ? (accent.getAttribute('data-role') === 'accent' ? cs.stroke : cs.fill) : null,
    ink: getComputedStyle(svg).color,
    moving: parts.map((p) => getComputedStyle(p).transform).filter((t) => t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)').length + ' of ' + parts.length + ' parts transformed',
    animations: svg.getAnimations({ subtree: true }).length,
  });
})()
