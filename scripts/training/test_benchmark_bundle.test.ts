import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileMessage } from '../report-site/openui-preview';
import { benchmarkCaseResponses, selectBenchmarkCases } from '../../web/public/reports/learning-to-teach/report.js';

const root = new URL('../../', import.meta.url);
const directory = new URL('./benchmarks/teaching-v1/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const sha = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex');
const canonical = (value: any): string => JSON.stringify(sortKeys(value));
function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  return value;
}
const cases = read('cases.json');
const rubric = read('rubric.json');
const context = read('context.json');
const manifest = read('manifest.json');

test('released benchmark inputs and checker match the frozen manifest', () => {
  for (const [name, digest] of Object.entries(manifest.files)) {
    expect(sha(readFileSync(new URL(name, directory)))).toBe(digest);
  }
  expect(sha(readFileSync(new URL(manifest.contract_checker.path, root)))).toBe(manifest.contract_checker.sha256);
  expect(sha(readFileSync(new URL(manifest.contract_inventory.path, root)))).toBe(manifest.contract_inventory.sha256);
  for (const [name, digest] of Object.entries(manifest.contract_sources)) {
    expect(sha(readFileSync(new URL(name, root)))).toBe(digest);
  }
  expect(manifest.contract_runtime.version).toBe(Bun.version);
  expect(manifest.contract_runtime.revision).toBe(Bun.revision);
  expect(sha(context.system_prompt)).toBe(context.system_prompt_sha256);
  expect(context.provenance.private_context).toBe(false);
  expect(context.provenance.application_state.learnerContext).toBe('');
  expect(context.provenance.application_state.sessionStartContext).toBe('');
  expect(context.tools).toHaveLength(14);
});

test('the fixed suite covers distinct cases with applicable behavioral anchors and real OpenUI histories', () => {
  expect(cases.cases).toHaveLength(32);
  expect(cases.core_case_ids).toHaveLength(8);
  expect(new Set(cases.cases.map((c: any) => c.id)).size).toBe(cases.cases.length);
  let historicalSurfaces = 0;
  for (const c of cases.cases) {
    expect(cases.core_case_ids.includes(c.id)).toBe(c.tier === 'core');
    expect(c.messages.at(-1).role).toBe('user');
    for (const [name, anchors] of Object.entries(c.rubric) as [string, any][]) {
      expect(rubric.dimensions[name]).toBeDefined();
      for (const anchor of ['zero', 'one', 'two']) expect(anchors[anchor].length).toBeGreaterThan(10);
    }
    for (const [i, message] of c.messages.entries()) {
      if (message.role === 'assistant' && message.content.includes('```openui')) {
        const documents = compileMessage(message.content, `benchmark-history-${c.id}-${i}`);
        expect(documents.length).toBeGreaterThan(0);
        historicalSurfaces += documents.length;
      }
    }
  }
  expect(historicalSurfaces).toBe(6);
  expect(cases.generation_policy.send_rubric_to_model).toBe(false);
  expect(cases.generation_policy.send_expect_to_model).toBe(false);
  expect(cases.generation_policy.teacher_hints).toBe(false);
});

test('public benchmark preserves its frozen definition after collecting model responses', () => {
  const report = JSON.parse(readFileSync(new URL('web/public/reports/learning-to-teach/report-data.json', root), 'utf8'));
  const benchmark = report.benchmark;
  expect(benchmark.status).toBe('responses_collected');
  expect(benchmark.human_scores).toBeNull();
  expect(benchmark.cases).toEqual(cases.cases);
  expect(benchmark.rubric).toEqual(rubric);
  expect(benchmark.manifest).toEqual(manifest);
  expect(benchmark.system_prompt_sha256).toBe(context.system_prompt_sha256);
  expect(report.system_prompts[benchmark.system_prompt_sha256].text).toBe(context.system_prompt);
  for (const [name, body] of Object.entries({ 'cases.json': benchmark.case_definition, 'rubric.json': benchmark.rubric, 'context.json': benchmark.context })) {
    // Browser downloads must reconstruct the source bytes covered by the release manifest.
    expect(sha(JSON.stringify(body, null, 2) + '\n')).toBe(manifest.files[name]);
  }
});

test('reported comparisons retain every core response, honest denominators and unknown human ratings', () => {
  const report = JSON.parse(readFileSync(new URL('web/public/reports/learning-to-teach/report-data.json', root), 'utf8'));
  const benchmark = report.benchmark, results = benchmark.results;
  expect(results.human_scores).toBeNull();
  expect(results.teaching_status).toBe('unreviewed');
  expect(results.case_ids).toEqual(cases.core_case_ids);
  expect(results.system_prompt_sha256).toBe(context.system_prompt_sha256);
  expect(results.tool_schema_sha256).toBe(context.tool_schema_sha256);
  expect(results.arms.slice(0, 4).map((arm: any) => arm.requested_model)).toEqual(['base', 'identity-sft-run-v2', 'openui-sft-run', 'openui-sdpo-run']);
  expect(new Set(results.arms.map((arm: any) => arm.requested_model)).size).toBe(results.arms.length);
  for (const arm of results.arms) {
    expect(arm.responses.map((response: any) => response.case_id)).toEqual(results.case_ids);
    expect(arm.summary.cases).toBe(arm.responses.length);
    expect(arm.summary.contracts.passed).toBe(arm.responses.filter((row: any) => row.contracts.contract_passed === true).length);
    expect(arm.summary.contracts.checked).toBe(arm.responses.filter((row: any) => typeof row.contracts.contract_passed === 'boolean').length);
    expect(arm.summary.truncated).toBe(arm.responses.filter((row: any) => row.delivery.truncated).length);
    for (const status of ['pass', 'fail', 'error', 'missing']) {
      expect(arm.summary.delivery[status]).toBe(arm.responses.filter((row: any) => row.delivery.status === status).length);
    }
    for (const row of arm.responses) {
      expect(sha(canonical(row.response))).toBe(row.public_response_sha256);
      expect(row.human_scores).toBeNull();
      if (typeof row.contracts.contract_passed === 'boolean') {
        expect(row.contracts.contract_passed).toBe(row.contracts.checks.every((check: any) => check.status !== 'fail'));
      }
    }
    expect(arm.origin).toBeUndefined();
    expect(arm.provider_receipt).toBeUndefined();
  }
  for (const c of selectBenchmarkCases(benchmark, 'all').filter((c: any) => !results.case_ids.includes(c.id))) {
    expect(benchmarkCaseResponses(benchmark, c.id).every((row: any) => row.result === null)).toBe(true);
  }
});
