import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertFreshBuildDirectory, assertFreshBuildInputs, inspectBuildSource, previewBuildSteps, snapshotBuildFiles, verifyBuildReceipt } from '../scripts/windows-preview-build.mjs';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'keating-build-proof-'));
  temporary.push(repo);
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`Fixture Git failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  git('config', 'user.name', 'Build receipt test');
  git('config', 'user.email', 'build-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '4.0.7' }));
  writeFileSync(join(repo, '.gitignore'), 'desktop/release/\n');
  git('add', 'package.json', '.gitignore');
  git('commit', '--quiet', '-m', 'Fixture');
  git('tag', 'windows-selfsigned-v4.0.7');
  const expected = inspectBuildSource(repo, 'windows-selfsigned-v4.0.7');
  return { repo, expected, directory: join(repo, 'desktop/release') };
}

async function receiptFixture() {
  const state = fixture();
  mkdirSync(join(state.directory, 'win-unpacked/resources'), { recursive: true });
  writeFileSync(join(state.directory, 'win-unpacked/resources/app.asar'), 'fixture package');
  writeFileSync(join(state.directory, 'installer.exe'), 'fixture output, not a PE signature');
  writeFileSync(join(state.directory, '.selfsigned-build.json'), JSON.stringify({
    schema: 1, ...state.expected, nativeWindowsBuild: true,
    buildSteps: [
      ['run', '--cwd', 'desktop', 'setup:electron'],
      ['run', '--cwd', 'desktop', 'build:main'],
      ['run', '--cwd', 'desktop', 'dist:windows', '--publish', 'never'],
    ], files: await snapshotBuildFiles(state.directory),
  }));
  return state;
}

test('fresh build refuses old output without removing it', () => {
  const { directory } = fixture();
  expect(() => assertFreshBuildDirectory(directory)).not.toThrow();
  mkdirSync(directory, { recursive: true });
  expect(() => assertFreshBuildDirectory(directory)).not.toThrow();
  writeFileSync(join(directory, 'old-installer.exe'), 'old output');
  expect(() => assertFreshBuildDirectory(directory)).toThrow('empty generated output');
});

test('refuses stale generated input code before any build starts', () => {
  const { repo } = fixture();
  expect(() => assertFreshBuildInputs(repo)).not.toThrow();
  for (const relativeDirectory of ['desktop/dist', 'packages/p2p-core/dist', 'web/dist', 'web/.output']) {
    const directory = join(repo, relativeDirectory);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'removed-source.js'), 'obsolete emitted code');
    expect(() => assertFreshBuildInputs(repo)).toThrow('empty generated output');
    rmSync(directory, { recursive: true });
  }
});

test('dirty tracked or untracked source cannot be labeled as the tagged commit', () => {
  const { repo, expected } = fixture();
  writeFileSync(join(repo, 'new-source.ts'), 'uncommitted source');
  expect(() => inspectBuildSource(repo, expected.releaseTag)).toThrow('clean checkout');
  rmSync(join(repo, 'new-source.ts'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '4.0.8' }));
  expect(() => inspectBuildSource(repo, expected.releaseTag)).toThrow('clean checkout');
});

test('requires matching source inputs and receipt before verification', async () => {
  const { repo, directory, expected } = await receiptFixture();
  expect((await verifyBuildReceipt(repo, expected)).outputFileCount).toBe(2);
  await expect(verifyBuildReceipt(repo, { ...expected, sourceCommit: '0'.repeat(40) })).rejects.toThrow();
  rmSync(join(directory, '.selfsigned-build.json'));
  await expect(verifyBuildReceipt(repo, expected)).rejects.toThrow();
});

test('detects changed packaged resources, including non-PE contents', async () => {
  const { repo, directory, expected } = await receiptFixture();
  writeFileSync(join(directory, 'win-unpacked/resources/app.asar'), 'modified package');
  await expect(verifyBuildReceipt(repo, expected)).rejects.toThrow('packaged files changed');
});

test('detects additional packaged files and source changes after building', async () => {
  const { repo, directory, expected } = await receiptFixture();
  writeFileSync(join(directory, 'injected.dll'), 'additional file');
  await expect(verifyBuildReceipt(repo, expected)).rejects.toThrow('packaged files changed');
  rmSync(join(directory, 'injected.dll'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '4.0.8' }));
  await expect(verifyBuildReceipt(repo, expected)).rejects.toThrow('clean checkout');
});

test('permits the pinned local relay recipe and rejects an unsigned recipe', async () => {
  const { repo, directory, expected } = await receiptFixture();
  const receiptPath = join(directory, '.selfsigned-build.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.localSigningRelay = true;
  receipt.buildSteps = previewBuildSteps(true);
  writeFileSync(receiptPath, JSON.stringify(receipt));
  expect((await verifyBuildReceipt(repo, expected)).localSigningRelay).toBe(true);
  receipt.buildSteps[2].push('--config.win.forceCodeSigning=false');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  await expect(verifyBuildReceipt(repo, expected)).rejects.toThrow('receipt is invalid');
});
