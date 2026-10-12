import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { assertPreviewCertificate, assertPreviewSource, assertVerifiedSelfSignedOutput } from '../scripts/windows-selfsigned.mjs';

const digest = 'a'.repeat(64);
// Labels and whitespace follow the pinned osslsigncode 2.10 helpers.c and
// osslsigncode.c output. These are parser tests, not native signature proof.
const verified = `Message digest algorithm  : SHA256
Current message digest    : ${digest}
Calculated message digest : ${digest}
Leaf hash match: ok
Timestamp Server Signature verification: ok
Signature verification: ok
`;

describe('self-signed preview verification gates', () => {
  test('requires all independent digest, leaf, timestamp and signature proofs', () => {
    expect(assertVerifiedSelfSignedOutput(verified, 0).timestampVerified).toBe(true);
    for (const line of verified.trim().split('\n')) {
      expect(() => assertVerifiedSelfSignedOutput(verified.replace(`${line}\n`, ''), 0)).toThrow();
    }
  });
  test('rejects nonzero tool exit even with success text', () => {
    expect(() => assertVerifiedSelfSignedOutput(verified, 1)).toThrow();
  });
  test('rejects timestamp failure even when the tool reports overall signature success', () => {
    expect(() => assertVerifiedSelfSignedOutput(verified.replace('Timestamp Server Signature verification: ok', 'Timestamp Server Signature verification: failed'), 0)).toThrow();
  });
  test('rejects unsigned, untimestamped, disabled and weaker digest verification', () => {
    for (const bad of [
      'No signature found',
      verified.replace('Timestamp Server Signature verification: ok', 'Timestamp is not available'),
      verified.replace('Timestamp Server Signature verification: ok', 'Timestamp Server Signature verification is disabled'),
      verified.replace('SHA256', 'SHA1'),
    ]) expect(() => assertVerifiedSelfSignedOutput(bad, 0)).toThrow();
  });
  test('rejects mismatched and ambiguous digests and failed leaf pin', () => {
    for (const bad of [
      verified.replace(`Calculated message digest : ${digest}`, `Calculated message digest : ${'b'.repeat(64)}`),
      verified + `Current message digest : ${digest}\n`,
      verified.replace('Leaf hash match: ok', 'Leaf hash match: failed'),
      verified + 'Calculated message digest : MISMATCH!!!\n',
    ]) expect(() => assertVerifiedSelfSignedOutput(bad, 0)).toThrow();
  });
  test('handles Windows CRLF output', () => {
    expect(assertVerifiedSelfSignedOutput(verified.replaceAll('\n', '\r\n'), 0).signatureVerified).toBe(true);
  });
});

describe('source and identity binding', () => {
  const source = { version: '4.0.7', releaseTag: 'windows-selfsigned-v4.0.7', sourceCommit: 'a'.repeat(40), ref: 'refs/tags/windows-selfsigned-v4.0.7', preflightOnly: false, publish: false };
  test('requires exact preview tag and source commit for signing', () => {
    expect(() => assertPreviewSource(source)).not.toThrow();
    for (const changes of [
      { releaseTag: 'v4.0.7' }, { releaseTag: 'windows-selfsigned-v4.0.6' },
      { ref: 'refs/heads/main' }, { sourceCommit: 'a98f9ce0' },
    ]) expect(() => assertPreviewSource({ ...source, ...changes })).toThrow();
  });
  test('permits credential-free branch preflight but rejects publishing it', () => {
    expect(() => assertPreviewSource({ ...source, preflightOnly: true, ref: 'refs/heads/main' })).not.toThrow();
    expect(() => assertPreviewSource({ ...source, preflightOnly: true, publish: true })).toThrow();
  });
  const pem = readFileSync(new URL('../signing/windows-selfsigned-public.pem', import.meta.url));
  const fingerprint = readFileSync(new URL('../signing/windows-selfsigned-fingerprint.txt', import.meta.url), 'utf8').trim();
  test('validates the approved public identity without loading a private key', () => {
    const result = assertPreviewCertificate(pem, fingerprint, Date.parse('2026-10-10T00:00:00Z'));
    expect(result.certificateSHA256).toBe('8f76dd176bc9262a79eef7b3ae2449294ca207cdefbc34fba62c798ac5beecae');
    expect(result.validTo).toBe('2027-10-03T00:16:23.000Z');
  });
  test('rejects an unpinned, expired or not-yet-valid certificate', () => {
    expect(() => assertPreviewCertificate(pem, '0'.repeat(64), Date.parse('2026-10-10T00:00:00Z'))).toThrow();
    expect(() => assertPreviewCertificate(pem, fingerprint, Date.parse('2026-10-02T00:00:00Z'))).toThrow();
    expect(() => assertPreviewCertificate(pem, fingerprint, Date.parse('2027-10-03T00:16:23Z'))).toThrow();
  });
});
