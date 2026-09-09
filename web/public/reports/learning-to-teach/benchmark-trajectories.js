import { loadV3Data } from './benchmark-v3-results.js';
import { modelProvider } from './benchmark-charts.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
export function memoryFacts(step) {
  const snapshots = step?.learner_memory ?? [];
  if (!Array.isArray(snapshots) || snapshots.some(snapshot => !Array.isArray(snapshot?.facts))) return null;
  return snapshots.flatMap(snapshot => snapshot.facts);
}
export function memoryChanges(previous, current) {
  if (previous === null || current === null) return null;
  const before = new Map(previous.map(fact => [fact.id, fact]));
  const after = new Map(current.map(fact => [fact.id, fact]));
  return [
    ...current.map(fact => ({ fact, state: !before.has(fact.id) ? 'Added' : JSON.stringify(before.get(fact.id)) !== JSON.stringify(fact) ? 'Updated' : 'Retained' })),
    ...previous.filter(fact => !after.has(fact.id)).map(fact => ({ fact, state: current.some(next => next.supersedesId === fact.id) ? 'Replaced' : 'Removed' })),
  ];
}
export function messageText(step, role) {
  return (step?.messages ?? []).filter(message => message.role === role)
    .flatMap(message => message.content ?? []).filter(content => content.type === 'text')
    .map(content => content.text).join('\n\n');
}
function disclosure(label, value) {
  const box = el('details'); box.append(el('summary', label), el('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); return box;
}
function toolsAt(step) {
  return (step.messages ?? []).flatMap(message => message.content ?? []).filter(content => content.type === 'toolCall');
}
function factsView(previous, current) {
  const panel = el('div', '', 'trajectory-memory');
  panel.append(el('h4', 'What the profile remembers'));
  const changes = memoryChanges(previous, current);
  if (changes === null) { panel.append(el('p', 'This memory snapshot could not be interpreted. Inspect the complete trace.')); return panel; }
  panel.append(el('p', `${current.length} saved observation${current.length === 1 ? '' : 's'} after this step`, 'trajectory-meta'));
  if (!changes.length) panel.append(el('p', 'Nothing saved yet. A preference mentioned in chat only becomes durable when a memory write succeeds.', 'trajectory-empty'));
  for (const { fact, state } of changes) {
    const record = el('article', '', `trajectory-fact trajectory-fact-${state.toLowerCase()}`);
    const meta = el('div', '', 'trajectory-fact-meta');
    meta.append(el('span', state), el('code', fact.category || 'Uncategorized'));
    record.append(meta, el('p', fact.value));
    const source = fact.source === 'explicit' ? 'Recorded as learner-stated' : fact.source === 'observed' ? 'Recorded as a model inference' : `Source: ${fact.source ?? 'unknown'}`;
    record.append(el('p', source, 'trajectory-meta'));
    if (fact.evidence) record.append(el('blockquote', fact.evidence));
    if (typeof fact.confidence === 'number') record.append(el('p', `Stored confidence: ${fact.confidence} · model-recorded, uncalibrated`, 'trajectory-meta'));
    record.append(disclosure('Inspect this JSON record', fact)); panel.append(record);
  }
  return panel;
}

export async function mountTrajectory(host, { caseId, preferredModel, memory }) {
  host.classList.add('trajectory'); host.append(el('p', 'Loading the recorded conversation…'));
  let data;
  try { data = await loadV3Data(); } catch { host.replaceChildren(el('p', 'Conversation unavailable. Reload the page to retry.')); return; }
  const item = data.cases.find(candidate => candidate.id === caseId);
  const models = data.models.filter(model => model.rows.some(row => row.case_id === caseId && row.trace?.steps?.length));
  if (!item || !models.length) { host.replaceChildren(el('p', 'No recorded conversation is available for this case.')); return; }
  host.replaceChildren();
  const header = el('div', '', 'trajectory-header'), select = el('select'), label = el('label', 'Follow a model ');
  for (const model of models) { const option = el('option', model.label); option.value = model.id; select.append(option); }
  select.value = models.some(model => model.id === preferredModel) ? preferredModel : models[0].id;
  label.append(select); header.append(el('h3', memory ? 'A preference changes. Does the memory?' : 'The learner changes the problem.'), label);
  const rail = el('div', '', 'trajectory-rail'); rail.setAttribute('role', 'group'); rail.setAttribute('aria-label', 'Conversation steps');
  const stage = el('div', '', 'trajectory-stage'), controls = el('div', '', 'trajectory-controls');
  const back = el('button', '← Previous step'), next = el('button', 'Next step →'), status = el('span', '', 'trajectory-meta');
  back.type = next.type = 'button'; status.setAttribute('role', 'status');
  controls.append(back, status, next);
  const complete = el('button', 'Read the complete conversation ↗', 'text-link'); complete.type = 'button';
  complete.addEventListener('click', () => document.getElementById('benchmark-v3-results')?.dispatchEvent(new CustomEvent('keating:open-v3-trace', { detail: { model_id: select.value, case_id: caseId } })));
  host.append(header, el('p', memory ? 'Start with an empty profile. Follow the evidence, a correction, and what survives into a fresh session.' : 'Follow the learner’s feedback as the constraints change. Each step shows what the tutor actually said and did.', 'caption'), rail, controls, stage, complete);
  let index = 0;
  function draw(animate = false) {
    const model = models.find(candidate => candidate.id === select.value);
    const row = model.rows.find(candidate => candidate.case_id === caseId), steps = row.trace.steps;
    index = Math.min(index, steps.length - 1);
    host.style.setProperty('--trajectory-provider', modelProvider(model).color);
    rail.replaceChildren();
    steps.forEach((step, position) => {
      const button = el('button', '', 'trajectory-stop'); button.type = 'button';
      const event = step.kind === 'new_session' ? 'New session' : step.kind === 'reopen' ? 'Reopen' : `Turn ${position + 1}`;
      const text = messageText(step, 'user');
      button.append(el('strong', event), el('span', text ? `${text.slice(0, 78)}${text.length > 78 ? '…' : ''}` : 'Continue with saved context'));
      if (memory) { const facts = memoryFacts(step); button.append(el('small', facts === null ? 'Memory unknown' : `${facts.length} saved`)); }
      else button.append(el('small', `${toolsAt(step).length} tool calls`));
      button.setAttribute('aria-pressed', String(index === position));
      button.addEventListener('click', () => { index = position; draw(true); rail.children[index].focus({ preventScroll: true }); });
      button.addEventListener('keydown', event => {
        const target = event.key === 'ArrowRight' ? position + 1 : event.key === 'ArrowLeft' ? position - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : null;
        if (target === null) return;
        event.preventDefault(); index = Math.max(0, Math.min(steps.length - 1, target)); draw(true); rail.children[index].focus({ preventScroll: true });
      }); rail.append(button);
    });
    const step = steps[index], conversation = el('div', '', 'trajectory-conversation');
    const learner = messageText(step, 'user'), assistant = messageText(step, 'assistant');
    if (learner) conversation.append(el('h4', 'The learner says'), el('blockquote', learner, 'trajectory-learner'));
    else conversation.append(el('h4', step.kind === 'new_session' ? 'A fresh session begins' : 'The conversation reopens'), el('p', 'The harness restores the recorded learner context before continuing.'));
    if (assistant) {
      // Keep source inspectable without displaying a wall of generated UI markup.
      const prose = assistant.replace(/```(?:keating-ui|openui)[\s\S]*?```/g, '[Generated interface: inspect full reply]').trim();
      conversation.append(el('h4', 'The tutor responds'), el('p', prose.slice(0, 700) + (prose.length > 700 ? '…' : ''), 'trajectory-reply'));
      conversation.append(disclosure('Read the full recorded reply / source', assistant));
    }
    const tools = toolsAt(step), failures = (step.messages ?? []).filter(message => message.role === 'toolResult' && message.is_error);
    if (tools.length) conversation.append(el('p', `Tools: ${[...new Set(tools.map(tool => tool.name))].join(' · ')}${failures.length ? ` · ${failures.length} rejected result${failures.length === 1 ? '' : 's'}` : ''}`, 'trajectory-meta'));
    if (step.status !== 'completed') conversation.append(el('p', `Step status: ${step.status}${step.error_code ? ` · ${step.error_code}` : ''}`, 'trajectory-meta'));
    stage.replaceChildren(conversation);
    if (memory) stage.append(factsView(index ? memoryFacts(steps[index - 1]) : [], memoryFacts(step)));
    else {
      const activity = el('div', '', 'trajectory-memory'); activity.append(el('h4', 'Inside the harness'), el('p', 'Inspect the actions behind this response. A tool call alone does not establish that its result was useful.', 'caption'));
      for (const tool of tools) activity.append(disclosure(tool.name, tool.arguments));
      if (!tools.length) activity.append(el('p', 'No tools were called in this step.', 'caption'));
      stage.append(activity);
    }
    back.disabled = index === 0; next.disabled = index === steps.length - 1; status.textContent = `Step ${index + 1} of ${steps.length}`;
    if (animate) {
      const selected = rail.children[index];
      rail.scrollTo({ left: Math.max(0, selected.offsetLeft - rail.offsetLeft - 12), behavior: 'instant' });
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && stage.animate) {
        stage.getAnimations().forEach(animation => animation.cancel());
        stage.animate([{ opacity: .45, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 200, easing: 'ease-out' });
      }
    }
  }
  back.addEventListener('click', () => { index--; draw(true); }); next.addEventListener('click', () => { index++; draw(true); });
  select.addEventListener('change', () => draw(true)); draw();
}

if (typeof document !== 'undefined') {
  const v31 = document.getElementById('trajectory-v31'), v32 = document.getElementById('trajectory-v32');
  if (v31) void mountTrajectory(v31, { caseId: 'cache-changing-priorities', preferredModel: 'deepseek-v4-flash', memory: false });
  if (v32) void mountTrajectory(v32, { caseId: 'profile-life-notation-revision', preferredModel: 'kimi-k3', memory: true });
}
