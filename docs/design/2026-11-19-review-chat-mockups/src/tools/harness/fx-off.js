(() => {
  let cur = {};
  try { cur = JSON.parse(localStorage.getItem('keating_ui_settings') || '{}'); } catch {}
  localStorage.setItem('keating_ui_settings', JSON.stringify({ ...cur, visualEffects: false }));
  return 'fx preference off';
})()
