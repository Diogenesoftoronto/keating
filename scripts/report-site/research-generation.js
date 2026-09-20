(() => {
  const root = document.getElementById('generation-workbench');
  if (!root) return;
  const task = document.getElementById('generation-task');
  const condition = document.getElementById('generation-condition');
  const update = () => {
    root.querySelectorAll('[data-generation-case]').forEach(panel => {
      panel.hidden = panel.dataset.generationCase !== task.value;
      panel.querySelectorAll('[data-generation-condition]').forEach(output => {
        output.hidden = output.dataset.generationCondition !== condition.value;
      });
    });
  };
  task.addEventListener('change', update);
  condition.addEventListener('change', update);
  root.classList.add('enhanced');
  update();
})();
