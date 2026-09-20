/** Real Linux processes only: no models, credentials, grants or network calls. */
import { test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchInstructionProcess, type InstructionProcess } from './native_instruction_backend.js';

const ROOT = resolve(import.meta.dir, '../..');
const SUPERVISOR = join(import.meta.dir, 'native_process_supervisor.py');
const BACKEND = join(import.meta.dir, 'native_instruction_backend.ts');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PASSWORD|AUTHORIZATION/.test(key)
  || ['PYTHONHOME', 'PYTHONPATH'].includes(key)) delete env[key];
let directory: string, PYTHON: string;
beforeAll(() => {
  PYTHON = execFileSync('uv', ['run', '--offline', '--no-project', '--managed-python', '--python', '3.13', 'python', '-c', 'import sys;print(sys.executable)'], {env, encoding:'utf8'}).trim();
});
const stops: (() => Promise<void>)[] = [];
beforeEach(async () => {
  const base = join(ROOT, '.keating/native-learning/supervisor-tests'); await mkdir(base, { recursive: true });
  directory = await mkdtemp(join(base, 'authored-'));
});
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await rm(directory, { recursive: true, force: true });
});
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, milliseconds = 10_000): Promise<T> {
  const end = Date.now() + milliseconds;
  let value: T;
  do { value = await read(); if (accept(value)) return value; await Bun.sleep(25); } while (Date.now() < end);
  throw new Error('authored_process_test_timeout');
}
async function json(path: string): Promise<any> { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
const gone = (pid: number) => !existsSync(`/proc/${pid}`);
async function pids() {
  return Promise.all((await readdir(directory)).filter(name => name.endsWith('.pid')).map(async name => Number(await readFile(join(directory, name), 'utf8'))));
}
async function expectGone(ids: number[]) {
  await until(async () => ids.every(gone), Boolean);
  expect(ids.every(gone)).toBe(true); // Includes zombie reaping, not just signal delivery.
}
async function treeScript() {
  const path = join(directory, 'tree.py');
  await writeFile(path, `import os,sys,time,signal,subprocess,json
from pathlib import Path
d=Path(sys.argv[1]); depth=int(sys.argv[2]); name=sys.argv[3]
signal.signal(signal.SIGTERM,signal.SIG_IGN)
(d/(name+'-'+str(depth)+'.pid')).write_text(str(os.getpid()))
if depth: subprocess.Popen([sys.executable,__file__,str(d),str(depth-1),name],start_new_session=True,close_fds=True)
print(json.dumps({'ready':True,'pid':os.getpid()}),flush=True)
while True: time.sleep(1)
`);
  return path;
}
async function launchTree(): Promise<InstructionProcess> {
  const child = await launchInstructionProcess({ role: 'actor', executable: PYTHON, supervisor_python: PYTHON,
    args: [await treeScript(), directory, '2', 'tree'], env, log: join(directory, 'actor.log') });
  stops.push(() => child.stop());
  expect((await child.metadata()).ready).toBe(true);
  await until(pids, ids => ids.length === 3);
  return child;
}
function started(child: ChildProcess) {
  return new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? -1)); });
}

test('production stop reaps a TERM-resistant root and detached grandchildren; repeated stop is safe', async () => {
  const child = await launchTree(); const ids = await pids();
  await Promise.all([child.stop(), child.stop()]);
  await expectGone(ids);
  const record = await json(join(directory, 'actor.log.supervision.json'));
  expect(record.cleanup_verified).toBe(true); expect(record.remaining_pids).toEqual([]);
  expect(record.provider_cancellation).toBe('not_attested');
}, 15_000);

test('root SIGKILL still reaps detached descendants before completion is reported', async () => {
  const child = await launchTree(); const ids = await pids();
  const record = await json(join(directory, 'actor.log.supervision.json'));
  process.kill(record.root_pid, 'SIGKILL');
  expect(await child.completed).not.toBe(0); await child.stop(); await expectGone(ids);
  expect((await json(join(directory, 'actor.log.supervision.json'))).reason).toBe('root_failed_or_killed');
}, 15_000);

