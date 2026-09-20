/** Execute source scenarios with authored, observation-responsive plumbing policies. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OPENUI_JSON_PARITY_FIXTURE, type UiDocument } from '../../src/tui/learner-contracts.js';
import { runNativeEpisode, type NativeScenario } from './native_episode.js';
import { nativeHash, type AdaptiveLearner } from './native_learner.js';
import { nativeOutputPath } from './native_paths.js';

export async function runPlumbingBatch(scenarios: NativeScenario[], outputDirectory: string, count = 20) {
  if (!Number.isInteger(count) || count < 1 || count > 20 || scenarios.length < count
    || new Set(scenarios.slice(0, count).map(scenario => scenario.id)).size !== count) throw new Error('Need one distinct admitted scenario per plumbing trace');
  const output = await nativeOutputPath(outputDirectory);
  await mkdir(output, { recursive: false });
  const rows = [];
  for (const [index, scenario] of scenarios.slice(0, count).entries()) {
    const document: UiDocument = { ...structuredClone(OPENUI_JSON_PARITY_FIXTURE),
      id: `plumbing-${index}`, revision: 0, lifecycle: 'ready', title: 'Reasoning notes',
      nodes: [{ type: 'notes', id: 'reasoning', title: 'My next question', value: '', placeholder: 'What is unclear?' }] };
    const learner: AdaptiveLearner = { provenance: { kind: 'authored_policy', model: 'native-plumbing-policy', revision: 'v1' },
      async next(observation, context) {
        if (!context.history.length && observation.visibleText.includes('unclear')) return { kind: 'message', text: 'I am unsure how to justify my next step. Please let me try before giving a solution.' };
        const notes = observation.availableActions.find(a => a.type === 'update-notes');
        if (context.history.length === 1 && notes) return { kind: 'ui_action', actionId: notes.actionId,
          payload: { value: 'I need to explain why the next step follows.' } };
        return { kind: 'stop' };
      } };
    const result = await runNativeEpisode(scenario, { kind: 'tape', responses: [
      { text: 'Which part of your reasoning is unclear? Tell me what you want to try next.' },
      { text: `Record your next question.\n\`\`\`keating-ui\n${JSON.stringify(document)}\n\`\`\`` },
    ] }, learner, { branch_id: `plumbing-${index}`, limits: { turn_timeout_ms: 20_000 } });
    const path = `${String(index).padStart(2, '0')}-${scenario.id}.json`;
    await writeFile(resolve(output, path), JSON.stringify(result, null, 2), { mode: 0o600 });
    const row = { id: scenario.id, family: scenario.family, source: scenario.source, file: path,
      scenario_hash: nativeHash(scenario), outcome: result.outcome, events: result.ledger.length,
      runtime_status: result.runtime.status, provider_calls: result.runtime.requests.length,
      actual_action_receipts: result.ledger.filter(e => e.kind === 'action_receipt').length };
    rows.push(row);
    process.stdout.write(JSON.stringify(row) + '\n');
    // Persist the complete attempt denominator even if later traces fail or are interrupted.
    await writeFile(resolve(output, 'summary.json'), JSON.stringify({ schema_version: 1,
      measurement: 'offline_integration', planned: count, attempted: rows.length, episodes: rows,
      limitations: ['Authored tutor tape and learner policy; no model tutoring or simulator fidelity measured.',
        'Different source records may share a family. This count is not a count of independent learners.',
        'Receipts establish execution, not correct reasoning or learning.'] }, null, 2));
  }
  return rows;
}

if (import.meta.main) {
  const [inputPath, outputPath, count] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Usage: bun native_plumbing.ts ADMITTED_SCENARIOS_JSON NEW_OUTPUT_DIR [COUNT]');
  const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  await runPlumbingBatch(Array.isArray(input) ? input : input.scenarios, outputPath, count ? Number(count) : 20);
}
