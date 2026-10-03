import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const receiptName = '.selfsigned-build.json';
const buildSteps = [
  ['run', '--cwd', 'desktop', 'setup:electron'],
  ['run', '--cwd', 'desktop', 'build:main'],
  ['run', '--cwd', 'desktop', 'dist:windows', '--publish', 'never'],
];

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Source checkout inspection failed');
  return result.stdout.trim();
}

export function inspectBuildSource(repo, releaseTag) {
  if (git(repo, 'status', '--porcelain', '--untracked-files=normal')) {
    throw new Error('Preview build requires a clean checkout, including untracked source files');
  }
  const sourceCommit = git(repo, 'rev-parse', 'HEAD');
  const version = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).version;
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || !/^\d+\.\d+\.\d+$/.test(version)
      || releaseTag !== `windows-selfsigned-v${version}`
      || git(repo, 'rev-parse', `${releaseTag}^{commit}`) !== sourceCommit) {
    throw new Error('Build requires the exact source version and matching preview tag');
  }
  return { version, sourceCommit, releaseTag };
}

export function assertFreshBuildDirectory(directory) {
  if (existsSync(directory) && readdirSync(directory).length) {
    throw new Error(`Preview build requires an empty generated output directory: ${directory}; preserve or move old outputs first`);
  }
}

export function assertFreshBuildInputs(repo) {
  // TypeScript does not remove obsolete emitted files. Check generated inputs
  // as well as installer output so staging cannot silently reuse stale code.
  for (const directory of ['desktop/release', 'desktop/dist', 'packages/p2p-core/dist', 'web/dist', 'web/.output']) {
    assertFreshBuildDirectory(resolve(repo, directory));
  }
}

export async function snapshotBuildFiles(directory) {
  const files = [];
  async function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Build output must not contain symbolic links');
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && relative(directory, path) !== receiptName) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        files.push({ file: relative(directory, path).replaceAll('\\', '/'), sha256: hash.digest('hex') });
      }
    }
  }
  await visit(directory);
  if (!files.length) throw new Error('Build produced no output files');
  return files;
}

export async function verifyBuildReceipt(repo, expected) {
  const source = inspectBuildSource(repo, expected.releaseTag);
  for (const key of ['version', 'sourceCommit', 'releaseTag']) {
    if (source[key] !== expected[key]) throw new Error('Build source does not match verification inputs');
  }
  const directory = resolve(repo, 'desktop/release');
  const receipt = JSON.parse(readFileSync(resolve(directory, receiptName), 'utf8'));
  for (const key of ['version', 'sourceCommit', 'releaseTag']) {
    if (receipt[key] !== source[key]) throw new Error('Fresh-build receipt belongs to another source');
  }
  if (receipt.schema !== 1 || receipt.nativeWindowsBuild !== true
      || JSON.stringify(receipt.buildSteps) !== JSON.stringify(buildSteps)
      || JSON.stringify(receipt.files) !== JSON.stringify(await snapshotBuildFiles(directory))) {
    throw new Error('Fresh-build receipt is invalid or packaged files changed');
  }
  return { sourceCommit: source.sourceCommit, cleanSourceChecked: true, freshOutputChecked: true, outputFileCount: receipt.files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'win32') throw new Error('Build and verify the preview on native Windows');
  const repo = resolve(import.meta.dirname, '../..');
  const [mode, version, sourceCommit, releaseTag] = process.argv.slice(2);
  if (mode === 'verify') {
    console.log(JSON.stringify(await verifyBuildReceipt(repo, { version, sourceCommit, releaseTag })));
  } else if (mode === 'build') {
    const source = inspectBuildSource(repo, process.env.RELEASE_TAG);
    const directory = resolve(repo, 'desktop/release');
    assertFreshBuildInputs(repo);
    const startedAt = new Date().toISOString();
    for (const args of buildSteps) {
      const result = spawnSync('bun', args, { cwd: repo, stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error('Signed Windows preview build failed');
    }
    if (JSON.stringify(inspectBuildSource(repo, source.releaseTag)) !== JSON.stringify(source)) {
      throw new Error('Source changed while building');
    }
    const files = await snapshotBuildFiles(directory);
    writeFileSync(resolve(directory, receiptName), JSON.stringify({ schema: 1, ...source,
      nativeWindowsBuild: true, startedAt, completedAt: new Date().toISOString(), buildSteps, files }, null, 2) + '\n', { flag: 'wx' });
    console.log(`Recorded fresh Windows build for ${source.sourceCommit}; ${files.length} output files`);
  } else throw new Error('Use build or verify <version> <source-commit> <preview-tag>');
}