test('owner SIGKILL closes the real backend pipe and cleans every service descendant', async () => {
  const script = await treeScript();
  const owner = spawn(process.execPath, ['--eval', `
    import {launchInstructionProcess} from ${JSON.stringify(BACKEND)};
    await launchInstructionProcess({role:'learner',executable:${JSON.stringify(PYTHON)},supervisor_python:${JSON.stringify(PYTHON)},args:${JSON.stringify([script, directory, '2', 'owner'])},
      env:process.env,log:${JSON.stringify(join(directory, 'owner.log'))}});
    setInterval(()=>{},1000);
  `], { env, detached: true, stdio: 'ignore' });
  const done = started(owner);
  stops.push(async () => { if (owner.exitCode === null && owner.signalCode === null) process.kill(owner.pid!, 'SIGKILL'); await done; });
  const ids = await until(pids, ids => ids.length === 3);
  process.kill(owner.pid!, 'SIGKILL'); await done;
  const record = await until(() => json(join(directory, 'owner.log.supervision.json')), v => v?.cleanup_verified === true);
  expect(record.reason).toBe('owner_pipe_closed'); await expectGone(ids);
}, 15_000);

test('outer parent process-group death is supervised across three nested backend groups', async () => {
  const script = await treeScript(); const ownerPath = join(directory, 'outer.py');
  const ownerCode = `
    import {launchInstructionProcess} from ${JSON.stringify(BACKEND)};
    for(const role of ['actor','learner','worker']) await launchInstructionProcess({role,executable:${JSON.stringify(PYTHON)},supervisor_python:${JSON.stringify(PYTHON)},
      args:[${JSON.stringify(script)},${JSON.stringify(directory)},'2',role],env:process.env,
      log:${JSON.stringify(directory)}+'/'+role+'.log'});
    setInterval(()=>{},1000);
  `;
  const command = [PYTHON, SUPERVISOR, '--record', join(directory, 'outer.json'), '--role', 'parent-bun',
    '--abort-file', join(directory, 'abort.json'), '--comparison', 'a'.repeat(64), '--', process.execPath, '--eval', ownerCode];
  await writeFile(ownerPath, `import subprocess,time\np=subprocess.Popen(${JSON.stringify(command)},stdin=subprocess.PIPE,start_new_session=True)\nwhile True: time.sleep(1)\n`);
  const owner = spawn(PYTHON, [ownerPath], { env, detached: true, stdio: 'ignore' }); const done = started(owner);
  stops.push(async () => { if (owner.exitCode === null && owner.signalCode === null) process.kill(-owner.pid!, 'SIGKILL'); await done; });
  const ids = await until(pids, ids => ids.length === 9);
  const inner = await Promise.all(['actor','learner','worker'].map(role => json(join(directory, role+'.log.supervision.json'))));
  const outer = await json(join(directory, 'outer.json'));
  process.kill(-owner.pid!, 'SIGKILL'); await done;
  await until(() => json(join(directory, 'outer.json')), v => v?.cleanup_verified === true);
  await expectGone([...ids, outer.root_pid, ...inner.map(v => v.guardian_pid)]);
  expect((await json(join(directory, 'abort.json'))).comparison_sha256).toBe('a'.repeat(64));
}, 20_000);

test('aborted launch creates no process or log', async () => {
  const signal = AbortSignal.abort();
  await expect(launchInstructionProcess({ role: 'worker', executable: PYTHON, supervisor_python: PYTHON, args: [], env,
    log: join(directory, 'never.log'), signal })).rejects.toThrow();
  expect(existsSync(join(directory, 'never.log'))).toBe(false);
});

test('a failed cleanup receipt cannot be treated as verified even after guardian exit', async () => {
  const child = await launchTree(); const ids = await pids();
  const path = join(directory, 'actor.log.supervision.json');
  process.kill((await json(path)).root_pid, 'SIGKILL'); await child.completed; await expectGone(ids);
  stops.pop(); // All real descendants already reaped. Now exercise the receipt gate.
  const receipt = await json(path); receipt.cleanup_verified = false;
  await writeFile(path, JSON.stringify(receipt));
  await expect(child.stop()).rejects.toThrow('cleanup_unverified');
}, 15_000);
