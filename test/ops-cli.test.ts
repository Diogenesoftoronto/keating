import { describe, expect, test } from 'bun:test';
import { parseArgs, taskArgs, duration } from '../scripts/ops/args.js';
import { nextVersion } from '../scripts/ops/release.js';
import { shellQuote } from '../scripts/ops/mutate.js';

describe('ops arguments', () => {
  test('every command has help without required operands', () => {
    for (const command of ['worktree', 'verify', 'release', 'status', 'deploy-staging', 'promote', 'mutate']) expect(parseArgs([command, '--help']).flags.help).toBe(true);
  });
  test('parses a mutation target, explicit tests and threshold', () => {
    expect(parseArgs(['mutate', 'a.ts', 'b.ts', '--tests', 'one.test.ts', 'two.test.ts', '--threshold', '70'])).toEqual({ command: 'mutate', positional: ['a.ts', 'b.ts'], flags: { tests: ['one.test.ts', 'two.test.ts'], threshold: '70' } });
  });
  test('rejects unknown flags, missing values, invalid bounds and missing release version', () => {
    for (const argv of [['release'], ['worktree'], ['promote', '--push'], ['status', '--wait'], ['mutate', '--threshold', '101'], ['status', '--timeout', 'forever'], ['worktree', 'a', '--base']]) expect(() => parseArgs(argv)).toThrow();
    expect(() => parseArgs(['release', '--push', 'patch'])).toThrow();
  });
  test('reads structured task values as literal argv and validates their shapes', () => {
    const malicious = 'Title $(touch /tmp/should-not-run) `echo nope`';
    expect(taskArgs('release', JSON.stringify({ version: 'patch', title: malicious, yes: true }))).toEqual(['patch', '--title', malicious, '--yes']);
    expect(parseArgs(['mutate', '--task-input'], JSON.stringify({ tests: ['a.test.ts'], target: 'a.ts', threshold: 60 })).positional).toEqual(['a.ts']);
    expect(() => taskArgs('release', '{')).toThrow();
    expect(() => taskArgs('release', '[]')).toThrow();
    expect(() => taskArgs('mutate', '{"args":"--yes"}')).toThrow();
    expect(() => taskArgs('mutate', '{"tests":"test.ts"}')).toThrow();
    expect(() => taskArgs('promote', '{"yes":1}')).toThrow();
    expect(() => taskArgs('promote', '{"mystery":true}')).toThrow();
  });
  test('duration and version decisions are bounded', () => {
    expect(duration('30m')).toBe(1_800_000);
    expect(() => duration('0s')).toThrow();
    expect(nextVersion('4.0.16', 'minor')).toBe('4.1.0');
    expect(nextVersion('4.0.16', '4.1.2')).toBe('4.1.2');
    expect(() => nextVersion('4.0.16', '4.0.15')).toThrow();
  });
  test('quotes test file paths for Stryker command runner without shell expansion', async () => {
    const value = "a'$(echo dangerous)`echo nope` space.ts";
    const child = Bun.spawn(['sh', '-c', `printf '%s' ${shellQuote(value)}`], { stdout: 'pipe' });
    expect(await new Response(child.stdout).text()).toBe(value);
    expect(await child.exited).toBe(0);
  });
});
