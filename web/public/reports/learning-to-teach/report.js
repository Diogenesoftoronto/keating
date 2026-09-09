import { mountBenchmarkCharts, modelProvider } from './benchmark-charts.js';
import { renderPreview } from './openui-preview.js';
const $ = (id) => document.getElementById(id);
export function estimateCost(cost, cachePercent) {
  const fraction = Math.max(0, Math.min(100, cachePercent)) / 100;
  const r = cost.rates_usd_per_million, n = cost.reserved_token_counts;
  const train = n.train * r.train / 1e6;
  const prefill = n.prefill * (r.prefill * (1 - fraction) + r.cached_prefill * fraction) / 1e6;
  const output = n.sample * r.sample / 1e6;
  return { train, prefill, output, total: train + prefill + output };
}
const stages = [
  ['Completed locally','Keep the application real.','A dedicated test account, the actual Keating system prompt, and its 16 declared tools. The first feedback pilot established checkpoint saving, reloading and local serving.','Inkling-Small · rank 16 · native tml_v0'],
  ['Identity changed','Teach a name and a purpose.','The first SFT attempt missed the identity checks. A second pass with smaller batches and repeated short-context examples taught “the latest version of Keating Bot” and its generative-learning philosophy.','36 training examples · 12 held out · 48 updates in the second pass'],
  ['Checkpoint verified','Continue from learner feedback.','Four SDPO-inspired updates started from the SFT checkpoint. Identity survived. The percentage example changed, but the paired probe still did not ask the learner to demonstrate understanding.','Two feedback families · four updates · no teaching-quality win established'],
  ['OpenUI SFT completed','Teach the whole interaction.','Twelve long conversations connect explanation, learner responses, flashcards, quizzes, grading and exams. Two SFT epochs trained the authored interactions. Fresh rollout checks test generation, submissions and grading in isolated memory.','588 messages · 72 tool calls · 8 training / 4 held-out conversations'],
];
function setupStages() {
  const base = document.querySelector('.base-matrix'), adapter = document.querySelector('.adapter-matrix');
  for (let i = 0; i < 64; i++) { const cell = document.createElement('i'); cell.classList.toggle('lit', (i * 7 + 3) % 13 < 3); base.append(cell); }
  for (let i = 0; i < 16; i++) adapter.append(document.createElement('i'));
  document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.stage), stage = stages[index];
    document.querySelectorAll('[data-stage]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    ['stage-status','stage-title','stage-body','stage-detail'].forEach((id, i) => $(id).textContent = stage[i]);
    [...adapter.children].forEach((cell, i) => cell.classList.toggle('lit', index > 0 && (i * 5 + index) % 7 < index + 1));
  }));
}
function setupSimulation() {
  $('side').addEventListener('input', () => {
    const side = Number($('side').value);
    $('side-value').textContent = `${side} m`; $('area-value').textContent = `${side * side} m²`;
    $('area-square').style.setProperty('--side', side); $('square-label').textContent = `${side} × ${side}`;
  });
}
function appendOriginalOutput(host, content) {
  const details = document.createElement('details'); details.className = 'trace-source';
  const summary = document.createElement('summary'); summary.textContent = 'Inspect original output';
  const pre = document.createElement('pre'); pre.textContent = content; pre.tabIndex = 0;
  pre.setAttribute('aria-label', 'Original model output');
  details.append(summary, pre); host.append(details);
}
function appendTraceResponse(host, message, id) {
  if (message.role === 'assistant') {
    const preview = document.createElement('div');
    if (renderPreview(preview, message.content, id)) {
      host.append(preview); appendOriginalOutput(host, message.content); return;
    }
    // Keep unsupported model-authored markup as evidence, never as page HTML
    // or a wall of escaped attributes in the prose column.
    const marker = message.content.search(/```(?:openui|keating-ui)\b|(?:<|&lt;)\/?(?:openui|keating-ui)(?=[\s:>\/-])/i);
    if (marker >= 0) {
      const intro = message.content.slice(0, marker).trim();
      if (intro) { const p = document.createElement('p'); p.textContent = intro; host.append(p); }
      const note = document.createElement('p'); note.className = 'trace-render-error';
      note.textContent = 'This response contains UI markup that Keating could not render. The original output is preserved below.';
      host.append(note); appendOriginalOutput(host, message.content); return;
    }
  }
  const text = document.createElement('p'); text.textContent = presentMessage(message).content; host.append(text);
}
function appendSystemPrompt(host, data, digest, context) {
  const prompt = data.system_prompts?.[digest];
  const details = document.createElement('details'); details.className = 'system-prompt-viewer';
  const summary = document.createElement('summary'); summary.textContent = 'Read system prompt';
  details.append(summary);
  if (!prompt) {
    const missing = document.createElement('p'); missing.textContent = 'The recorded system prompt is unavailable.'; details.append(missing);
  } else {
    const meta = document.createElement('p'); meta.className = 'prompt-metadata';
    meta.textContent = `${context} ${prompt.scope} ${prompt.tool_count} tool schemas. SHA-256: ${prompt.sha256}`;
    const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', prompt.label);
    // Create the large text node only when opened; retain exact recorded bytes.
    details.addEventListener('toggle', () => { if (details.open && !pre.textContent) pre.textContent = prompt.text; });
    details.append(meta, pre);
  }
  host.append(details);
}
function setupComparisons(data) {
  const comparison = data.three_arm;
  $('probe').replaceChildren();
  comparison.scenarios.forEach(s => { const option = document.createElement('option'); option.value = s.id; option.textContent = s.title; $('probe').append(option); });
  const render = () => {
    const scenario = comparison.scenarios.find(s => s.id === $('probe').value);
    $('probe-question').textContent = scenario.turns[0];
    for (const arm of ['base','sft','sdpo']) {
      const host = $(`${arm}-response`); host.replaceChildren();
      const trace = comparison.traces.find(t => t.scenario === scenario.id && t.arm === arm);
      if (!trace) { host.textContent = 'No recorded trace.'; continue; }
      appendSystemPrompt(host, data, comparison.system_prompt_sha256, 'Same recorded prompt for all three checkpoints.');
      for (const [i,message] of trace.messages.entries()) {
        if (i === 0) continue;
        const block = document.createElement('div'); block.className = `trace-message trace-${message.role}`;
        const label = document.createElement('small'); label.textContent = message.role === 'user' ? 'Learner follow-up' : 'Model response'; block.append(label);
        appendTraceResponse(block, message, `${scenario.id}-${arm}-${i}`);
        host.append(block);
      }
      if(trace.stopped_for_tool_execution){const note=document.createElement('p');note.className='trace-limit';note.textContent='Trace stopped at a native tool request. The tool was not executed.';host.append(note);}
      if(trace.usage?.some(u=>u.at_token_limit)){const note=document.createElement('p');note.className='trace-limit';note.textContent='Output reached the 2,048-token limit; inspect the source for truncation.';host.append(note);}
    }
    $('comparison-note').textContent = comparison.observations?.[scenario.id] ?? 'All three checkpoints received the same current Keating prompt, tool declarations and scripted learner inputs. Differences here are qualitative observations.';
  }; $('probe').addEventListener('change',render); render();
}
export function presentMessage(message) {
  if (message.tool_calls?.length) return { kind: 'Assistant → native tool call', content: [message.content, ...message.tool_calls.map(call => `${call.function.name}\n${JSON.stringify(JSON.parse(call.function.arguments), null, 2)}`)].filter(Boolean).join('\n\n') };
  if (message.role === 'tool') return { kind: `Tool result → ${message.name}`, content: message.content };
  if (message.content.startsWith('<keating-learner-response')) {
    const match = message.content.match(/\n([\s\S]+)\n<\/keating-learner-response>/);
    if (match) { const e = JSON.parse(match[1]); return { kind: `Learner → ${e.review.title}`, content: [e.review.summary, ...e.review.items.map(i => `${i.label}: ${i.value}`)].filter(Boolean).join('\n\n') }; }
  }
  return { kind: message.role === 'user' ? 'Learner message' : message.content.startsWith('```openui') ? 'Assistant → OpenUI source' : 'Assistant reply', content: message.content };
}
function setupConversations(data) {
  appendSystemPrompt($('conversation-prompt-viewer'), data, data.conversation_system_prompt_sha256, 'Prepended when these authored conversations were compiled for training or validation.');
  data.conversations.forEach((c, index) => { const option = document.createElement('option'); option.value = index; option.textContent = `${c.family} / ${c.variant}`; $('conversation').append(option); });
  let conversation = data.conversations[0], index = 0;
  const render = () => {
    const message = conversation.messages[index], display = presentMessage(message);
    $('turn-range').value = index; $('turn-range').max = conversation.messages.length - 1;
    $('turn-count').textContent = `${index + 1} / ${conversation.messages.length}`;
    $('turn-role').textContent = message.role === 'user' ? 'Learner' : message.role === 'tool' ? 'Tool' : 'Keating';
    $('message-kind').textContent = display.kind;
    const preview = renderPreview($('message-preview'), message.content, `${conversation.id}-${index}`);
    $('message-preview').hidden = !preview; $('source-toggle').hidden = !preview; $('source-toggle').open = false;
    (preview ? $('source-toggle') : $('plain-message')).append($('message-content'));
    $('plain-message').hidden = preview; $('message-content').textContent = display.content; $('message-content').scrollTop = 0;
    $('previous-turn').disabled = index === 0; $('next-turn').disabled = index === conversation.messages.length - 1;
    $('session-meta').textContent = `${conversation.split === 'train' ? 'Training' : 'Held-out'} topic family · synthetic session`;
    document.querySelectorAll('[data-jump]').forEach(button => { button.disabled = !conversation.messages.some(m => m.tool_calls?.some(c => c.function.name === button.dataset.jump) || (button.dataset.jump.endsWith('(') && m.role === 'assistant' && m.content.includes(button.dataset.jump))); });
  };
  $('conversation').addEventListener('change', () => { conversation = data.conversations[Number($('conversation').value)]; index = 0; render(); });
  $('turn-range').addEventListener('input', () => { index = Number($('turn-range').value); render(); });
  $('previous-turn').addEventListener('click', () => { index = Math.max(0, index - 1); render(); });
  $('next-turn').addEventListener('click', () => { index = Math.min(conversation.messages.length - 1, index + 1); render(); });
  document.querySelectorAll('[data-jump]').forEach(button => button.addEventListener('click', () => {
    const found = conversation.messages.findIndex(m => m.tool_calls?.some(c => c.function.name === button.dataset.jump) || (button.dataset.jump.endsWith('(') && m.role === 'assistant' && m.content.includes(button.dataset.jump)));
    if (found >= 0) { index = found; render(); }
  })); render();
}
function setupInteractionRound(data) {
  const round=data.interaction_round;if(!round)return;
  $('interaction-summary').textContent=round.summary;
  const arms=['before','after','sdpo'];
  for(const scenario of round.cases){
    const option=document.createElement('option');option.value=scenario.id;option.textContent=scenario.topic+' / '+scenario.kind;$('interaction-case').append(option);
    const row=document.createElement('tr'),name=document.createElement('th');name.scope='row';name.textContent=option.textContent;row.append(name);
    for(const arm of arms){const cell=document.createElement('td');const trace=round[arm]?.find(t=>t.scenario.id===scenario.id);cell.textContent=!trace?'Pending':trace.passed?'Passed':trace.creation.passed?'Grading failed':'Creation failed';cell.dataset.passed=String(Boolean(trace?.passed));row.append(cell);}$('interaction-table-body').append(row);
  }
  const render=()=>{const scenario=round.cases.find(c=>c.id===$('interaction-case').value);$('interaction-prompt').textContent=scenario.prompt;
    for(const arm of arms){const host=$('interaction-'+arm);host.replaceChildren();const trace=round[arm]?.find(t=>t.scenario.id===scenario.id);if(!trace){host.textContent='No recorded result.';continue;}
      appendSystemPrompt(host,data,trace.system_prompt_sha256,'Recorded evaluation prompt, unchanged across these checkpoints.');
      for(const [i,message]of trace.messages.entries()){if(i===0)continue;const block=document.createElement('div');block.className='trace-message trace-'+message.role;const label=document.createElement('small');label.textContent=message.role==='user'?'Synthetic learner submission':message.role==='tool'?'Actual local tool result':'Model response';block.append(label);
        appendTraceResponse(block,message,`round-${arm}-${scenario.id}-${i}`);host.append(block);
      }
      const verdict=document.createElement('p');verdict.className='trace-limit';verdict.textContent=(trace.grading??trace.creation).feedback;host.append(verdict);
    }
    $('interaction-observation').textContent=round.observations?.[scenario.id]??'All arms receive the same application context and learner request. Submissions are derived from each model’s own generated activity.';
  };$('interaction-case').addEventListener('change',render);render();
}
function setupCosts(data) {
  const money = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' });
  const render = () => {
    const percent = Number($('cache').value), costs = estimateCost(data.cost, percent);
    $('cache-value').textContent = `${percent}%`; $('cost-total').textContent = money.format(costs.total);
    ['train','prefill','output'].forEach(key => { $(`${key}-cost`).textContent = money.format(costs[key]); $(`${key}-bar`).style.flexGrow = costs[key]; });
  }; $('cache').addEventListener('input', render); render();
}
export function selectBenchmarkCases(benchmark, tier = 'core', category = 'all') {
  const core = new Set(benchmark.core_case_ids);
  return benchmark.cases.filter(item => (tier === 'all' || core.has(item.id)) && (category === 'all' || item.category === category));
}
export function benchmarkCaseResponses(benchmark, caseId) {
  return (benchmark.results?.arms ?? []).map(arm => ({ arm, result: arm.responses.find(row => row.case_id === caseId) ?? null }));
}
let selectedBenchmarkArms = new Set();
let refreshBenchmarkArmPicker = () => {};
function setupBenchmarkArmPicker(results) {
  const originals = results.arms.filter(arm => ['base', 'identity-sft-run-v2', 'openui-sft-run', 'openui-sdpo-run'].includes(arm.requested_model));
  selectedBenchmarkArms = new Set((originals.length ? originals : results.arms).slice(0, 4).map(arm => arm.id));
  const picker = $('benchmark-arm-picker'); picker.hidden = results.arms.length <= 4;
  if (picker.hidden) return;
  const options = $('benchmark-arm-options'); options.replaceChildren();
  const update = () => {
    options.querySelectorAll('input').forEach(input => {
      input.checked = selectedBenchmarkArms.has(input.value);
      input.disabled = !input.checked && selectedBenchmarkArms.size >= 4;
    });
    $('benchmark-arm-count').textContent = `${selectedBenchmarkArms.size} of 4 selected`;
    $('benchmark-case').dispatchEvent(new Event('change'));
  };
  refreshBenchmarkArmPicker = update;
  for (const arm of results.arms) {
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = arm.id;
    const text = document.createElement('span'); text.textContent = arm.label;
    input.addEventListener('change', () => { if (input.checked) selectedBenchmarkArms.add(arm.id); else selectedBenchmarkArms.delete(arm.id); update(); });
    label.append(input, text); options.append(label);
  }
  $('benchmark-original-arms').disabled = originals.length === 0;
  $('benchmark-original-arms').addEventListener('click', () => { selectedBenchmarkArms = new Set(originals.slice(0, 4).map(arm => arm.id)); update(); });
  $('benchmark-base-only').addEventListener('click', () => { const base = results.arms.find(arm => arm.requested_model === 'base') ?? results.arms[0]; selectedBenchmarkArms = new Set([base.id]); update(); });
  $('benchmark-clear-arms').addEventListener('click', () => { selectedBenchmarkArms.clear(); update(); });
  update();
}
function appendBenchmarkEvidence(host, row) {
  const details = document.createElement('details'); details.className = 'benchmark-result-evidence';
  const summary = document.createElement('summary'); summary.textContent = 'Inspect response and check evidence';
  const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Recorded response and deterministic check evidence');
  pre.textContent = JSON.stringify({ response: row.response, response_sha256: row.response_sha256, public_response_sha256: row.public_response_sha256, delivery: row.delivery, contracts: row.contracts, timing: row.timing, human_scores: row.human_scores }, null, 2);
  details.append(summary, pre); host.append(details);
}
function setupBenchmarkResultSummary(benchmark) {
  const results = benchmark.results;
  if (!results?.arms?.length) return;
  $('benchmark-results-summary').hidden = false;
  $('benchmark-status').textContent = 'Responses collected · teaching unreviewed';
  const untested = benchmark.case_count - results.case_ids.length;
  const crossProvider = results.comparison_kind === 'descriptive-cross-provider';
  $('benchmark-results-scope').textContent = `${results.arms.length} requested model arms · ${results.case_ids.length} fixed cases each · requested temperature ${results.settings.temperature} · requested seed ${results.settings.seed}. ${untested ? `${untested} remaining cases have not been tested.` : 'All frozen cases are included.'}`;
  if (crossProvider) {
    $('benchmark-provider-caveat').hidden = false;
    $('benchmark-provider-caveat').textContent = 'Across providers this is a descriptive comparison. The cases, prompt and tools are frozen, but supported temperature, seed and reasoning controls differ. Inspect each model’s effective settings before attributing differences to model quality.';
    $('benchmark-comparison-protocol').textContent = 'Same fixed situations, application prompt and tool definitions. Native provider controls and defaults differ; effective settings are recorded per model. Human teaching ratings remain separate from delivery and UI/tool checks.';
  }
  setupBenchmarkArmPicker(results);
  $('benchmark-summary-body').replaceChildren();
  for (const arm of results.arms) {
    const row = document.createElement('tr');
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = arm.label;
    const identity = modelProvider({ ...arm, model: arm.requested_model });
    name.style.color = identity.color;
    const provider = document.createElement('small'); provider.textContent = `${identity.name} · via ${identity.transport}`; name.append(provider);
    row.append(name);
    const s = arm.summary, contracts = s.contracts;
    const timing = s.timing, latency = timing?.median_response_wall_time_seconds, rate = timing?.median_response_end_to_end_output_tokens_per_second;
    const delivery = `${s.delivery.pass}/${s.cases}${s.delivery.error ? `; ${s.delivery.error} ${arm.access_failure ? 'access failures' : 'request errors'}` : ''}${s.delivery.missing ? `; ${s.delivery.missing} missing` : ''}`;
    const latencyText = latency == null ? `Not measured${timing?.timed_requests ? ` for actual responses; ${timing.timed_requests}/${s.cases} requests timed` : ''}` : `${latency.toFixed(2)} s · ${timing.response_measured}/${s.cases} responses timed`;
    for (const text of [delivery, String(s.truncated), `${contracts.passed}/${contracts.checked} checked${contracts.missing ? `; ${contracts.missing} missing` : ''}`, latencyText, rate == null ? 'Not measured' : `${rate.toFixed(1)} · ${timing.response_output_rate_measured}/${s.cases} measured`, 'Unreviewed']) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    $('benchmark-summary-body').append(row);
  }
  const observations = results.qualitative_review?.observations ?? [];
  if (observations.length) {
    const jumps = $('benchmark-reading-jumps'); jumps.hidden = false; jumps.replaceChildren();
    const label = document.createElement('span'); label.textContent = 'Read the AI observations:'; jumps.append(label);
    for (const observation of observations) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = observation.title;
      button.addEventListener('click', () => {
        const evidenceModels = new Set(observation.evidence.map(entry => entry.requested_model));
        selectedBenchmarkArms = new Set(results.arms.filter(arm => evidenceModels.has(arm.requested_model)).slice(0, 4).map(arm => arm.id));
        refreshBenchmarkArmPicker();
        $('benchmark-category').value = 'all'; $('benchmark-category').dispatchEvent(new Event('change'));
        $('benchmark-case').value = observation.case_id; $('benchmark-case').dispatchEvent(new Event('change'));
        $('benchmark-reading').scrollIntoView({ block: 'start' });
      });
      jumps.append(button);
    }
  }
  if (results.cost) {
    const cost = results.cost, money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
    $('benchmark-cost-note').hidden = false;
    $('benchmark-token-cost').textContent = `Original four Inkling arms: ${money(cost.estimated_token_cost_usd.all_cached)}–${money(cost.estimated_token_cost_usd.uncached)} estimated token cost from ${cost.input_tokens.toLocaleString()} input and ${cost.output_tokens.toLocaleString()} output tokens. ${(cost.discount_already_in_rates * 100).toFixed(0)}% discount included; cache hits unmeasured. This is not an invoice.`;
    $('benchmark-reservation-cost').textContent = `Original $100 ledger: ${money(cost.safety_reservation_usd)} reserved for Inkling benchmark sampling; ${money(cost.budget_reserved_after_usd)} reserved in total, leaving ${money(cost.headroom_usd)} of reservation headroom. Storage excluded. The external-model evaluation budget is separate.`;
  }
  if (results.external_cost) {
    const cost = results.external_cost, money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(value);
    const armCount = cost.batches.reduce((total, batch) => total + batch.arms.length, 0);
    $('benchmark-external-cost-note').hidden = false;
    $('benchmark-external-usage-cost').textContent = `External models, separate ${money(cost.authorized_cap_usd)} authorization: ${money(cost.estimated_usage_cost_usd)} estimated from reported usage across ${armCount} model arms. Cached reads are priced conservatively at the input rate; this is not a reconciled invoice.`;
    $('benchmark-external-reservation-cost').textContent = `${money(cost.reserved_usd)} remains reserved for failed or unmetered requests, leaving ${money(cost.headroom_usd)} of evaluation budget headroom. Batch subcaps total ${money(cost.allocated_batch_caps_usd)}. The original $100 training ledger is unchanged.`;
  }
  $('prompt-revision-copy').textContent = 'We aligned the Keating Bot identity, removed legacy quiz/deck schemas, clarified when to explain directly and made plan depth flexible. The earlier comparisons retain their original prompt. The fixed benchmark above now compares the models using this later revision; those responses still await human teaching review.';
}
function renderBenchmarkResults(data, item) {
  const benchmark = data.benchmark;
  if (!benchmark.results?.arms?.length) return;
  $('benchmark-model-results').hidden = false;
  const allRows = benchmarkCaseResponses(benchmark, item.id), rows = allRows.filter(({ arm }) => selectedBenchmarkArms.has(arm.id)), tested = allRows.some(({ result }) => result !== null);
  $('benchmark-continuation-heading').textContent = tested ? 'Compare the continuations below' : 'This situation has not been tested';
  $('benchmark-continuation-note').textContent = tested ? 'Each requested model received this same fixed prefix. Teaching ratings remain unreviewed.' : 'It remains part of the full benchmark. No response or score has been inferred.';
  $('benchmark-case-result-note').textContent = tested ? `${item.title}. OpenUI controls below are isolated report previews; no new model requests are made.` : 'Not tested: this case was outside the measured subset.';
  const notes = benchmark.results.qualitative_review?.observations?.filter(observation => observation.case_id === item.id) ?? [];
  $('benchmark-reading').hidden = notes.length === 0; $('benchmark-reading-notes').replaceChildren();
  for (const note of notes) {
    const text = document.createElement('p'); text.textContent = note.text;
    const evidence = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Read the supporting response excerpts'; evidence.append(summary);
    for (const entry of note.evidence) {
      const quote = document.createElement('blockquote'); const body = document.createElement('p'); body.textContent = entry.quote;
      const label = document.createElement('footer'); label.textContent = entry.label;
      quote.append(body, label); evidence.append(quote);
    }
    $('benchmark-reading-notes').append(text, evidence);
  }
  const grid = $('benchmark-model-responses'); grid.replaceChildren();
  if (!rows.length) { const empty = document.createElement('p'); empty.className = 'benchmark-no-arms'; empty.textContent = 'Choose up to four models above to compare their responses.'; grid.append(empty); }
  for (const { arm, result } of rows) {
    const article = document.createElement('article'); article.className = 'benchmark-model-response';
    const heading = document.createElement('h4'); heading.textContent = arm.label; article.append(heading);
    if (!result) {
      const empty = document.createElement('p'); empty.className = 'benchmark-result-note'; empty.textContent = 'Not tested for this case.'; article.append(empty); grid.append(article); continue;
    }
    const status = document.createElement('p'); status.className = 'benchmark-response-status';
    const deliveryLabel = arm.access_failure ? 'Provider access failure' : ({ pass: 'Delivered', fail: 'No required visible response', error: 'Provider error', missing: 'No response collected' })[result.delivery.status] ?? 'Delivery unknown';
    const contractLabel = result.contracts.contract_passed === true ? 'contracts pass' : result.contracts.contract_passed === false ? 'contract failure' : 'contracts unscored';
    status.textContent = `${deliveryLabel} · ${contractLabel}${result.delivery.truncated ? ' · output limit reached' : ''}`;
    status.dataset.failed = String(result.delivery.status !== 'pass' || result.contracts.contract_passed === false || result.delivery.truncated);
    article.append(status);
    if (arm.access_failure) { const note = document.createElement('p'); note.className = 'benchmark-result-note'; note.textContent = `${arm.access_failure.note} This is not a model-quality result.`; article.append(note); }
    if (result.timing) {
      const note = document.createElement('p'); note.className = 'benchmark-latency-note';
      const rate = result.timing.end_to_end_output_tokens_per_second;
      note.textContent = `${result.timing.wall_time_seconds.toFixed(2)} s end-to-end${rate == null ? '' : ` · ${rate.toFixed(1)} reported output tokens/s`}. Includes request processing; not decode throughput.`; article.append(note);
    }
    if (arm.generation) {
      const controls = document.createElement('details'); controls.className = 'benchmark-generation-controls';
      const summary = document.createElement('summary'); summary.textContent = arm.generation.compatibility.identical_generation_settings ? 'Inspect sampling controls' : 'Inspect provider setting differences';
      const note = document.createElement('p'); note.textContent = arm.generation.compatibility.note;
      const pre = document.createElement('pre'); pre.tabIndex = 0; pre.textContent = JSON.stringify(arm.generation, null, 2);
      controls.append(summary, note, pre); article.append(controls);
    }
    appendSystemPrompt(article, data, benchmark.system_prompt_sha256, 'Exact shared prompt used in this fixed benchmark comparison.');
    const content = result.response.content ?? '';
    const body = document.createElement('div'); body.className = 'benchmark-response-content';
    if (content.trim()) appendTraceResponse(body, { role: 'assistant', content }, `measured-${item.id}-${arm.id}`);
    else if (!result.response.tool_calls.length) {
      const empty = document.createElement('p'); empty.className = 'benchmark-result-note';
      empty.textContent = result.response.error ? 'The request did not produce a usable model response. Inspect the recorded status below.' : 'The model returned no visible text and no native tool call.'; body.append(empty);
    }
    if (result.response.tool_calls.length) {
      const tools = document.createElement('details'); tools.className = 'benchmark-native-calls';
      const summary = document.createElement('summary'); summary.textContent = `${result.response.tool_calls.length} native tool ${result.response.tool_calls.length === 1 ? 'call' : 'calls'} returned`;
      const pre = document.createElement('pre'); pre.tabIndex = 0; pre.textContent = JSON.stringify(result.response.tool_calls, null, 2);
      tools.append(summary, pre); body.append(tools);
      const note = document.createElement('p'); note.className = 'benchmark-result-note'; note.textContent = 'Tool requests are part of the response. Any execution evidence below comes from isolated contract checks.'; body.append(note);
    }
    body.querySelectorAll('input[name]').forEach(input => { input.name = `benchmark-${item.id}-${arm.id}-${input.name}`; });
    article.append(body);
    const failures = result.contracts.checks.filter(check => check.status === 'fail');
    if (failures.length) {
      const details = document.createElement('details'); details.className = 'benchmark-check-failures';
      const summary = document.createElement('summary'); summary.textContent = `${failures.length} failed ${failures.length === 1 ? 'contract check' : 'contract checks'}`;
      const list = document.createElement('ul');
      for (const check of failures) { const entry = document.createElement('li'); entry.textContent = `${check.name}: ${check.evidence}`; list.append(entry); }
      details.append(summary, list); article.append(details);
    }
    appendBenchmarkEvidence(article, result); grid.append(article);
  }
}
function setupBenchmark(data) {
  const benchmark = data.benchmark;
  if (!benchmark) {
    $('benchmark-case').replaceChildren(new Option('Benchmark data unavailable', ''));
    $('benchmark-case').disabled = true;
    $('benchmark-selection').textContent = 'The benchmark definition could not be loaded. No results are available.';
    return;
  }
  const categoryLabels = Object.fromEntries(benchmark.categories.map(category => [category.id, category.label]));
  let tier = 'core';
  setupBenchmarkResultSummary(benchmark);
  $('benchmark-scope').textContent = `${benchmark.case_count} fixed situations · ${benchmark.core_count} core checks · ${benchmark.dimension_count} teaching dimensions`;
  $('benchmark-version-note').textContent = `${benchmark.id} · version ${benchmark.version} · prompt SHA-256: ${benchmark.system_prompt_sha256}`;
  for (const category of benchmark.categories) $('benchmark-category').append(new Option(category.label, category.id));
  const renderCase = () => {
    const item = benchmark.cases.find(candidate => candidate.id === $('benchmark-case').value);
    if (!item) return;
    $('benchmark-case-title').textContent = item.title;
    $('benchmark-selection').textContent = `${categoryLabels[item.category]} · ${item.messages.length} fixed ${item.messages.length === 1 ? 'message' : 'messages'} · ${item.max_tokens.toLocaleString()} output-token limit`;
    $('benchmark-prompt-viewer').replaceChildren();
    appendSystemPrompt($('benchmark-prompt-viewer'), data, benchmark.system_prompt_sha256, benchmark.results ? 'Frozen prompt for this benchmark comparison. Teaching quality remains unreviewed.' : 'Frozen prompt for this benchmark. No benchmark results have been measured yet.');
    const messages = $('benchmark-messages'); messages.replaceChildren();
    item.messages.forEach((message, index) => {
      const block = document.createElement('article'); block.className = `benchmark-message trace-message trace-${message.role}`;
      const label = document.createElement('small');
      label.textContent = message.role === 'user' ? 'Learner' : message.role === 'tool' ? 'Fixed tool result' : 'Fixed tutor turn';
      block.append(label);
      appendTraceResponse(block, message, `benchmark-${item.id}-${index}`);
      block.querySelectorAll('input[name]').forEach(input => { input.name = `benchmark-prefix-${item.id}-${index}-${input.name}`; });
      messages.append(block);
    });
    messages.scrollTop = 0;
    $('benchmark-dimensions').replaceChildren(); $('benchmark-anchors').replaceChildren();
    for (const [dimension, anchors] of Object.entries(item.rubric)) {
      const label = benchmark.rubric.dimensions[dimension]?.label ?? dimension;
      const listItem = document.createElement('li'); listItem.textContent = label; $('benchmark-dimensions').append(listItem);
      const section = document.createElement('div'); section.className = 'benchmark-anchor';
      const heading = document.createElement('h4'); heading.textContent = label; section.append(heading);
      const scale = document.createElement('dl');
      for (const [key, score] of [['zero','0'], ['one','1'], ['two','2']]) {
        const term = document.createElement('dt'); term.textContent = score;
        const definition = document.createElement('dd'); definition.textContent = anchors[key]; scale.append(term, definition);
      }
      section.append(scale); $('benchmark-anchors').append(section);
    }
    $('benchmark-contracts').textContent = JSON.stringify(item.expect, null, 2);
    renderBenchmarkResults(data, item);
  };
  const filter = () => {
    const category = $('benchmark-category');
    for (const option of category.options) option.disabled = option.value !== 'all' && selectBenchmarkCases(benchmark, tier, option.value).length === 0;
    if (category.selectedOptions[0]?.disabled) category.value = 'all';
    const current = $('benchmark-case').value;
    const cases = selectBenchmarkCases(benchmark, tier, category.value);
    $('benchmark-case').replaceChildren(...cases.map(item => new Option(item.title, item.id)));
    if (cases.some(item => item.id === current)) $('benchmark-case').value = current;
    renderCase();
  };
  document.querySelectorAll('[data-benchmark-tier]').forEach(button => {
    const full = button.dataset.benchmarkTier === 'all';
    button.textContent = `Explore ${full ? 'all' : 'core'} ${full ? benchmark.case_count : benchmark.core_count}`;
    button.addEventListener('click', () => {
      tier = button.dataset.benchmarkTier;
      document.querySelectorAll('[data-benchmark-tier]').forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate === button)));
      filter();
    });
  });
  $('benchmark-category').addEventListener('change', filter);
  $('benchmark-case').addEventListener('change', renderCase);
  const bundle = { cases: benchmark.case_definition, rubric: benchmark.rubric, context: benchmark.context, manifest: benchmark.manifest };
  for (const [kind, value] of [['bundle', bundle], ['cases', benchmark.case_definition], ['rubric', benchmark.rubric]]) {
    const button = $(`benchmark-download-${kind}`); button.disabled = false;
    button.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `${benchmark.id}-${kind}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  filter();
}
const reviewSourceLabels = { combined: 'AI rubric score (mixed reviewers)', api: 'AI rubric score (original API)', supplemental: 'AI rubric score (supplemental agents)' };
const knownQuality = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
export function benchmarkReviewScores(row) {
  // Legacy exports have only quality. Once provenance exists, never reinterpret
  // combined quality as an API score, including when the API value is null.
  const api = knownQuality(Object.hasOwn(row, 'quality_api') ? row.quality_api : row.supplemental_review || row.quality_source === 'codex-subagent' ? null : row.quality);
  const supplemental = knownQuality(row.quality_supplemental);
  return { api, supplemental, combined: api ?? supplemental };
}
export function benchmarkReviewView(benchmark, source = 'combined') {
  if (!Object.hasOwn(reviewSourceLabels, source)) throw new Error('Unknown review source');
  const models = benchmark.models.map(model => ({ ...model, rows: model.rows.map(row => ({ ...row, quality: benchmarkReviewScores(row)[source] })) }));
  return { ...benchmark, models, quality_label: reviewSourceLabels[source], quality_available: models.some(model => model.rows.some(row => row.quality !== null)) };
}
export function benchmarkReviewCoverage(benchmark) {
  return benchmark.models.map(model => {
    const scores = model.rows.map(benchmarkReviewScores);
    const count = key => scores.filter(row => row[key] !== null).length;
    const api = count('api'), supplemental = count('supplemental'), combined = count('combined');
    return { id: model.id, label: model.label, api, supplemental, combined, planned: benchmark.case_count, supplemental_fraction: combined ? supplemental / combined : null };
  });
}
function appendReviewEvidence(host, title, review, score, note) {
  const details = document.createElement('details'), summary = document.createElement('summary');
  summary.textContent = `${title}: ${score === null ? 'unscored' : `${score.toFixed(1)} / 100`}`;
  const caption = document.createElement('p'); caption.textContent = note;
  const evidence = document.createElement('pre'); evidence.tabIndex = 0;
  evidence.textContent = review ? JSON.stringify(review, null, 2) : 'No review recorded from this source.';
  details.append(summary, caption, evidence); host.append(details);
}
function setupBenchmarkV2(data) {
  const benchmark = data.benchmark_v2;
  if (!benchmark) return;
  $('benchmark-v2').hidden = false;
  $('benchmark-v2-scope').textContent = `${benchmark.case_count} fixed situations · ${benchmark.models.length} model variants · up to three assistant turns · one attempt per task`;
  $('benchmark-v2-method').textContent = `${benchmark.method_note} These charts retain the recorded v2 evaluation. The subsequent real-harness pilots and current v3.2 cohort have separate chapters and different cases; their scores are not directly comparable.`;
  const candidateCost = benchmark.models.flatMap(model => model.rows).reduce((sum,row) => sum + (row.known_cost_usd || 0), 0);
  const reviewerCost = (benchmark.judge_summary?.known_cost_usd || 0) + (benchmark.judge_summary?.known_calibration_cost_usd || 0);
  $('benchmark-v2-cost').textContent = `${benchmark.cost_note} Known token-cost estimates: $${candidateCost.toFixed(2)} for candidates and $${reviewerCost.toFixed(2)} for original API review including calibration. Actual billing has not been reconciled.${benchmark.review_completion ? ' Supplemental agent execution cost is unknown; it is not included or treated as free.' : ''}`;
  const coverage = benchmarkReviewCoverage(benchmark);
  const total = key => coverage.reduce((sum, model) => sum + model[key], 0);
  $('benchmark-v2-judge').textContent = `Original API scores: ${total('api')}. Supplemental agent scores: ${total('supplemental')}. Combined coverage: ${total('combined')} of ${benchmark.case_count * benchmark.models.length} planned episodes. `;
  if (benchmark.review_completion) $('benchmark-v2-judge').textContent += `${benchmark.review_completion.reviewed} supplemental reviews were completed; ${benchmark.review_completion.reviewed - benchmark.review_completion.scored} have no full numeric score. `;
  $('benchmark-v2-judge').textContent += 'The original GPT-5.6 Sol API reviewer passed eight agent-authored contrast controls; this is not human calibration. It also reviewed Sol responses, so model-family bias remains possible. Supplemental Codex judgments are separate AI reviews and were not cross-calibrated with the API reviewer. Reviewer proportions differ by model, so mixed-score differences may reflect reviewer differences. Neither source establishes human learning gains. Use the source selector to inspect each cohort; missing scores stay unknown. Original rejected review text was not retained; supplemental reviews are new judgments, not recovered API ratings.';
  const exhausted = benchmark.models.flatMap(model => model.rows).filter(row => row.calls.some(call => call.error?.provider_code === 'credit_balance_exhausted')).length;
  if (exhausted) $('benchmark-v2-judge').textContent += ` The OpenAI account returned credit_balance_exhausted on ${exhausted} candidate cases. Those results are unavailable; the remaining providers continued.`;
  $('benchmark-v2-download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(benchmark, null, 2) + '\n'], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'keating-teaching-v2-results.json';document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  const showTrace = ({model_id, case_id}) => {
    const model = benchmark.models.find(item => item.id === model_id);
    const item = benchmark.cases.find(item => item.id === case_id);
    const row = model?.rows.find(item => item.case_id === case_id);
    if (!model || !item || !row) return;
    const host = $('benchmark-v2-trace-body'); host.replaceChildren();
    $('benchmark-v2-trace-title').textContent = `${item.title} · ${model.label}`;
    const prompt = document.createElement('details'); const summary = document.createElement('summary');
    summary.textContent = 'Read the exact system prompt and tool declarations';
    const pre = document.createElement('pre'); pre.textContent = benchmark.context.system_prompt + '\n\n' + JSON.stringify(benchmark.context.tools, null, 2);
    pre.tabIndex = 0; prompt.append(summary, pre); host.append(prompt);
    const prefix = document.createElement('details'); const prefixTitle = document.createElement('summary'); prefixTitle.textContent = `Read the ${item.messages.length}-turn fixed conversation`; prefix.append(prefixTitle);
    const append = (target,message,index) => {
      const article = document.createElement('article'); article.className = `benchmark-message trace-message trace-${message.role}`;
      const label = document.createElement('small'); label.textContent = message.role === 'assistant' ? 'Tutor' : message.role === 'user' ? 'Learner' : 'Isolated tool result'; article.append(label);
      appendTraceResponse(article, {...message,content:message.content || ''}, `v2-${model.id}-${item.id}-${index}`);
      if (message.tool_calls?.length) appendOriginalOutput(article, JSON.stringify(message.tool_calls,null,2));
      target.append(article);
    };
    item.messages.forEach((message,index) => append(prefix,message,`prefix-${index}`)); host.append(prefix);
    row.transcript.forEach((message,index) => append(host,message,index));
    const scores = benchmarkReviewScores(row);
    appendReviewEvidence(host, 'Original API review', row.review, scores.api, 'Original recorded review preserved unchanged. GPT-5.6 Sol; authored contrast controls do not establish human agreement.');
    appendReviewEvidence(host, 'Supplemental agent review', row.supplemental_review, scores.supplemental, 'A separately attributed Codex subagent judgment, not a human rating or a cross-calibrated API review.');
    const evidence = document.createElement('details'); const title = document.createElement('summary'); title.textContent = 'Inspect checks and measured candidate usage';
    const body = document.createElement('pre'); body.textContent = JSON.stringify({requested_model:model.model,provider:model.provider,settings:model.settings,rates:model.rates,stop:row.stop,checks:row.checks,calls:row.calls},null,2); body.tabIndex = 0; evidence.append(title,body);host.append(evidence);
    $('benchmark-v2-trace').hidden = false; $('benchmark-v2-trace').focus(); $('benchmark-v2-trace').scrollIntoView({block:'start'});
  };
  let source = benchmark.review_completion ? 'combined' : 'api';
  const sourceControl = document.createElement('label'); sourceControl.className = 'bc-filter'; sourceControl.textContent = 'Review source ';
  const sourceSelect = document.createElement('select'); sourceSelect.id = 'benchmark-v2-review-source'; sourceSelect.setAttribute('aria-label', 'Review source');
  for (const [value, label] of [['combined','Combined (mixed reviewers)'],['api','Original API only'],['supplemental','Supplemental agents only']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; sourceSelect.append(option);
  }
  sourceSelect.value = source; sourceControl.append(sourceSelect);
  const sourceStatus = document.createElement('p'); sourceStatus.className = 'caption'; sourceStatus.setAttribute('aria-live','polite');
  const updateSourceStatus = () => { sourceStatus.textContent = `${reviewSourceLabels[source]}: ${total(source)} of ${benchmark.case_count * benchmark.models.length} planned tasks scored. Source filtering changes AI quality only; contracts, candidate costs and latency are unchanged. Pareto comparisons require shared scored cases among selected models.`; };
  const mixDetails = document.createElement('details'), mixTitle = document.createElement('summary'); mixTitle.textContent = 'Inspect reviewer coverage by model'; mixDetails.append(mixTitle);
  const mixNote = document.createElement('p'); mixNote.textContent = 'Counts use all planned cases. Different API and supplemental proportions prevent treating mixed rankings as comparisons with a single fixed reviewer.'; mixDetails.append(mixNote);
  const wrap = document.createElement('div'); wrap.className = 'bc-table-wrap';
  const table = document.createElement('table'); table.className = 'bc-table'; const caption = document.createElement('caption'); caption.textContent = 'Score provenance and coverage'; table.append(caption);
  const head = document.createElement('thead'), headings = document.createElement('tr');
  for (const text of ['Model','Original API','Supplemental','Combined / planned','Supplemental share']) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; headings.append(cell); } head.append(headings); table.append(head);
  const body = document.createElement('tbody');
  for (const model of coverage) { const row = document.createElement('tr'), name = document.createElement('th'); name.scope = 'row'; name.textContent = model.label; row.append(name);
    for (const text of [model.api,model.supplemental,`${model.combined} / ${model.planned}`,model.supplemental_fraction === null ? 'Unknown' : `${(100 * model.supplemental_fraction).toFixed(0)}%`]) { const cell = document.createElement('td'); cell.textContent = String(text); row.append(cell); } body.append(row);
  } table.append(body); wrap.append(table); mixDetails.append(wrap);
  const sourcePanel = document.createElement('div'); sourcePanel.className = 'benchmark-charts';
  sourcePanel.append(sourceControl,sourceStatus,mixDetails); $('benchmark-v2-charts').before(sourcePanel);
  const charts = mountBenchmarkCharts($('benchmark-v2-charts'), benchmarkReviewView(benchmark,source), showTrace);
  sourceSelect.addEventListener('change', () => { source = sourceSelect.value; charts.update(benchmarkReviewView(benchmark,source)); updateSourceStatus(); }); updateSourceStatus();
  if (benchmark.observations?.length) {
    const notes = document.createElement('details'); const title = document.createElement('summary'); title.textContent = 'Three traces worth inspecting'; notes.append(title);
    const caption = document.createElement('p'); caption.className = 'caption'; caption.textContent = 'Selected agent observations, not human ratings or a representative sample.'; notes.append(caption);
    for (const item of benchmark.observations) {
      const section = document.createElement('div'); section.className = 'benchmark-reading-jumps';
      const note = document.createElement('p'); note.textContent = item.observation; section.append(note);
      const models = [...new Set(item.evidence.map(evidence => evidence.model_id))];
      for (const model_id of models) {
        const model = benchmark.models.find(model => model.id === model_id); const button = document.createElement('button');button.type = 'button';button.textContent = `Read ${model?.label || model_id}`;
        button.addEventListener('click', () => showTrace({model_id,case_id:item.case_id})); section.append(button);
      }
      const caveat = document.createElement('p');caveat.className = 'caption';caveat.textContent = item.qualification; section.append(caveat);notes.append(section);
    }
    $('benchmark-v2-charts').after(notes);
  }
}

export function benchmarkStoryCounts(data) {
  const arms = data.benchmark?.results?.arms || [];
  const core = data.benchmark?.results?.case_ids?.length || 0;
  const fullyChecked = arms.filter(arm => core > 0 && arm.summary?.contracts?.checked === core);
  const ceiling = fullyChecked.filter(arm => arm.summary.contracts.passed === core);
  const v2 = data.benchmark_v2;
  const reviewed = v2 ? benchmarkReviewCoverage(v2).reduce((n, model) => n + model.combined, 0) : null;
  return { v1: { cases: core, arms: arms.length, fully_checked: fullyChecked.length, ceiling: ceiling.length }, v2: v2 ? { cases: v2.case_count, models: v2.models.length, reviewed, planned: v2.case_count * v2.models.length } : null };
}
function setupReportStory(data) {
  const counts = benchmarkStoryCounts(data);
  if (counts.v1.cases && $('benchmark-v1-story-result')) {
    $('benchmark-v1-story-result').textContent = `Measured finding. ${counts.v1.ceiling} of ${counts.v1.fully_checked} variants with all ${counts.v1.cases} core contracts checked passed every contract. ${counts.v1.arms} variants were attempted overall. A mechanical ceiling did not mean the teaching was equally good.`;
  }
  if (counts.v2 && $('benchmark-v2-story-result')) {
    const v = counts.v2;
    $('benchmark-v2-story-result').textContent = `Measured finding. ${v.models} model variants were tested on ${v.cases} situations. ${v.reviewed} of ${v.planned} planned episodes have a full numeric AI review in this snapshot. The source selector separates original API and supplemental judgments; coverage is not a pass rate.`;
  }
}
function setupBenchmarkV3(data) {
  if (data.benchmark_v3 && !document.getElementById('benchmark-v3-preview')) {
    const preview = document.createElement('details'); preview.id = 'benchmark-v3-preview'; preview.className = 'chapter-evidence';
    const title = document.createElement('summary'); title.textContent = `Explore v${data.benchmark_v3.manifest.version} · ${data.benchmark_v3.definition.cases.length} episodes · ${data.benchmark_v3.definition.cases.reduce((n, item) => n + item.steps.filter(step => step.kind === 'message').length, 0)} learner turns`;
    const note = document.createElement('p'); note.className = 'caption'; note.textContent = 'Authored learner messages and evaluator-only criteria. These definitions are separate from the live responses above; equivalent correct approaches are accepted.';
    preview.append(title, note);
    for (const item of data.benchmark_v3.definition.cases) {
      const episode = document.createElement('details'), heading = document.createElement('summary');
      heading.textContent = item.title;
      episode.append(heading);
      if (item.learner_profile || item.profile_lifecycle) {
        const profile = document.createElement('p');
        profile.textContent = item.learner_profile ? `Starting learner context: ${item.learner_profile}` : 'Starts with an empty learner profile. Ordinary questions provide the evidence; the tutor decides what to retain, revise and use in a later session.';
        episode.append(profile);
      }
      for (const step of item.steps) {
        const line = document.createElement('p');
        line.textContent = step.kind === 'message' ? `Learner: ${step.text}` : step.kind === 'reopen' ? 'Reopen the same saved session.' : 'Start a new session with the saved learner state.';
        episode.append(line);
      }
      const criteria = document.createElement('details'), label = document.createElement('summary'), body = document.createElement('pre');
      label.textContent = 'Scoring criteria and reference'; body.tabIndex = 0;
      body.textContent = JSON.stringify({rubric: item.rubric, reference: item.reference, state_checks: item.state_checks}, null, 2);
      criteria.append(label, body); episode.append(criteria); preview.append(episode);
    }
    $('benchmark-v3-explorer').append(preview);
  }
}
function revealChapterTarget(hash) {
  if (!hash || hash === '#') return;
  let id;
  try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (!target) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true;
  }
}
function setupChapterNavigation() {
  // Native anchors retain normal history and keyboard behavior. Unfold evidence
  // first so an old deep link still reaches the original response or prompt.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href^="#"]');
    if (anchor) revealChapterTarget(anchor.hash);
  });
  window.addEventListener('hashchange', () => revealChapterTarget(window.location.hash));
  revealChapterTarget(window.location.hash);
}
if (typeof document !== 'undefined') {
  setupStages(); setupSimulation(); setupChapterNavigation();
  fetch('./report-data.json').then(response => { if (!response.ok) throw Error('Report unavailable'); return response.json(); }).then(data => { setupComparisons(data); setupConversations(data); setupCosts(data); setupInteractionRound(data); setupBenchmark(data); setupBenchmarkV2(data); setupReportStory(data); setupBenchmarkV3(data); appendSystemPrompt($('later-prompt-viewer'),data,data.later_system_prompt_sha256,data.benchmark?.results ? 'Later revision used by the fixed benchmark above; the earlier experiments retain their original prompt.' : 'Later revision, not used for any recorded score or chat in this report.'); }).catch(() => { $('load-error').hidden = false; $('sft-response').textContent = 'Recorded comparison unavailable. Refresh to retry.'; $('sdpo-response').textContent = 'Recorded comparison unavailable. Refresh to retry.'; $('message-content').textContent = 'The explorer could not load. You can still download the conversations below.'; $('benchmark-selection').textContent = 'Benchmark data could not load. No benchmark results are available.'; });
}
