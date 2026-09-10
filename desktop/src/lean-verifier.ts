import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export type LeanTactic = 'omega' | 'decide' | 'simp' | 'rfl';
export type LeanRunRequest = { args: string[]; cwd: string; timeoutMs: number; maxOutputBytes: number };
export type LeanRunResult = {
  exitCode: number | null; stdout: string; stderr: string;
  timedOut?: boolean; outputExceeded?: boolean; unavailable?: boolean;
};
/** Injection is for trusted native callers/tests only; never deserialize a runner from IPC. */
export type LeanRunner = (request: LeanRunRequest) => Promise<LeanRunResult>;
export type LeanVerification = {
  status: 'verified' | 'rejected' | 'unavailable' | 'unsupported';
  statement: string; tactic: string; leanVersion?: string; reason: string; axioms: string[];
};

const TACTICS = new Set(['omega', 'decide', 'simp', 'rfl']);
const IDENTIFIERS = new Set(['Nat', 'Int', 'True', 'False', 'x', 'y', 'z', 'n', 'm', 'k', 'a', 'b', 'c']);
const AXIOMS = new Set(['propext', 'Classical.choice', 'Quot.sound']);
const OUTPUT_LIMIT = 32 * 1024;
let activeChecks = 0;

/** Desktop GUI launches may not inherit the shell PATH configured by elan. */
export function resolveLeanExecutable(platform: NodeJS.Platform = process.platform, home = homedir(), exists: (path: string) => boolean = existsSync): string {
  const executable = platform === 'win32' ? 'lean.exe' : 'lean';
  const elanExecutable = join(home, '.elan', 'bin', executable);
  return exists(elanExecutable) ? elanExecutable : executable;
}

const nativeRunner: LeanRunner = ({ args, cwd, timeoutMs, maxOutputBytes }) => new Promise((resolve) => {
  // Do not load a workspace's user-controlled libraries via Lean environment overrides.
  const env = { ...process.env };
  delete env.LEAN_PATH;
  delete env.LEAN_SRC_PATH;
  let child: ReturnType<typeof spawn>;
  try { child = spawn(resolveLeanExecutable(), args, { cwd, env, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { resolve({ exitCode: null, stdout: '', stderr: '', unavailable: true }); return; }
  let stdout = '', stderr = '', bytes = 0, timedOut = false, outputExceeded = false, done = false;
  const finish = (exitCode: number | null, unavailable = false) => {
    if (done) return;
    done = true; clearTimeout(timer);
    resolve({ exitCode, stdout, stderr, timedOut, outputExceeded, unavailable });
  };
  const terminate = () => {
    if (process.platform === 'win32' && child.pid) {
      // Elan may launch Lean as a child: terminate the entire process tree.
      const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      execFile(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 2000 }, () => {
        child.kill('SIGKILL'); finish(null);
      });
    } else {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      finish(null);
    }
  };
  const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  function capture(chunk: Buffer, stream: 'stdout' | 'stderr') {
    const remaining = Math.max(0, maxOutputBytes - bytes);
    bytes += chunk.length;
    const text = chunk.subarray(0, remaining).toString('utf8');
    if (stream === 'stdout') stdout += text; else stderr += text;
    if (bytes > maxOutputBytes && !outputExceeded) { outputExceeded = true; terminate(); }
  }
  child.stdout?.on('data', (chunk: Buffer) => capture(chunk, 'stdout'));
  child.stderr?.on('data', (chunk: Buffer) => capture(chunk, 'stderr'));
  child.once('error', () => finish(null, true));
  child.once('close', (code) => finish(code));
});

function validateInput(input: unknown): { statement: string; tactic: LeanTactic } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (typeof p.statement !== 'string' || typeof p.tactic !== 'string' || !TACTICS.has(p.tactic)) return null;
  const statement = p.statement.trim();
  if (!statement || statement.length > 1024) return null;
  // Tokenize the entire proposition using a closed vocabulary. In particular, no
  // comments, strings, declarations, dotted names, tactic blocks, or quoted names.
  const tokens = statement.match(/[A-Za-z]+|\d+|[ \t\r\n]+|[()+*/%=<>:,∀∃→∧∨¬≤≥≠-]/g);
  if (!tokens || tokens.join('') !== statement || tokens.length > 256) return null;
  if (statement.includes('--') || statement.includes('/-') || statement.includes('-/') || statement.includes(':=')) return null;
  let depth = 0;
  for (const token of tokens) {
    if (/^[A-Za-z]/.test(token) && !IDENTIFIERS.has(token)) return null;
    if (/^\d/.test(token) && token.length > 32) return null;
    if (token === '(' && ++depth > 32) return null;
    if (token === ')' && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  return { statement, tactic: p.tactic as LeanTactic };
}

async function availability(runner: LeanRunner, cwd: string) {
  try {
    const result = await runner({ args: ['--version'], cwd, timeoutMs: 3000, maxOutputBytes: 4096 });
    if (result.unavailable) return { available: false, reason: 'Lean is not installed or cannot be started.' };
    if (result.timedOut || result.outputExceeded) return { available: false, reason: 'Lean availability check exceeded its resource limit.' };
    const version = result.stdout.trim();
    if (result.exitCode !== 0 || !/^Lean \(version 4\.[^\r\n]+\)$/.test(version)) {
      return { available: false, reason: 'A supported Lean 4 installation was not detected.' };
    }
    return { available: true, leanVersion: version, reason: 'Lean 4 is available.' };
  } catch { return { available: false, reason: 'Lean could not be started.' }; }
}

export async function checkLeanAvailability(runner: LeanRunner = nativeRunner): Promise<{ available: boolean; leanVersion?: string; reason: string }> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'keating-lean-'));
    return await availability(runner, directory);
  } catch { return { available: false, reason: 'Cannot create an isolated Lean check directory.' }; }
  finally { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}); }
}

