import { mountBenchmarkCharts, modelProvider } from './benchmark-charts.js';
import { renderPreview } from './openui-preview.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
function disclosure(label, content) {
  const box = el('details'), title = el('summary', label), body = el('pre', typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  body.tabIndex = 0; body.className = 'v3-source'; box.append(title, body); return box;
}
export function v3ChartCostBasis(data, basis = 'reported') {
  if (basis !== 'uncached') return data;
  return { ...data, models: data.models.map(model => ({ ...model, rows: model.rows.map(row => ({
    ...row,
    cost_usd: typeof row.estimated_uncached_cost_usd === 'number' && Number.isFinite(row.estimated_uncached_cost_usd) && row.estimated_uncached_cost_usd >= 0
      ? row.estimated_uncached_cost_usd : null,
  })) })) };
}
let resultsPromise;
export function loadV3Data() {
  return resultsPromise ??= fetch('./benchmark-v3-results.json').then(response => {
    if (!response.ok) throw Error('Results unavailable');
    return response.json();
  });
}
export async function mountV3Results(host) {
  host.append(el('p', 'Loading the recorded v3.2 episodes…', 'caption'));
  let data;
  try {
    data = await loadV3Data();
  } catch {
    host.replaceChildren(el('p', 'The recorded results could not be loaded. Reload the page to retry.', 'caption')); return;
  }
  host.replaceChildren();
  const rows = data.models.flatMap(m => m.rows), completed = rows.filter(r => r.status === 'completed').length;
  const failed = rows.filter(r => r.status === 'failed').length, pending = rows.filter(r => r.status === 'pending').length;
  const scored = rows.filter(r => typeof r.quality === 'number').length;
  const limited = rows.filter(r => r.delivery_status === 'output_limited').length;
  host.append(el('h3', 'What happened in the real harness'),
    el('p', `${completed} completed · ${failed} failed · ${pending} pending · ${scored} scored of ${rows.length} planned episodes`, 'v3-run-status'),
    el('p', data.method_note, 'caption'));
  if (data.exported_at) host.append(el('p', `Recorded snapshot: ${data.exported_at}. This page does not refresh running experiments automatically.`, 'caption'));
  host.append(el('p', 'Configuration matters: Kimi and GLM advertise maximum reasoning by default, and this frozen Pi endpoint path does not forward reasoning effort. Native Tinker controls also differ. These runs compare the recorded harness configurations, not models at matched reasoning budgets.', 'caption'));
  if (limited) host.append(el('p', `${limited} completed harness episodes contain an output-limit stop. They are shown as delivery-limited and excluded from aggregate semantic scores; their traces, usage and original reviews remain inspectable.`, 'caption'));
  if (data.interrupted_attempts.length) host.append(el('p', `${data.interrupted_attempts.length} earlier attempts were interrupted by a host restart. Saved complete episodes were retained and unfinished cases restarted. Usage from the interrupted attempts is unknown and excluded from cost totals.`, 'caption'));
  if (data.superseded_provider_attempts?.length) host.append(el('p', `${data.superseded_provider_attempts.length} provider-failed attempts were superseded by explicit reruns. They remain recorded separately and are not teaching failures. Their incomplete usage is not included in the per-task cost bars.`, 'caption'));
  const coverage = el('details'); coverage.append(el('summary', 'Review sources by model'));
  for (const model of data.models) coverage.append(el('p', `${model.label}: ${model.rows.filter(r => r.quality !== null && r.quality_source === 'api').length} API scores; ${model.rows.filter(r => r.quality !== null && r.quality_source === 'supplemental').length} supplemental agent scores.`, 'caption'));
  host.append(coverage);
  const interfaces = el('details'); interfaces.append(el('summary', 'Interface delivery by model'));
  for (const model of data.models) {
    const docs = model.rows.flatMap(row => row.ui_documents || []);
    interfaces.append(el('p', `${model.label}: ${docs.filter(d => d.status === 'rendered').length} rendered · ${docs.filter(d => d.status === 'rejected').length} rejected interface documents.`, 'caption'));
  }
  interfaces.append(el('p', 'These are document attempts, not teaching scores. Counts come from terminal extraction and text presentation, without verifying clicks or completed activities. A high text score does not mean the generated activity was usable. No generated document is not itself a failure.', 'caption'));
  host.append(interfaces);
  const charts = el('div'), trace = el('section', '', 'v3-trace'); trace.hidden = true;
  const picker = el('div', '', 'v3-trace-picker'), modelSelect = el('select'), caseSelect = el('select');
  modelSelect.setAttribute('aria-label', 'Choose v3.2 model'); caseSelect.setAttribute('aria-label', 'Choose v3.2 conversation');
  for (const model of data.models) { const option = el('option', model.label); option.value = model.id; modelSelect.append(option); }
  for (const item of data.cases) { const option = el('option', item.title); option.value = item.id; caseSelect.append(option); }
  const modelLabel = el('label', 'Model '), caseLabel = el('label', 'Conversation '); modelLabel.append(modelSelect); caseLabel.append(caseSelect); picker.append(modelLabel, caseLabel);
  const open = el('button', 'Read conversation', 'button'); open.type = 'button';
  open.addEventListener('click', () => show({ model_id: modelSelect.value, case_id: caseSelect.value })); picker.append(open);
  const findings = el('div', '', 'v3-observed-findings');
  findings.append(el('h4', 'Start with a revealing conversation'));
  for (const finding of [
    { model_id: 'gemma-4-31b', case_id: 'context-fractions-fluent', title: 'Gemma · correcting a correct answer' },
    { model_id: 'inkling-small-base', case_id: 'closure-help-new-session', title: 'Inkling · “Saved” after a rejected memory write' },
    { model_id: 'nemotron-lightning', case_id: 'array-bounds-reopen', title: 'Lightning · recording praise the learner never gave' },
    { model_id: 'qwen3.6-35b', case_id: 'profile-life-notation-revision', title: 'Qwen · repairing a rejected memory write' },
    { model_id: 'qwen3-8-27b', case_id: 'profile-linear-baking', title: 'Qwen 3.8 · grading answers nobody submitted' },
  ]) {
    const row = data.models.find(m => m.id === finding.model_id)?.rows.find(r => r.case_id === finding.case_id);
    if (!row?.trace || !row.review) continue;
    const button = el('button', finding.title, 'button'); button.type = 'button';
    button.addEventListener('click', () => show(finding)); findings.append(button);
  }
  if (findings.children.length > 1) host.append(findings);
  const costControls = el('div', '', 'v3-cost-controls'), costSelect = el('select');
  const costLabel = el('label', 'Chart cost basis '), costNote = el('p', '', 'caption');
  costNote.id = 'v3-cost-basis-note'; costNote.setAttribute('role', 'status');
  costSelect.setAttribute('aria-describedby', costNote.id);
  for (const [value, label] of [['reported', 'Reported cache usage'], ['uncached', 'Uncached tariff scenario']]) {
    const option = el('option', label); option.value = value; costSelect.append(option);
  }
  costSelect.value = 'reported'; costLabel.append(costSelect); costControls.append(costLabel, costNote);
  const describeCost = () => {
    costNote.textContent = costSelect.value === 'uncached'
      ? 'Uncached tariff scenario: all input tokens are priced at the uncached input tariff. Native cache usage is unmeasured. These are hypothetical usage estimates, not invoices; missing estimates remain unknown. Only chart costs change, including the cost comparison and Pareto view. Original trace receipts remain unchanged.'
      : 'Reported cache usage: chart costs use the recorded usage estimates and reported cache discounts where available. Native cache usage is unmeasured. These estimates are not invoices. Select the uncached tariff scenario to compare all input at uncached rates; original trace receipts remain unchanged.';
  };
  describeCost();
  host.append(costControls, charts, picker, trace);
  function show({ model_id, case_id }) {
    const model = data.models.find(m => m.id === model_id), item = data.cases.find(c => c.id === case_id);
    const row = model?.rows.find(r => r.case_id === case_id); if (!row || !item) return;
    modelSelect.value = model_id; caseSelect.value = case_id;
    trace.hidden = false; trace.replaceChildren();
    const heading = el('h3', `${model.label} · ${item.title}`); heading.tabIndex = -1;
    const provider = modelProvider(model); trace.style.setProperty('--provider-color', provider.color);
    trace.append(heading, el('p', `${provider.name} · served via ${provider.transport} · ${row.delivery_status || row.status}${row.error_code ? `: ${row.error_code}` : ''}`, 'caption'));
    const docs = row.ui_documents || [];
    if (docs.length) trace.append(el('p', `Interface delivery: ${docs.filter(d => d.status === 'rendered').length} rendered · ${docs.filter(d => d.status === 'rejected').length} rejected documents`, 'v3-run-status'));
    trace.append(disclosure('Model controls and pricing provenance', {settings: model.settings_note, reasoning: model.provider_reasoning_metadata, transport_controls: model.transport_controls, native_settings: model.native_settings, rates: model.rates, cost_note: row.cost_note, uncached_estimate_usd: row.estimated_uncached_cost_usd, native_usage: row.native_usage, runtime_driver_sha256: model.runtime_driver_sha256, input_case_file_hashes: model.input_case_file_hashes}));
    if (!row.trace) { trace.append(el('p', 'No recorded episode yet.')); heading.focus(); return; }
    for (const review of [row.api_review, row.supplemental_review].filter(Boolean)) {
      const notes = [review.delivery_note, ...(review.observations || []).map(note => typeof note === 'string' ? note : note.observation)].filter(Boolean);
      if (!notes.length) continue;
      const observations = el('details'); observations.open = true;
      observations.append(el('summary', `Reviewer observations beyond the score · ${review.reviewer_id}`));
      for (const note of notes) observations.append(el('p', note, 'caption'));
      trace.append(observations);
    }
    if (item.learner_profile) trace.append(disclosure('Starting learner context', item.learner_profile));
    if (item.profile_lifecycle) trace.append(el('p', 'This learner started with an empty profile. Ordinary dialogue supplies the evidence.', 'caption'));
    const prompts = el('details'); prompts.append(el('summary', `Applied system prompts · ${row.trace.system_prompts.length} context revisions`));
    for (const [index, prompt] of row.trace.system_prompts.entries()) prompts.append(disclosure(`Revision ${index + 1} · ${prompt.sha256.slice(0, 12)}`, prompt.text));
    trace.append(prompts);
    for (const step of row.trace.steps) {
      const section = el('div', '', 'v3-step');
      section.append(el('h4', step.kind === 'new_session' ? 'A new session' : step.kind === 'reopen' ? 'Reopen the saved conversation' : `Turn ${step.index + 1}`));
      for (const message of step.messages) {
        if (message.role === 'toolResult') {
          section.append(disclosure(`Tool result · ${message.tool_name || 'tool'}${message.is_error ? ' · error' : ''}`, message.content)); continue;
        }
        const block = el('article', '', `v3-message v3-${message.role}`); block.append(el('strong', message.role === 'user' ? 'Learner' : 'Keating'));
        for (const content of message.content) {
          if (content.type === 'toolCall') { block.append(disclosure(`Tool call · ${content.name}`, content.arguments)); continue; }
          const source = content.text, preview = el('div', '', 'message-preview');
          if (message.role === 'assistant' && renderPreview(preview, source, `${model_id}-${case_id}-${step.index}-${message.index}`)) {
            block.append(el('p', 'Report preview only. The benchmark’s terminal rendering receipt is recorded separately below.', 'caption'), preview, disclosure('Original assistant output', source));
          } else {
            const fences = [...source.matchAll(/```(?:keating-ui|openui)[\s\S]*?```/g)];
            const prose = source.replace(/```(?:keating-ui|openui)[\s\S]*?```/g, '').trim();
            if (prose) block.append(el('p', prose, 'v3-prose'));
            for (const fence of fences) block.append(disclosure('Generated interface source', fence[0]));
          }
        }
        section.append(block);
      }
      if (step.learner_memory.length) section.append(disclosure('Learner memory saved at this turn', step.learner_memory));
      else if (item.profile_lifecycle) section.append(el('p', 'No saved profile observations at this point.', 'caption'));
      if (step.learner_state?.length) section.append(disclosure('Saved learner state and feedback', step.learner_state));
      trace.append(section);
    }
    trace.append(disclosure('Terminal interface receipts', row.ui_documents || []));
    if (row.api_review) trace.append(disclosure('API review and exact evidence', row.api_review));
    if (row.supplemental_review) trace.append(disclosure('Supplemental agent review and exact evidence', row.supplemental_review));
    if (row.review && !row.api_review && !row.supplemental_review) trace.append(disclosure('Independent review and exact evidence', row.review));
    if (!row.review && !row.api_review && !row.supplemental_review) trace.append(el('p', 'No validated semantic review is available for this episode.', 'caption'));
    trace.append(disclosure('Case rubric and reference', { rubric: item.rubric, reference: item.reference }));
    heading.focus();
  }
  const chartView = mountBenchmarkCharts(charts, data, show);
  host.addEventListener('keating:open-v3-trace', event => {
    if (!event.detail) return;
    show(event.detail);
    trace.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  costSelect.addEventListener('change', () => {
    describeCost();
    chartView.update(v3ChartCostBasis(data, costSelect.value));
  });
}

if (typeof document !== 'undefined') {
  const host = document.getElementById('benchmark-v3-results');
  if (host) void mountV3Results(host);
}
