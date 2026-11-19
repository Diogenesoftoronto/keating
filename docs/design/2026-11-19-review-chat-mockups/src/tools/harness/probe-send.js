(() => {
  const b = document.querySelector('[aria-label="Send message"]');
  if (!b) return 'no send';
  const cs = getComputedStyle(b), g = b.querySelector('svg'), gs = g && getComputedStyle(g);
  const root = getComputedStyle(document.documentElement);
  return JSON.stringify({ disabled: b.disabled, bg: cs.backgroundColor, color: cs.color, op: cs.opacity, svgColor: gs && gs.color, svgOp: gs && gs.opacity, svgStroke: gs && gs.stroke, primary: root.getPropertyValue('--primary'), pf: root.getPropertyValue('--primary-foreground'), paths: g && [...g.children].map(p => getComputedStyle(p).stroke + '/' + getComputedStyle(p).opacity + '/' + (p.getAttribute('data-role') || '')) });
})()
