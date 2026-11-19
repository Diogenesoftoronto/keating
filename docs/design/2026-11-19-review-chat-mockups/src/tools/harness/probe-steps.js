(() => {
  const b = document.querySelector('.training-steps button strong');
  if (!b) return 'no step';
  const cs = getComputedStyle(b), bs = getComputedStyle(b.closest('button'));
  return JSON.stringify({ strong: cs.fontSize, button: bs.fontSize, root: getComputedStyle(document.documentElement).fontSize, w: Math.round(b.closest('button').getBoundingClientRect().width) });
})()
