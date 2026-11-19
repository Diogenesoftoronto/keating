// window.__type(selectorOrIndex, value): set a React-controlled input's value
window.__type = (sel, value) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return 'no element ' + sel;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'typed';
};
'ready'
