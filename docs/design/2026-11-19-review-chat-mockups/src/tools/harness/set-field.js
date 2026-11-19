// window.__set(labelOrPlaceholder, value)
window.__set = (key, value) => {
  const el = [...document.querySelectorAll('input, textarea')].find(e => e.placeholder === key || e.getAttribute('aria-label') === key);
  if (!el) return 'no field ' + key;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'set ' + key;
};
window.__list = () => JSON.stringify([...document.querySelectorAll('main input, main textarea, main button, [role=dialog] input, [role=dialog] button')].filter(e => e.getClientRects().length).slice(0, 60).map(e => e.tagName[0] + ':' + (e.placeholder || e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 28)));
'helpers ready'
