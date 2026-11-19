(() => {
  const b = document.querySelector('.chat-mascot-perch__bot');
  if (!b) return 'no bot';
  const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
  const k = b.querySelector('.keating-bot');
  const pop = document.querySelector('.chat-mascot-menu, [role="dialog"][class*="companion"], [class*="companion-pop"]');
  return JSON.stringify({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], transform: cs.transform, position: cs.position, opacity: cs.opacity, vis: cs.visibility, attrs: [...b.attributes].filter(a => a.name.startsWith('data-') || a.name === 'style').map(a => a.name + '=' + a.value.slice(0, 90)), state: k && k.getAttribute('data-state'), perch: document.querySelector('.chat-mascot-perch').getAttribute('data-expanded'), pop: pop ? pop.textContent.slice(0, 160) : null, drops: document.querySelectorAll('[data-companion-drop]').length });
})()
