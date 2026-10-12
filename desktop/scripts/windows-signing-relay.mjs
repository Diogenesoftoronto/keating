import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertRelayRelease(release, expected) {
  if (release.id !== expected.releaseId || !release.draft || !release.prerelease
      || release.tag_name !== expected.releaseTag || !/self.signed/i.test(release.name)
      || release.target_commitish !== expected.sourceCommit) {
    throw new Error('Signing exchange requires the exact self-signed draft release and source');
  }
}

export function assertRelayRequest(request, expected) {
  for (const key of ['sourceCommit', 'releaseTag', 'runId', 'runAttempt', 'certificateSHA256']) {
    if (request[key] !== expected[key]) throw new Error(`Signing request ${key} mismatch`);
  }
  if (request.schema !== 1 || !/^[0-9a-f-]{36}$/.test(request.requestId)
      || request.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(request.unsignedSHA256)
      || !/^[a-f0-9]{64}$/.test(request.authenticodeDataSHA256)
      || !Number.isSafeInteger(request.size) || request.size <= 0 || request.size > 1024 * 1024 * 1024
      || typeof request.file !== 'string' || request.file.length > 512
      || !request.file.startsWith('desktop/release/') || !/\.(exe|dll|node)$/i.test(request.file)
      || request.file.includes('\\') || request.file.includes(':') || request.file.includes('\0')
      || request.file.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid PE signing request or output path');
  }
  return request;
}

export function assertRelayResponse(response, request) {
  for (const key of ['schema', 'requestId', 'sourceCommit', 'releaseTag', 'runId', 'runAttempt', 'certificateSHA256', 'unsignedSHA256', 'authenticodeDataSHA256']) {
    if (response[key] !== request[key]) throw new Error(`Signing response ${key} mismatch`);
  }
  if (!/^[a-f0-9]{64}$/.test(response.signedSHA256) || response.timestampVerified !== true || response.signatureVerified !== true) {
    throw new Error('Signing response has no verified SHA256 signature and timestamp');
  }
}

export function assertRelayArtifact(artifact, expected) {
  if (artifact.expired || artifact.workflow_run?.id !== Number(expected.runId)
      || artifact.workflow_run?.head_sha !== expected.sourceCommit
      || !/^relay-[0-9a-f-]{36}$/.test(artifact.name)
      || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)) {
    throw new Error('Signing artifact is not bound by GitHub to the exact source run');
  }
}

export function assertActiveRelayRun(run, expected) {
  if (run.id !== Number(expected.runId) || run.head_sha !== expected.sourceCommit
      || String(run.run_attempt) !== expected.runAttempt || run.status !== 'in_progress') {
    throw new Error('Only the active selected run attempt may receive local signatures');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, requestPath, expectedPath] = process.argv.slice(2);
  if (mode !== 'request') throw new Error('Use request <request-json> <expected-json>');
  console.log(JSON.stringify(assertRelayRequest(JSON.parse(readFileSync(requestPath, 'utf8')), JSON.parse(readFileSync(expectedPath, 'utf8')))));
}
