(() => {
  const anims = document.getAnimations();
  const running = anims.filter(a => a.playState === 'running');
  const infinite = running.filter(a => { try { return a.effect.getComputedTiming().iterations === Infinity; } catch { return false; } });
  const names = [...new Set(running.map(a => (a.animationName || a.transitionProperty || a.constructor.name) + '@' + (a.effect && a.effect.target ? (a.effect.target.className && a.effect.target.className.baseVal !== undefined ? a.effect.target.className.baseVal : String(a.effect.target.className)).split(' ')[0] : '?')))].slice(0, 14);
  const bot = document.querySelector('.keating-bot');
  return JSON.stringify({ reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, fx: document.documentElement.dataset.fx, canvases: [...document.querySelectorAll('canvas')].map(c => (c.className || c.id || 'canvas') + ':' + getComputedStyle(c).display).slice(0, 6), running: running.length, infinite: infinite.length, names, botAnimated: bot && getComputedStyle(bot.querySelector('.keating-bot__sprite') || bot).animationName, perch: document.querySelector('.chat-mascot-perch') && document.querySelector('.chat-mascot-perch').dataset.expanded });
})()
