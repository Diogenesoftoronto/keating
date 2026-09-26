#!/usr/bin/env node
/** Real RPM/GPG boundary check. Uses only a disposable passphrase-protected key. */
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCommand, signRelease } from '../scripts/sign-release.mjs';

const directory = await mkdtemp(join(tmpdir(), 'keating-rpm-signing-smoke-'));
const home = join(directory, 'gnupg');
const artifacts = join(directory, 'artifacts');
const build = join(directory, 'build');
const env = { ...process.env, GNUPGHOME: home };
// Never use release material in this check, including inherited secret values.
delete env.KEATING_RELEASE_SIGNING_KEY;
delete env.KEATING_RELEASE_SIGNING_PASSPHRASE;
const passphrase = 'ephemeral-fixture-only-passphrase';

try {
  for (const path of [home, artifacts, ...['BUILD', 'BUILDROOT', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS'].map(name => join(build, name))]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  await runCommand('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase-fd', '3', '--quick-generate-key',
    'Keating RPM test only <fixture@example.invalid>', 'rsa3072', 'sign', '1d'], { env, passphrase });
  const listing = await runCommand('gpg', ['--batch', '--with-colons', '--fingerprint', '--list-secret-keys'], { env });
  const fingerprint = listing.split('\n').find(line => line.startsWith('fpr:'))?.split(':')[9];
  assert.match(fingerprint ?? '', /^[A-F0-9]{40}$/);
  const pin = join(directory, 'fingerprint.txt');
  await writeFile(pin, fingerprint);
  const spec = join(build, 'SPECS/fixture.spec');
  await writeFile(spec, `Name: keating-signing-fixture
Version: 1.0
Release: 1
Summary: Ephemeral signing fixture
License: MIT
BuildArch: noarch
%description
Test-only fixture.
%install
mkdir -p %{buildroot}/usr/share/keating-signing-fixture
printf fixture > %{buildroot}/usr/share/keating-signing-fixture/payload
%files
/usr/share/keating-signing-fixture/payload
`);
  await runCommand('rpmbuild', ['--define', `_topdir ${build}`, '-bb', spec], { env });
  const name = (await readdir(join(build, 'RPMS/noarch'))).find(file => file.endsWith('.rpm'));
  assert.ok(name, 'RPM fixture was not built');
  const rpm = join(artifacts, name);
  await copyFile(join(build, 'RPMS/noarch', name), rpm);
  // Invalidate the key-generation agent cache: signing must supply the
  // protected key passphrase, rather than accidentally relying on the cache.
  await runCommand('gpgconf', ['--kill', 'gpg-agent'], { env });
  const result = await signRelease({ artifactsDirectory: artifacts, fingerprintPath: pin, rpmSign: true,
    env: { ...env, KEATING_RELEASE_SIGNING_PASSPHRASE: passphrase } });
  assert.equal(result.rpmEmbeddedSignatures, 1);
  assert.equal(result.detachedSignatures, 2);
  await runCommand('gpg', ['--batch', '--verify', `${rpm}.asc`, rpm], { env });
  await runCommand('gpg', ['--batch', '--verify', join(artifacts, 'SHA256SUMS.asc'), join(artifacts, 'SHA256SUMS')], { env });
  const keyring = join(directory, 'rpmdb');
  await runCommand('rpm', ['--dbpath', keyring, '--initdb'], { env });
  await runCommand('rpm', ['--dbpath', keyring, '--import', join(artifacts, 'keating-release-key.asc')], { env });
  const verification = await runCommand('rpm', ['--dbpath', keyring, '--checksig', rpm], { env });
  assert.match(verification, /\bsignatures OK\b/);
  assert.doesNotMatch(verification, /NOKEY|NOTTRUSTED|UNSIGNED|NOT OK/i);
  const bytes = await readFile(rpm);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(rpm, bytes);
  await assert.rejects(runCommand('rpm', ['--dbpath', keyring, '--checksig', rpm], { env }));
  await assert.rejects(runCommand('gpg', ['--batch', '--verify', `${rpm}.asc`, rpm], { env }));
  console.log('Real protected-key RPM embedded/detached signatures and signed manifest verified; tampering rejected.');
} finally {
  await runCommand('gpgconf', ['--kill', 'gpg-agent'], { env }).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
