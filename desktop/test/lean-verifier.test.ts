import { describe, expect, test } from 'bun:test';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { checkLeanAvailability, verifyLeanProof, resolveLeanExecutable, type LeanRunner, type LeanRunResult } from '../src/lean-verifier';

const VERSION = 'Lean (version 4.22.0, x86_64-unknown-linux-gnu, commit abcdef, Release)';
const NO_AXIOMS = "'keating_claim' does not depend on any axioms";
const claim = { statement: '∀ (n : Nat), n + 0 = n', tactic: 'simp' };
function runner(proof: Partial<LeanRunResult> = {}): LeanRunner {
  return async ({ args }) => args[0] === '--version'
    ? { exitCode: 0, stdout: VERSION, stderr: '' }
    : { exitCode: 0, stdout: NO_AXIOMS, stderr: '', ...proof };
}

describe('bounded native Lean verifier', () => {
  test('finds elan on GUI launches and uses the Windows executable name', () => {
    expect(resolveLeanExecutable('win32', '/user', () => false)).toBe('lean.exe');
    expect(resolveLeanExecutable('win32', '/user', () => true)).toBe(join('/user', '.elan', 'bin', 'lean.exe'));
    expect(resolveLeanExecutable('linux', '/user', () => true)).toBe(join('/user', '.elan', 'bin', 'lean'));
    expect(resolveLeanExecutable('darwin', '/user', () => false)).toBe('lean');
  });
  test('detects supported Lean and clearly reports missing or incompatible installations', async () => {
    expect(await checkLeanAvailability(runner())).toMatchObject({ available: true, leanVersion: VERSION });
    expect(await checkLeanAvailability(async () => ({ exitCode: null, stdout: '', stderr: '', unavailable: true }))).toMatchObject({ available: false });
    expect(await checkLeanAvailability(async () => ({ exitCode: 0, stdout: 'Lean 3', stderr: '' }))).toMatchObject({ available: false });
    expect(await checkLeanAvailability(async () => { throw new Error('missing'); })).toMatchObject({ available: false });
  });
  test('writes only a curated theorem and cleans its isolated directory', async () => {
    let directory = '';
    const result = await verifyLeanProof(claim, async (request) => {
      directory = request.cwd;
      if (request.args[0] === '--version') return { exitCode: 0, stdout: VERSION, stderr: '' };
      expect(request.timeoutMs).toBe(10000);
      expect(request.maxOutputBytes).toBe(32768);
      expect(request.args).toHaveLength(1);
      expect(await readFile(request.args[0], 'utf8')).toBe('import Std\nset_option autoImplicit false\nset_option maxRecDepth 512\nset_option maxHeartbeats 200000\ntheorem keating_claim : (∀ (n : Nat), n + 0 = n) := by\n  simp\n#print axioms keating_claim\n');
      return { exitCode: 0, stdout: NO_AXIOMS, stderr: '' };
    });
    expect(result).toMatchObject({ status: 'verified', statement: claim.statement, tactic: 'simp', leanVersion: VERSION, axioms: [] });
    await expect(access(directory)).rejects.toThrow();
  });
  test('allows the audited standard foundational axioms', async () => {
    const result = await verifyLeanProof(claim, runner({ stdout: "'keating_claim' depends on axioms: [propext, Classical.choice, Quot.sound]" }));
    expect(result).toMatchObject({ status: 'verified', axioms: ['propext', 'Classical.choice', 'Quot.sound'] });
  });
  test('exit zero cannot certify sorry, custom axioms, or compiler trust', async () => {
    for (const axiom of ['sorryAx', 'Custom.truth', 'Lean.trustCompiler', 'Lean.ofReduceBool']) {
      const result = await verifyLeanProof(claim, runner({ stdout: `'keating_claim' depends on axioms: [${axiom}]` }));
      expect(result).toMatchObject({ status: 'rejected', axioms: [axiom] });
    }
    for (const stdout of ['', "'other_theorem' does not depend on any axioms", `${NO_AXIOMS}\n${NO_AXIOMS}`, `warning: declaration uses sorry\n${NO_AXIOMS}`]) {
      expect((await verifyLeanProof(claim, runner({ stdout }))).status).toBe('rejected');
    }
    expect((await verifyLeanProof(claim, runner({ stderr: 'unexpected diagnostic' }))).status).toBe('rejected');
  });
  test('rejects arbitrary source, tactics, comments, identifiers, and excessive inputs before spawning', async () => {
    let calls = 0;
    const neverRun: LeanRunner = async () => { calls++; throw new Error('must not execute'); };
    const statements = ['True\n#eval 1', 'True -- hidden', 'True /- comment -/', 'True := True', 'True; True', 'IO.println "bad"', '`True', 'sorryAx', 'Classical.choice', 'True\u202e', '1'.repeat(33) + ' = 1', '('.repeat(33) + 'True' + ')'.repeat(33), 'True '.repeat(300), '(True', 'True)'];
    for (const statement of statements) expect((await verifyLeanProof({ statement, tactic: 'decide' }, neverRun)).status).toBe('unsupported');
    for (const tactic of ['sorry', 'native_decide', 'simp\n#eval 1', 'exact True.intro']) {
      expect((await verifyLeanProof({ statement: 'True', tactic }, neverRun)).status).toBe('unsupported');
    }
    expect((await verifyLeanProof(null, neverRun)).status).toBe('unsupported');
    expect(calls).toBe(0);
  });
  test('reports failed proof attempts without claiming the proposition is false', async () => {
    const result = await verifyLeanProof({ statement: '1 = 2', tactic: 'decide' }, runner({ exitCode: 1, stdout: 'unsolved goals' }));
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('does not establish that the statement is false');
  });
  test('distinguishes unavailable executables and resource exhaustion from rejection', async () => {
    expect((await verifyLeanProof(claim, runner({ unavailable: true, exitCode: null }))).status).toBe('unavailable');
    for (const proof of [{ timedOut: true }, { outputExceeded: true }, { stdout: 'x'.repeat(32769) }]) {
      expect((await verifyLeanProof(claim, runner(proof))).status).toBe('unsupported');
    }
  });
  test('supports each curated tactic and bounded Nat/Int syntax', async () => {
    for (const tactic of ['omega', 'decide', 'simp', 'rfl']) {
      expect((await verifyLeanProof({ statement: '∀ (x y : Int), x ≤ y → ¬ (x > y)', tactic }, runner())).status).toBe('verified');
    }
    expect(JSON.stringify(await verifyLeanProof(claim, runner()))).toContain('verified');
  });
});
