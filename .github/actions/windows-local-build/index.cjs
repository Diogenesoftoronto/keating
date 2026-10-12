const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
if (!process.env.ACTIONS_RUNTIME_TOKEN || !process.env.ACTIONS_RESULTS_URL) {
  throw new Error('The run-scoped Actions artifact capability is unavailable');
}
if (process.env.INPUT_PREFLIGHT === 'true') {
  (async () => {
    const directory = join(process.env.RUNNER_TEMP, `keating-artifact-transport-${process.env.GITHUB_RUN_ATTEMPT}`);
    mkdirSync(directory);
    const data = join(directory, 'public-transport-check.json');
    const archive = join(directory, 'transport.zip');
    writeFileSync(data, JSON.stringify({ sourceCommit: process.env.GITHUB_SHA, privateCredentialsUsed: false }));
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      'Compress-Archive -LiteralPath $env:KEATING_TRANSPORT_FILE -DestinationPath $env:KEATING_TRANSPORT_ARCHIVE'],
    { env: { ...process.env, KEATING_TRANSPORT_FILE: data, KEATING_TRANSPORT_ARCHIVE: archive }, stdio: ['ignore', 'pipe', 'pipe'] });
    const { uploadSigningRequest } = require(join(process.env.GITHUB_WORKSPACE, 'desktop/scripts/windows-signing-artifact.cjs'));
    const proof = await uploadSigningRequest({ archivePath: archive,
      name: `keating-local-signing-transport-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}` });
    console.log(`Run-scoped public artifact transport verified: ${proof.id}, SHA256 ${proof.digest}`);
  })().catch(() => { console.error('Run-scoped public artifact transport failed'); process.exitCode = 1; });
} else {
  execFileSync(process.execPath, [join(process.env.GITHUB_WORKSPACE, 'desktop/scripts/windows-preview-build.mjs'), 'build'], {
    cwd: process.env.GITHUB_WORKSPACE, env: process.env, stdio: 'inherit', timeout: 80 * 60 * 1000,
  });
}
