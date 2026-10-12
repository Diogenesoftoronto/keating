import { expect, test } from 'bun:test';
import { assertActiveRelayRun, assertRelayArtifact, assertRelayRelease, assertRelayRequest, assertRelayResponse } from '../scripts/windows-signing-relay.mjs';

const expected = { releaseId: 123, sourceCommit: 'a'.repeat(40), releaseTag: 'windows-selfsigned-v4.0.7', runId: '12345', runAttempt: '1', certificateSHA256: 'b'.repeat(64) };
const request = { schema: 1, ...expected, requestId: '11111111-1111-4111-8111-111111111111', algorithm: 'sha256',
  file: 'desktop/release/win-unpacked/Keating.exe', size: 2048, unsignedSHA256: 'c'.repeat(64), authenticodeDataSHA256: 'd'.repeat(64) };
const response = { ...request, signedSHA256: 'e'.repeat(64), timestampVerified: true, signatureVerified: true };

test('allows an exact run/source/certificate-bound PE request', () => {
  expect(assertRelayRequest(request, expected)).toEqual(request);
});
test('rejects source, tag, run and leaf substitution before any private signing', () => {
  for (const changes of [
    { sourceCommit: '0'.repeat(40) }, { releaseTag: 'v4.0.7' }, { runId: '54321' }, { runAttempt: '2' }, { certificateSHA256: '0'.repeat(64) },
  ]) expect(() => assertRelayRequest({ ...request, ...changes }, expected)).toThrow();
});

test('requires GitHub artifact metadata for the selected run, beyond uploader claims', () => {
  const artifact = { expired: false, name: `relay-${request.requestId}`, digest: `sha256:${'f'.repeat(64)}`,
    workflow_run: { id: 12345, head_sha: expected.sourceCommit } };
  expect(() => assertRelayArtifact(artifact, expected)).not.toThrow();
  for (const changes of [{ workflow_run: { id: 9999, head_sha: expected.sourceCommit } },
    { workflow_run: { id: 12345, head_sha: '0'.repeat(40) } }, { workflow_run: undefined }, { expired: true }, { digest: undefined }]) {
    expect(() => assertRelayArtifact({ ...artifact, ...changes }, expected)).toThrow();
  }
});

test('does not sign for completed, failed, cancelled, queued or previous-attempt runs', () => {
  const run = { id: 12345, head_sha: expected.sourceCommit, run_attempt: 1, status: 'in_progress' };
  expect(() => assertActiveRelayRun(run, expected)).not.toThrow();
  for (const changes of [{ status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'success' },
    { status: 'cancelled' }, { status: 'queued' }, { run_attempt: 2 }, { id: 9999 }, { head_sha: '0'.repeat(40) }]) {
    expect(() => assertActiveRelayRun({ ...run, ...changes }, expected)).toThrow();
  }
});
test('confines requests to PE outputs within the release directory', () => {
  for (const file of ['../outside.exe', 'desktop/release/../private.exe', 'desktop/release/foo/../../bar.exe',
    'desktop/release/key.pfx', 'desktop/release/../signing/key.exe', 'C:/outside.exe', 'desktop/release/link\\outside.dll',
    'desktop/release/file.exe:stream', 'desktop/release/file.exe\0', 'desktop/release//file.exe']) {
    expect(() => assertRelayRequest({ ...request, file }, expected)).toThrow();
  }
});
test('rejects malformed digests, oversized files and weaker hashing', () => {
  for (const changes of [{ size: 0 }, { size: 1024 ** 3 + 1 }, { unsignedSHA256: 'bad' }, { authenticodeDataSHA256: '' },
    { algorithm: 'sha1' }, { requestId: '../outside' }, { schema: 2 }]) {
    expect(() => assertRelayRequest({ ...request, ...changes }, expected)).toThrow();
  }
});
test('binds signed response to the exact original payload and request', () => {
  expect(() => assertRelayResponse(response, request)).not.toThrow();
  for (const changes of [{ requestId: '22222222-2222-4222-8222-222222222222' }, { unsignedSHA256: '0'.repeat(64) },
    { authenticodeDataSHA256: '0'.repeat(64) }, { sourceCommit: '0'.repeat(40) }, { signedSHA256: 'bad' },
    { timestampVerified: false }, { signatureVerified: false }]) {
    expect(() => assertRelayResponse({ ...response, ...changes }, request)).toThrow();
  }
});
test('requires a draft self-signed prerelease at the exact source identity', () => {
  const release = { id: 123, draft: true, prerelease: true, tag_name: expected.releaseTag,
    target_commitish: expected.sourceCommit, name: 'Keating Windows self-signed preview' };
  expect(() => assertRelayRelease(release, expected)).not.toThrow();
  for (const changes of [{ id: 124 }, { draft: false }, { prerelease: false }, { tag_name: 'v4.0.7' },
    { target_commitish: 'main' }, { name: 'Keating stable' }]) {
    expect(() => assertRelayRelease({ ...release, ...changes }, expected)).toThrow();
  }
});
