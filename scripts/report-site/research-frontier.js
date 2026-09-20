(() => {
  const source = document.getElementById('frontier-data');
  if (!source) return;
  const data = JSON.parse(source.textContent);
  const form = document.getElementById('source-preview');
  const submit = form.querySelector('button');
  form.addEventListener('change', () => { submit.disabled = !form.querySelector('input:checked'); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const selected = form.querySelector('input:checked');
    if (!selected) return;
    const option = data.activity.document.nodes[0].choices.find(o => o.id === selected.value);
    document.getElementById('source-preview-result').textContent = `Selected ${option.id}: ${option.label}. Local preview only; no correctness judgment, saved progress or model call.`;
  });
  const draw = index => {
    const response = data.episode.responses[index];
    document.querySelectorAll('[data-response]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.response) === index)));
    document.getElementById('frontier-learner').textContent = response.learner_text;
    const reviews = data.episode.review.ratings.filter(r => r.evidence.step_index === response.step_index && r.evidence.message_index === response.message_index);
    const reviewHost = document.getElementById('frontier-review');
    reviewHost.replaceChildren();
    if (!reviews.length) reviewHost.textContent = 'This turn has no assigned rubric dimension. Its original output is preserved for inspection.';
    for (const review of reviews) {
      const title = document.createElement('h4'); title.textContent = `${review.dimension.replaceAll('-', ' ')} · ${review.score}/2`;
      const reason = document.createElement('p'); reason.textContent = review.reason;
      reviewHost.append(title, reason);
    }
    const textHost = document.getElementById('frontier-response'); textHost.replaceChildren();
    // Exact reviewer quotation, not a heuristic match or model-generated probe score.
    const quote = reviews[0]?.evidence.quote;
    const start = quote ? response.text.indexOf(quote) : -1;
    if (start >= 0) {
      const mark = document.createElement('mark'); mark.textContent = quote; mark.title = 'Independent reviewer evidence';
      textHost.append(document.createTextNode(response.text.slice(0, start)), mark, document.createTextNode(response.text.slice(start + quote.length)));
    } else textHost.textContent = response.text;
    document.getElementById('frontier-binding').textContent = JSON.stringify({step_index: response.step_index, message_index: response.message_index, text_sha256: response.text_sha256, response_hash: response.response_hash, probe_status: response.probe_status}, null, 2);
  };
  document.querySelectorAll('[data-response]').forEach(b => b.addEventListener('click', () => draw(Number(b.dataset.response))));
  draw(2);
})();
