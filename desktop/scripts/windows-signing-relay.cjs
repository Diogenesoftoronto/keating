// Electron Builder 25 custom win.sign hook. Only public binaries leave Windows;
// the private signing key and password never enter this runner.
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { copyFileSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { basename, join, relative, resolve } = require('node:path');

function run(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 10 * 1024 * 1024 }); }
  catch { throw new Error(`Local signing relay ${basename(command)} operation failed`); }
}
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));

module.exports = async function signThroughLocalOwner(configuration) {
  if (process.platform !== 'win32' || configuration.hash !== 'sha256') throw new Error('Relay requires native Windows and SHA256');
  const { assertRelayRelease, assertRelayRequest, assertRelayResponse } = await import('./windows-signing-relay.mjs');
  const { assertVerifiedSelfSignedOutput } = await import('./windows-selfsigned.mjs');
  const repo = resolve(__dirname, '../..');
  const file = realpathSync(configuration.path);
  const expected = { releaseId: Number(process.env.KEATING_RELAY_RELEASE_ID), releaseTag: process.env.RELEASE_TAG,
    sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    certificateSHA256: readFileSync(join(repo, 'desktop/signing/windows-selfsigned-fingerprint.txt'), 'utf8').trim() };
  const ghRepo = process.env.GITHUB_REPOSITORY;
  if (ghRepo !== 'Diogenesoftoronto/keating' || !process.env.GH_TOKEN || !process.env.KEATING_RELAY_VERIFIER || !process.env.KEATING_RELAY_TSA_ROOTS) {
    throw new Error('Exact repository and credential-free verifier preparation are required');
  }
  const requestId = randomUUID();
  const temporary = join(process.env.RUNNER_TEMP, `keating-sign-${requestId}`);
  mkdirSync(temporary);
  const unsigned = join(temporary, `relay-${requestId}.unsigned.exe`);
  const requestPath = join(temporary, `relay-${requestId}.request.json`);
  const signed = join(temporary, `relay-${requestId}.signed.exe`);
  const responsePath = join(temporary, `relay-${requestId}.response.json`);
  const verifier = process.env.KEATING_RELAY_VERIFIER;
  try {
    const beforeData = join(temporary, 'before.der');
    run(verifier, ['extract-data', '-h', 'sha256', '-in', file, '-out', beforeData]);
    const request = assertRelayRequest({ schema: 1, requestId, ...expected, algorithm: 'sha256',
      file: relative(repo, file).replaceAll('\\', '/'), unsignedSHA256: sha256(file),
      authenticodeDataSHA256: sha256(beforeData), size: statSync(file).size }, expected);
    const release = JSON.parse(run('gh', ['api', `repos/${ghRepo}/releases/${expected.releaseId}`]));
    assertRelayRelease(release, expected);
    copyFileSync(file, unsigned);
    writeFileSync(requestPath, JSON.stringify(request));
    const archive = join(temporary, 'request.zip');
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      'Compress-Archive -LiteralPath $env:KEATING_UNSIGNED_FILE,$env:KEATING_REQUEST_FILE -DestinationPath $env:KEATING_REQUEST_ARCHIVE'],
    { env: { ...process.env, KEATING_UNSIGNED_FILE: unsigned, KEATING_REQUEST_FILE: requestPath, KEATING_REQUEST_ARCHIVE: archive }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    const { uploadSigningRequest } = require('./windows-signing-artifact.cjs');
    const artifact = await uploadSigningRequest({ archivePath: archive, name: `relay-${requestId}` });
    console.log(`Waiting for local owner signature: ${request.file}`);
    let assets;
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      const current = JSON.parse(run('gh', ['api', `repos/${ghRepo}/releases/${expected.releaseId}`]));
      assertRelayRelease(current, expected);
      assets = current.assets;
      if (assets.some(asset => asset.name === basename(responsePath) && asset.state === 'uploaded')
          && assets.some(asset => asset.name === basename(signed) && asset.state === 'uploaded')) break;
      await pause(5000);
    }
    if (!assets?.some(asset => asset.name === basename(responsePath) && asset.state === 'uploaded')
        || !assets?.some(asset => asset.name === basename(signed) && asset.state === 'uploaded')) {
      throw new Error('Local signer did not respond before the signing deadline');
    }
    run('gh', ['release', 'download', expected.releaseTag, '--repo', ghRepo, '--dir', temporary, '--pattern', basename(signed), '--pattern', basename(responsePath)]);
    const response = JSON.parse(readFileSync(responsePath, 'utf8'));
    assertRelayResponse(response, request);
    if (sha256(signed) !== response.signedSHA256 || sha256(file) !== request.unsignedSHA256) throw new Error('Signing exchange binary changed');
    const afterData = join(temporary, 'after.der');
    run(verifier, ['extract-data', '-h', 'sha256', '-in', signed, '-out', afterData]);
    if (sha256(afterData) !== request.authenticodeDataSHA256) throw new Error('Signed response changed the Authenticode payload');
    const verification = run(verifier, ['verify', '-CAfile', join(repo, 'desktop/signing/windows-selfsigned-public.pem'),
      '-TSA-CAfile', process.env.KEATING_RELAY_TSA_ROOTS, '-require-leaf-hash', `sha256:${expected.certificateSHA256}`, '-index', '0', '-in', signed]);
    const integrity = assertVerifiedSelfSignedOutput(verification, 0);
    // NSIS embeds and deletes its temporary uninstaller. Retain the signed PE
    // so the final independent verifier can inspect it too.
    if (basename(file).startsWith('__uninstaller-nsis-')) {
      const retained = join(repo, 'desktop/release/.relay-uninstallers');
      mkdirSync(retained, { recursive: true });
      copyFileSync(signed, join(retained, `${requestId}.exe`));
    }
    const receiptDirectory = join(repo, 'desktop/release/.relay-signatures');
    mkdirSync(receiptDirectory, { recursive: true });
    writeFileSync(join(receiptDirectory, `${requestId}.json`), JSON.stringify({ ...request, ...response, artifact, integrity }));
    copyFileSync(signed, `${file}.keating-signed`);
    renameSync(`${file}.keating-signed`, file);
    for (const asset of assets.filter(asset => [basename(signed), basename(responsePath)].includes(asset.name))) {
      run('gh', ['api', '--method', 'DELETE', `repos/${ghRepo}/releases/assets/${asset.id}`]);
    }
    console.log(`Verified local signature and timestamp: ${request.file}`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
};
