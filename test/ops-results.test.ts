import { expect, test } from 'bun:test';
import { parseTestOutput, matchFailures, classifyStatus, type WorkflowRun } from '../scripts/ops/results.js';
import { candidateSummary, softwareVersion } from '../scripts/ops/status.js';
import known from '../scripts/ops/known-failures.json' with { type: 'json' };

test('Bun summaries retain exact full failure names and strip timings/ANSI', () => {
  const result = parseTestOutput('\u001b[31m(fail) a group > preserves values [12.30ms]\u001b[0m\n 12 pass\n 1 fail\n');
  expect(result).toEqual({ passes: 12, failed: 1, errors: 0, failures: ['a group > preserves values'], hasSummary: true });
  expect(parseTestOutput('error: failed to load module').hasSummary).toBe(false);
  expect(parseTestOutput(' 1 pass\n 1 fail\n 1 error').errors).toBe(1);
});
test('Node TAP summaries report leaf failures, not aggregate failed suites', () => {
  const result = parseTestOutput(`TAP version 13
# Subtest: standalone
    not ok 1 - real failure
      ---
      failureType: 'testCodeFailure'
      ...
not ok 1 - standalone
  ---
  failureType: 'subtestsFailed'
  ...
# tests 1
# pass 0
# fail 1
`);
  expect(result.failures).toEqual(['real failure']);
  expect(result.failed).toBe(1);
});
test('known failures require both suite and exact test name', () => {
  const entry = known[0]!;
  expect(matchFailures(entry.suite, [entry.name], known)[0]!.known).toBeDefined();
  expect(matchFailures('root', [entry.name], known)[0]!.known).toBeUndefined();
  expect(matchFailures(entry.suite, [entry.name + ' changed'], known)[0]!.known).toBeUndefined();
  expect(known).toHaveLength(5);
});
test('release classification requires completed success and the expected staging commit', () => {
  const run: WorkflowRun = { headSha: 'abc', status: 'completed', conclusion: 'success' };
  expect(classifyStatus(run, 'abc', 'abc')).toBe(0);
  expect(classifyStatus(run, 'other', 'abc')).toBe(3);
  expect(classifyStatus(undefined, 'abc', 'abc')).toBe(3);
  expect(classifyStatus({ ...run, status: 'in_progress' }, 'abc', 'abc')).toBe(3);
  expect(classifyStatus({ ...run, conclusion: 'failure' }, 'abc', 'abc')).toBe(1);
  expect(classifyStatus(run, 'abc', undefined)).toBe(3);
  expect(classifyStatus(run, 'abc', 'other')).toBe(3);
});
test('live HTML identity and candidate age keep unknown observations visible', () => {
  expect(softwareVersion('<script>{"softwareVersion": "4.0.16"}</script>')).toBe('4.0.16');
  expect(softwareVersion('unavailable')).toBeUndefined();
  expect(candidateSummary(undefined)).toBe('none');
  expect(candidateSummary({ sha: 'abc', dirty: false, promotionEligible: true, verifiedAt: new Date(0).toISOString() }, 9 * 3_600_000)).toContain('locally eligible');
  expect(candidateSummary({ sha: 'abc', dirty: true, promotionEligible: true }, 1)).toContain('not locally eligible');
});
