// Local views over frozen measurements. All example text is rendered by the builder.
(() => {
  const dataset = document.getElementById('dataset-workbench');
  if (dataset) {
    const select = dataset.querySelector('#dataset-choice');
    const panels = [...dataset.querySelectorAll('[data-dataset-panel]')];
    const show = () => panels.forEach(panel => { panel.hidden = panel.dataset.datasetPanel !== select.value; });
    select.addEventListener('change', show);
    select.value = '0';
    show();
    dataset.classList.add('enhanced');
  }
  const probe = document.getElementById('probe-workbench');
  const payload = document.getElementById('probe-inspection-data');
  if (!probe || !payload) return;
  const data = JSON.parse(payload.textContent);
  const choice = probe.querySelector('#probe-choice');
  const slider = probe.querySelector('#probe-threshold');
  const panels = [...probe.querySelectorAll('[data-probe-panel]')];
  const show = () => panels.forEach(panel => { panel.hidden = panel.dataset.probePanel !== choice.value; });
  const diagnose = () => {
    const threshold = Number(slider.value);
    const counts = {caught: 0, missed: 0, clear: 0, falseAlarm: 0};
    data.examples.forEach((row, index) => {
      const predicted = Number(row.scores.sae >= threshold);
      const matched = predicted === row.label;
      counts[row.label ? (predicted ? 'caught' : 'missed') : (predicted ? 'falseAlarm' : 'clear')]++;
      const panel = panels[index];
      const verdict = panel.querySelector('[data-probe-verdict]');
      verdict.textContent = matched ? 'Matches label' : row.label ? 'Missed premature answer' : 'False alarm';
      verdict.classList.toggle('mismatch', !matched);
      panel.querySelector('[data-decision-threshold]').textContent = threshold.toFixed(2);
      panel.querySelector('.threshold-marker').style.setProperty('--threshold', `${threshold * 100}%`);
    });
    probe.querySelector('#threshold-value').textContent = threshold.toFixed(2);
    const summary = probe.querySelector('#probe-confusion');
    summary.replaceChildren(...[
      [`${data.examples.length} held-out records`, `${counts.caught + counts.clear} correct`],
      ['Premature answers caught', counts.caught], ['Premature answers missed', counts.missed],
      ['Correct negatives', counts.clear], ['False alarms', counts.falseAlarm]
    ].map(([label, value]) => {
      const item = document.createElement('span');
      item.append(document.createTextNode(`${label}: `));
      const count = document.createElement('b');
      count.textContent = String(value);
      item.append(count);
      return item;
    }));
  };
  choice.addEventListener('change', show);
  slider.addEventListener('input', diagnose);
  probe.querySelector('#reset-threshold').addEventListener('click', () => {
    slider.value = String(data.measurement.threshold);
    diagnose();
  });
  choice.value = '0';
  show();
  diagnose();
  probe.classList.add('enhanced');
})();
