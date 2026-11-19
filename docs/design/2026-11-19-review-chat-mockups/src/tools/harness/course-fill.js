(() => {
  const set = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const label = [...document.querySelectorAll('label, span')].find(e => e.textContent.trim() === 'Course title');
  const scope = label ? label.closest('form, section, div') : document;
  const input = [...document.querySelectorAll('input[type=text], input:not([type])')].find(i => i.value === 'Untitled course' || i.placeholder === 'Untitled course') || scope.querySelector('input');
  const area = [...document.querySelectorAll('textarea')].find(t => /Optional/.test(t.placeholder));
  if (!input || !area) return 'fields missing';
  set(input, 'Proof by induction');
  set(area, 'For first-year students who can follow a proof but cannot yet write one.');
  return 'filled';
})()
