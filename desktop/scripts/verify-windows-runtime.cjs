// Execute with the packaged Keating.exe and ELECTRON_RUN_AS_NODE=1. This checks
// the shipped Electron ABI/native dependency closure, not the CI Node runtime.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');

async function main() {
  assert.equal(process.platform, 'win32', 'Run this smoke test on Windows');
  assert.equal(process.arch, 'x64');
  assert.ok(process.versions.electron, 'Use the packaged Electron executable');
  assert.ok(process.argv[2], 'Pass the packaged app.asar path');
  const appRequire = createRequire(join(resolve(process.argv[2]), 'package.json'));
  // Loading Hyperswarm exercises its Windows UDP/native dependency bindings
  // without opening a public peer connection in CI.
  assert.equal(typeof appRequire('hyperswarm'), 'function');
  const Corestore = appRequire('corestore');
  const directory = await mkdtemp(join(tmpdir(), 'keating-windows-package-'));
  const store = new Corestore(directory);
  try {
    const core = store.get({ name: 'windows-package-smoke' });
    await core.ready();
    await core.append(Buffer.from('Keating Windows native storage'));
    assert.equal((await core.get(0)).toString(), 'Keating Windows native storage');
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
  console.log('Packaged Windows Electron native dependencies and storage passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
