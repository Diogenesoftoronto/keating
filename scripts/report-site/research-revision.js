// Exact authored dialogue and an illustrative scoring rule. No model calls.
(() => {
  const select = document.getElementById('revision-case');
  if (select) {
    const show = () => document.querySelectorAll('[data-revision-case]').forEach(panel => {
      panel.hidden = panel.dataset.revisionCase !== select.value;
    });
    select.addEventListener('change', show);
    show();
  }
  const examples = {
    difficulty: {
      prefix: 'I keep taking 6 away from 30. I tried that again and it still does not work.',
      need: 'Need: explanation warranted by the recurring misconception.',
      span: '6x means six times x. Divide both sides by 6 to undo that multiplication.',
      rest: ' What does that leave?', fit: 'Fit: appropriate, substantive and mathematically correct.',
      grade: '2 / 2', value: '+1', effect: 'Encourage this move'
    },
    progress: {
      prefix: '6x is six times x, so I divide by 6. Hang on, I am checking both sides.',
      need: 'Need: room to finish a valid reasoning step.',
      span: '6x means six times x. Divide both sides by 6 to undo that multiplication.',
      rest: ' What does that leave?', fit: 'Illustrated fit: overhelp, interrupting work the learner is already doing.',
      grade: '0 / 2', value: '−1', effect: 'Discourage this move'
    },
    withhold: {
      prefix: 'I keep taking 6 away from 30. I tried that again and it still does not work.',
      need: 'Need: explanation warranted by the recurring misconception.',
      span: 'Think harder. What do you think the next step is?', rest: '',
      fit: 'Fit: underhelp, leaving the recurring misconception unaddressed.',
      grade: '0 / 2', value: '−1', effect: 'Discourage this move'
    }
  };
  document.querySelectorAll('[data-reward-context]').forEach(button => button.addEventListener('click', () => {
    const example = examples[button.dataset.rewardContext];
    document.querySelectorAll('[data-reward-context]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    for (const key of ['prefix', 'need', 'fit', 'grade', 'value', 'effect']) document.getElementById(`reward-${key}`).textContent = example[key];
    const mark = document.createElement('mark'); mark.textContent = example.span;
    document.getElementById('reward-response').replaceChildren(mark, document.createTextNode(example.rest));
  }));
})();
