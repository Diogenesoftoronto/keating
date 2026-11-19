(() => {
  // Does anything outside the thread scroll? A chat page should scroll in exactly one place: the thread.
  const out = [];
  const head = document.querySelector('.chat-header');
  const dock = document.querySelector('.composer-root')?.closest('[class*="pos_sticky"]') || document.querySelector('.composer-root')?.parentElement;
  const hint = document.querySelector('.composer-hint');
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
  out.push('window ' + innerWidth + 'x' + innerHeight + ' docScroll ' + Math.round(document.scrollingElement.scrollTop) + ' docHeight ' + document.scrollingElement.scrollHeight);
  out.push('header ' + JSON.stringify(rect(head)) + ' dock ' + JSON.stringify(rect(dock)) + ' hint ' + JSON.stringify(rect(hint)));
  for (let e = hint; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (e.scrollTop > 0 || e.scrollHeight > e.clientHeight + 1) out.push('  ' + e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className.split(/\s+/).slice(0, 3).join('.') : '') + ' scrollTop ' + Math.round(e.scrollTop) + ' client ' + e.clientHeight + ' scroll ' + e.scrollHeight + ' overflowY ' + cs.overflowY + ' pos ' + cs.position);
  }
  return out.join('\n');
})()
