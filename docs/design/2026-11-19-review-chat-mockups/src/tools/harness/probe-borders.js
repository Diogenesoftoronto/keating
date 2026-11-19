(() => {
  // What still looks boxed-in on this screen. Lists, for the visible viewport:
  //  boxedIcons   icon-only buttons with a border or a fill at rest (texture-rules §1)
  //  bigIcons     icon-only buttons larger than 34px
  //  inkBorders   elements with a dark (ink) border that are not the composer, a hard card or a filled button (§2)
  //  nested       bordered boxes sitting three or more bordered boxes deep (§2)
  //  hostless     Keating glyphs that nothing can light on hover (§1)
  //  foreign      svg icons that are not Keating glyphs
  //  loading      loading or waiting text that is not inside the kit Loading block (§4)
  //  monoTitles   headings and row titles set in the mono face (§3)
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(e).visibility !== 'hidden'; };
  const skip = (e) => e.closest('aside[class*="devtools"], [id*="devtools"], .keating-bot, vite-error-overlay, [data-openui-devtools], [aria-label="Open OpenUI Inspect"]');
  const cls = (e) => typeof e.className === 'string' ? e.className.split(/\s+/).filter((c) => c && !/_/.test(c) && c.length < 28).slice(0, 2).join('.') : '';
  const name = (e) => ((e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26) || '(no name)') + ' <' + e.tagName.toLowerCase() + (cls(e) ? '.' + cls(e) : '') + '>';
  const clear = (c) => /rgba\(0, 0, 0, 0\)|transparent|\/ 0\)$/.test(c);
  const sides = (cs) => ['Top', 'Right', 'Bottom', 'Left'].filter((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && !clear(cs['border' + s + 'Color']));
  const size = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
  const probe = document.body.appendChild(document.createElement('i')); probe.style.color = 'var(--ink)'; const ink = getComputedStyle(probe).color; probe.remove();
  const all = [...document.querySelectorAll('body *')].filter((e) => !skip(e) && vis(e));
  const controls = all.filter((e) => e.matches('button,a,[role=button],summary'));
  const iconOnly = controls.filter((e) => e.querySelector('svg') && !(e.textContent || '').trim());
  const boxedIcons = iconOnly.filter((e) => { const cs = getComputedStyle(e); return (sides(cs).length >= 3 || !clear(cs.backgroundColor)) && e.getAttribute('aria-pressed') !== 'true'; })
    .map((e) => { const cs = getComputedStyle(e); return name(e) + ' ' + size(e) + (sides(cs).length >= 3 ? ' border' : '') + (!clear(cs.backgroundColor) ? ' fill ' + cs.backgroundColor : ''); });
  const bigIcons = iconOnly.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 34 || r.height > 34; }).map((e) => name(e) + ' ' + size(e));
  const bordered = all.filter((e) => sides(getComputedStyle(e)).length >= 3);
  const inkBorders = bordered.filter((e) => { const cs = getComputedStyle(e); return cs.borderTopColor === ink && !e.matches('.composer-root, .k-hard, .k-button.k-primary, .k-menu, .k-sheet, dialog, input[type=checkbox], input[type=radio], kbd') && clear(cs.backgroundColor) | cs.backgroundColor !== ink; })
    .filter((e) => !e.matches('.composer-root, .k-hard, .k-menu, .k-sheet')).map((e) => name(e) + ' ' + size(e));
  const depth = (e) => { let n = 0; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (sides(getComputedStyle(p)).length >= 3) n++; return n; };
  const nested = bordered.filter((e) => depth(e) >= 2 && !e.matches('input,textarea,select,kbd,code')).map((e) => name(e) + ' ' + size(e) + ' depth ' + (depth(e) + 1));
  const hosts = 'button,a,[role=tab],[role=menuitem],[role=option],summary,[data-glyph-host]';
  const svgs = all.filter((e) => e.tagName.toLowerCase() === 'svg');
  const hostless = svgs.filter((s) => s.hasAttribute('data-glyph') && !s.closest(hosts)).map((s) => s.getAttribute('data-glyph') + '@' + Math.round(s.getBoundingClientRect().width) + ' in ' + name(s.parentElement));
  const foreign = svgs.filter((s) => !s.hasAttribute('data-glyph') && !s.closest('[data-chart], .kc, figure, .mermaid, canvas') && s.getBoundingClientRect().width <= 32).map((s) => (cls(s) || 'svg') + '@' + Math.round(s.getBoundingClientRect().width) + ' in ' + name(s.parentElement));
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const loading = all.filter((e) => /^(loading|preparing|checking|fetching|working|saving|starting)\b.*|.*(\.\.\.|…)$/i.test(own(e)) && own(e).length < 60 && !e.closest('.k-busy, button, option, input, textarea, [data-chat-prose], .k-prose')).map((e) => own(e).slice(0, 40) + ' ' + name(e).split(' <')[1]);
  const mono = (e) => /mono/i.test(getComputedStyle(e).fontFamily.split(',')[0]);
  const monoTitles = all.filter((e) => e.matches('h1,h2,h3,h4,[role=heading], a > b:first-child, a > strong:first-child, li > b:first-child, summary > b') && own(e).length > 3 && mono(e) && parseFloat(getComputedStyle(e).fontSize) >= 12.5).map((e) => own(e).slice(0, 30) + ' ' + Math.round(parseFloat(getComputedStyle(e).fontSize)) + 'px <' + e.tagName.toLowerCase() + '>');
  const cut = (a, n = 14) => a.length > n ? [...a.slice(0, n), '+' + (a.length - n) + ' more'] : a;
  return JSON.stringify({ url: location.pathname + location.search, boxedIcons: cut(boxedIcons), bigIcons: cut(bigIcons, 8), inkBorders: cut(inkBorders), nested: cut(nested, 10), hostless: cut(hostless, 10), foreign: cut(foreign, 10), loading: cut(loading, 8), monoTitles: cut(monoTitles, 10) }, null, 1);
})()
