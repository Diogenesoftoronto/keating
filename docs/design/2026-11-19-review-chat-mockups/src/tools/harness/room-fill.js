(() => {
  // Fills the "New study room" form by each field's placeholder, so it survives layout changes.
  const set = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const fields = [...document.querySelectorAll('input, textarea')].filter((el) => el.getClientRects().length);
  const by = (start) => fields.find((el) => (el.placeholder || '').startsWith(start));
  const title = by('Thursday proof'), topic = by('Induction on'), goal = by('Everyone writes');
  if (!title) return 'title field missing; placeholders seen: ' + fields.map((el) => el.placeholder).filter(Boolean).join(' | ').slice(0, 200);
  set(title, 'Thursday proof workshop');
  if (topic) set(topic, 'Induction on the natural numbers');
  if (goal) set(goal, 'Everyone writes one induction proof and explains the inductive step aloud.');
  return 'filled' + (topic ? '' : ' (no topic field)') + (goal ? '' : ' (no goal field)');
})()