/**
 * Checks only the submitted formal proposition using one curated tactic. A
 * successful proof does not establish that the proposition matches prose, a
 * quiz, or a real-world claim. Never use a rejected proof as a falsehood verdict.
 */
export async function verifyLeanProof(input: unknown, runner: LeanRunner = nativeRunner): Promise<LeanVerification> {
  const valid = validateInput(input);
  const base = { statement: valid?.statement ?? '', tactic: valid?.tactic ?? '', axioms: [] as string[] };
  if (!valid) return { ...base, status: 'unsupported', reason: 'Use a bounded Nat/Int proposition and one of omega, decide, simp, or rfl; arbitrary Lean source is not accepted.' };
  if (activeChecks >= 2) return { ...base, status: 'unavailable', reason: 'The Lean checker is busy; try again shortly.' };
  activeChecks++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'keating-lean-'));
    const ready = await availability(runner, directory);
    if (!ready.available) return { ...base, status: 'unavailable', reason: ready.reason };
    const withVersion = { ...base, leanVersion: ready.leanVersion };
    const file = join(directory, 'KeatingClaim.lean');
    await writeFile(file, `import Std\nset_option autoImplicit false\nset_option maxRecDepth 512\nset_option maxHeartbeats 200000\ntheorem keating_claim : (${valid.statement}) := by\n  ${valid.tactic}\n#print axioms keating_claim\n`, { mode: 0o600 });
    const result = await runner({ args: [file], cwd: directory, timeoutMs: 10000, maxOutputBytes: OUTPUT_LIMIT });
    if (result.unavailable) return { ...withVersion, status: 'unavailable', reason: 'Lean could not be started for proof checking.' };
    if (result.timedOut || result.outputExceeded || result.stdout.length + result.stderr.length > OUTPUT_LIMIT) {
      return { ...withVersion, status: 'unsupported', reason: 'Proof checking exceeded its time or output limit; the statement remains unverified.' };
    }
    if (result.exitCode !== 0) return { ...withVersion, status: 'rejected', reason: 'Lean did not accept this proof attempt. This does not establish that the statement is false.' };
    // Fail closed: exit code alone also accepts proofs containing sorry. Require
    // one exact axiom report for our named declaration, and no other output.
    const output = result.stdout.trim();
    let axioms: string[];
    if (output === "'keating_claim' does not depend on any axioms") axioms = [];
    else {
      const match = /^'keating_claim' depends on axioms: \[([A-Za-z.,\s]+)\]$/.exec(output);
      if (!match) return { ...withVersion, status: 'rejected', reason: 'Lean did not produce a recognized axiom audit for this theorem.' };
      axioms = match[1].split(',').map((axiom) => axiom.trim());
    }
    if (result.stderr.trim() || axioms.some((axiom) => !AXIOMS.has(axiom))) {
      return { ...withVersion, axioms, status: 'rejected', reason: 'The proof has an unapproved axiom or an unexpected diagnostic; it is not verified.' };
    }
    return { ...withVersion, axioms, status: 'verified', reason: 'Lean checked this exact formal statement; its audited dependencies contain only allowed foundational axioms.' };
  } catch { return { ...base, status: 'unavailable', reason: 'The isolated Lean check could not complete.' }; }
  finally {
    activeChecks--;
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
