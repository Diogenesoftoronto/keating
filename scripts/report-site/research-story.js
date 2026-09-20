// Recorded evidence only. No model calls or remote data dependencies.
const buttons = [...document.querySelectorAll('[data-trace-step]')];
const panels = [...document.querySelectorAll('[data-trace-panel]')];
function selectTrace(step) {
  buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.traceStep === step)));
  panels.forEach(panel => { panel.hidden = panel.dataset.tracePanel !== step; });
}
buttons.forEach(button => button.addEventListener('click', () => selectTrace(button.dataset.traceStep)));
if (buttons.length) selectTrace('1');

const dataElement = document.getElementById('behavior-data');
if (dataElement) {
  const data = JSON.parse(dataElement.textContent);
  const categories = [...document.querySelectorAll('[data-category]')];
  const arms = ['Initial', 'F-only', 'S-only', 'F+S'];
  function showCategory(category) {
    const counts = category === 'all' ? data.by_arm : data.by_category[category];
    categories.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    arms.forEach(arm => {
      document.querySelector(`[data-bar="${arm}"]`).style.width = `${counts[arm].pass / counts[arm].scheduled * 100}%`;
      document.querySelector(`[data-count="${arm}"]`).textContent = `${counts[arm].pass}/${counts[arm].scheduled}`;
    });
    const cases = data.cases.filter(item => category === 'all' || item.category === category);
    const tbody = document.getElementById('family-rows');
    tbody.replaceChildren(...cases.map(item => {
      const row = document.createElement('tr');
      const title = document.createElement('th');
      title.scope = 'row';
      title.textContent = item.family_id.replaceAll('-', ' ');
      row.append(title);
      arms.forEach(arm => {
        const samples = data.rows.filter(sample => sample.case_id === item.id && sample.arm === arm);
        const cell = document.createElement('td');
        cell.textContent = `${samples.filter(sample => sample.task_pass === 1).length}/${samples.length}`;
        row.append(cell);
      });
      return row;
    }));
    document.getElementById('behavior-note').textContent = `${cases.length} task families · ${counts.Initial.scheduled} responses per arm · ${category === 'retention' ? 'capability checks, not delayed learner retention.' : 'no improvement observed.'}`;
  }
  categories.forEach(button => button.addEventListener('click', () => showCategory(button.dataset.category)));
  showCategory('all');
}
