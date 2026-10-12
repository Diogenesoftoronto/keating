import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertPreviewSource({ version, releaseTag, sourceCommit, ref, preflightOnly, publish }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || releaseTag !== `windows-selfsigned-v${version}`) {
    throw new Error('Self-signed preview tag must match the source version');
  }
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('A complete source commit is required');
  if (preflightOnly && publish) throw new Error('Preflight cannot publish a release');
  if (!preflightOnly && ref !== `refs/tags/${releaseTag}`) {
    throw new Error('A signing build must run on its exact existing preview tag');
  }
}

export function assertPreviewCertificate(pem, expectedSHA256, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(expectedSHA256)) throw new Error('Invalid pinned certificate fingerprint');
  const certificate = new X509Certificate(pem);
  const fingerprint = createHash('sha256').update(certificate.raw).digest('hex');
  if (fingerprint !== expectedSHA256) throw new Error('Public certificate does not match its pinned fingerprint');
  if (certificate.subject !== 'CN=Keating Self-Signed Preview' || certificate.issuer !== certificate.subject
      || !certificate.verify(certificate.publicKey) || certificate.ca) {
    throw new Error('Expected the self-signed Keating preview leaf certificate');
  }
  if (!certificate.keyUsage?.includes('1.3.6.1.5.5.7.3.3')) throw new Error('Certificate does not permit code signing');
  if (certificate.publicKey.asymmetricKeyType !== 'rsa'
      || certificate.publicKey.asymmetricKeyDetails?.modulusLength !== 3072) {
    throw new Error('Expected RSA-3072 signing identity');
  }
  const starts = Date.parse(certificate.validFrom);
  const ends = Date.parse(certificate.validTo);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || now < starts || now >= ends) {
    throw new Error('Signing certificate is not currently valid');
  }
  return { certificateSHA256: fingerprint, subject: certificate.subject, validFrom: new Date(starts).toISOString(), validTo: new Date(ends).toISOString() };
}

// osslsigncode 2.10 can return success after a timestamp failure if the leaf
// is valid at the current time. Require every independent proof explicitly.
export function assertVerifiedSelfSignedOutput(output, exitCode) {
  if (exitCode !== 0) throw new Error('Authenticode verification command failed');
  if (/MISMATCH!!!|:\s*failed\b|Timestamp is not available|verification is disabled/i.test(output)) {
    throw new Error('Authenticode digest, signature or timestamp verification failed');
  }
  for (const required of [
    /^Message digest algorithm {2,}:[\t ]*SHA256[\t ]*$/m,
    /^Leaf hash match:[\t ]*ok[\t ]*$/m,
    /^Timestamp Server Signature verification:[\t ]*ok[\t ]*$/m,
    /^Signature verification:[\t ]*ok[\t ]*$/m,
  ]) {
    if (!required.test(output)) throw new Error('Missing required SHA256, leaf pin, timestamp or signature proof');
  }
  const current = [...output.matchAll(/^Current message digest[\t ]*:[\t ]*([A-Fa-f0-9]{64})[\t ]*$/gm)];
  const calculated = [...output.matchAll(/^Calculated message digest[\t ]*:[\t ]*([A-Fa-f0-9]{64})[\t ]*$/gm)];
  if (current.length !== 1 || calculated.length !== 1 || current[0][1].toLowerCase() !== calculated[0][1].toLowerCase()) {
    throw new Error('Missing, ambiguous or mismatched PE file digest');
  }
  return { digestAlgorithm: 'SHA256', authenticodeDigest: current[0][1].toLowerCase(), leafPinVerified: true, timestampVerified: true, signatureVerified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'certificate') {
    const directory = resolve(import.meta.dirname, '../signing');
    console.log(JSON.stringify(assertPreviewCertificate(
      readFileSync(resolve(directory, 'windows-selfsigned-public.pem')),
      readFileSync(resolve(directory, 'windows-selfsigned-fingerprint.txt'), 'utf8').trim(),
    )));
  } else if (mode === 'source') {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    assertPreviewSource({ version, releaseTag: process.env.RELEASE_TAG, sourceCommit: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF, preflightOnly: process.env.PREFLIGHT_ONLY === 'true', publish: process.env.PUBLISH === 'true' });
    console.log(version);
  } else if (mode === 'signature' && args.length === 2) {
    console.log(JSON.stringify(assertVerifiedSelfSignedOutput(readFileSync(args[0], 'utf8'), Number(args[1]))));
  } else {
    throw new Error('Use certificate, source, or signature <verification-log> <exit-code>');
  }
}
