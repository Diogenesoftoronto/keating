import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { runHarnessEpisode, validateHarnessRequest, HARNESS_EXPERIMENT_INSTRUCTION_VERSION } from './benchmark_harness_v3.js';
import { validateExperimentInstruction, type HarnessExperimentInstruction } from './native_experiment.js';
import { nativeSurfaceInstruction } from './native_surface.js';

function condition(): HarnessExperimentInstruction {
  const instruction = 'Ask one diagnostic question about the learner\'s current reasoning. Wait for their answer.';
  return { kind: 'native-action-search/v1', comparison_sha256: 'a'.repeat(64), candidate_id: 'diagnose', instruction,
    instruction_sha256: createHash('sha256').update(instruction).digest('hex') };
}

test('experimental descriptors reject drift, unknown fields, invalid types and unbounded text', () => {
  const original = condition();
  expect(HARNESS_EXPERIMENT_INSTRUCTION_VERSION).toBe(1);
  const pinned = validateExperimentInstruction(original);
  original.instruction = 'changed after validation';
  expect(pinned.instruction).not.toBe(original.instruction);
  for (const bad of [null, [], { ...condition(), extra: true }, { ...condition(), instruction: 'changed' },
    { ...condition(), candidate_id: 'execute_shell' }, { ...condition(), comparison_sha256: 'not a hash' },
    { ...condition(), comparison_sha256: ['a'.repeat(64)] },
    { ...condition(), instruction: 12 }, { ...condition(), instruction: 'é'.repeat(8192) }]) {
    expect(() => validateExperimentInstruction(bad)).toThrow('harness_invalid_experiment_instruction');
  }
  expect(() => validateHarnessRequest({ id: 'missing-surface', transport: { kind: 'tape', responses: [] },
    steps: [{ kind: 'message', text: 'Observed learner work' }], experiment_instruction: condition() }))
    .toThrow('harness_experiment_requires_surface');
});

test('actual Pi receives the research condition without changing learner text, across reopen', async () => {
  const experiment = condition(), opening = 'I added the denominators when adding two fractions.';
  const result = await runHarnessEpisode({ id: 'native-experiment-pi', surface: 'chat', experiment_instruction: experiment,
    allowed_tools: [], transport: { kind: 'tape', responses: [{ text: 'What does the denominator count?' },
      { text: 'How could we make the piece sizes equal?' }] },
    steps: [{ kind: 'message', text: opening }, { kind: 'reopen' }, { kind: 'message', text: 'It counts equal pieces.' }],
    limits: { max_provider_calls: 2, max_tool_calls: 1, max_output_tokens: 128, turn_timeout_ms: 30000 } });
  expect(result.status).toBe('completed');
  expect(result.configuration.experiment_instruction).toEqual(experiment);
  expect(result.source_provenance.unchanged_at_end).toBe(true);
  const prompts = (result.requests as any[]).filter(r => r.kind === 'provider_request');
  expect(prompts).toHaveLength(2);
  for (const r of prompts) {
    expect(r.data.context.systemPrompt).toContain(experiment.instruction);
    expect(r.data.context.systemPrompt.endsWith(nativeSurfaceInstruction('chat'))).toBe(true);
    expect(JSON.stringify(r.data.context.messages)).not.toContain(experiment.instruction);
  }
  expect(JSON.stringify(prompts[0].data.context.messages)).toContain(opening);
  const receipts = (result.receipts as any[]).filter(r => r.kind === 'system_prompt');
  expect(receipts.length).toBeGreaterThanOrEqual(2);
  for (const receipt of receipts) expect(receipt.data.experiment_instruction).toEqual(experiment);
}, 60000);
