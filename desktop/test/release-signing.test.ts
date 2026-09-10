import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
// @ts-ignore plain Node release tooling has no declaration file.
import { collectArtifacts, runCommand, signRelease } from '../scripts/sign-release.mjs';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'keating-signing-test-')); directories.push(dir);
  const artifacts = join(dir, 'artifacts'); await mkdir(artifacts);
  return { dir, artifacts };
}
const fingerprint = 'A'.repeat(40);
async function mockFixture() {
  const f = await fixture();
  const pin = join(f.dir, 'fingerprint.txt'); await writeFile(pin, fingerprint);
  await writeFile(join(f.artifacts, 'Keating.AppImage'), 'image');
  const commands: { command: string; args: string[]; options: any }[] = [];
  const run = async (command: string, args: string[], options: any) => {
    commands.push({ command, args, options });
    if (args.includes('--list-secret-keys')) return `sec:::::::::\nfpr:::::::::${fingerprint}:\n`;
    if (args.includes('--checksig')) return 'keating.rpm: digests signatures OK';
    if (args.includes('--export')) return '-----BEGIN PGP PUBLIC KEY BLOCK-----\nTEST\n-----END PGP PUBLIC KEY BLOCK-----\n';
    return '';
  };
  return { ...f, pin, commands, run };
}

describe('release artifact signing', () => {
  test('recursively hashes deterministic basenames and signs Linux artifacts plus the manifest', async () => {
    const f = await mockFixture();
    await mkdir(join(f.artifacts, 'linux'));
    await writeFile(join(f.artifacts, 'linux', 'keating.deb'), 'deb');
    await writeFile(join(f.artifacts, 'keating.exe'), 'windows');
    const secret = 'never-in-argv';
    const result = await signRelease({ artifactsDirectory: f.artifacts, fingerprintPath: f.pin, env: { GNUPGHOME: f.dir, KEATING_RELEASE_SIGNING_PASSPHRASE: secret }, run: f.run });
    expect(result).toMatchObject({ artifacts: 3, detachedSignatures: 3, rpmEmbeddedSignatures: 0 });
    const manifest = await readFile(join(f.artifacts, 'SHA256SUMS'), 'utf8');
    const sum = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(manifest).toBe(`${sum('image')}  Keating.AppImage\n${sum('deb')}  keating.deb\n${sum('windows')}  keating.exe\n`);
    for (const call of f.commands) expect(call.args.join(' ')).not.toContain(secret);
    const signatures = f.commands.filter((call) => call.args.includes('--detach-sign'));
    expect(signatures).toHaveLength(3);
    for (const call of signatures) {
      expect(call.args).toContain('--passphrase-fd');
      expect(call.options.passphrase).toBe(secret);
    }
  });
  test('fails before signing if the secret primary fingerprint differs or only a subkey matches', async () => {
    const f = await mockFixture();
    for (const listing of [`sec:::::::::\nfpr:::::::::${'B'.repeat(40)}:\n`, `sec:::::::::\nfpr:::::::::${'B'.repeat(40)}:\nssb:::::::::\nfpr:::::::::${fingerprint}:\n`]) {
      await expect(signRelease({ artifactsDirectory: f.artifacts, fingerprintPath: f.pin, env: { GNUPGHOME: f.dir }, run: async () => listing })).rejects.toThrow('does not match');
    }
  });
  test('refuses duplicate names and symlink artifacts', async () => {
    const f = await fixture(); await mkdir(join(f.artifacts, 'nested'));
    await writeFile(join(f.artifacts, 'a.deb'), 'one'); await writeFile(join(f.artifacts, 'nested', 'a.deb'), 'two');
    await expect(collectArtifacts(f.artifacts)).rejects.toThrow('Duplicate');
    await rm(join(f.artifacts, 'nested', 'a.deb'));
    if (process.platform !== 'win32') {
      await symlink(join(f.artifacts, 'a.deb'), join(f.artifacts, 'fake.AppImage'));
      await expect(collectArtifacts(f.artifacts)).rejects.toThrow('symbolic');
    }
  });
  test('requires explicit successful RPM embedded signing and passes no passphrase in arguments', async () => {
    const f = await mockFixture(); await writeFile(join(f.artifacts, 'keating.rpm'), 'rpm');
    await expect(signRelease({ artifactsDirectory: f.artifacts, fingerprintPath: f.pin, rpmSign: true, env: { GNUPGHOME: f.dir }, run: async (command: string, args: string[], options: any) => { if (command === 'rpmsign') throw new Error('missing rpmsign'); return f.run(command, args, options); } })).rejects.toThrow('missing rpmsign');
    const result = await signRelease({ artifactsDirectory: f.artifacts, fingerprintPath: f.pin, rpmSign: true, env: { GNUPGHOME: f.dir, KEATING_RELEASE_SIGNING_PASSPHRASE: 'secret' }, run: f.run });
    expect(result.rpmEmbeddedSignatures).toBe(1);
    const rpm = f.commands.find((call) => call.args.includes('--addsign'))!;
    expect(rpm.options.passphrase).toBe('secret');
    expect(rpm.args.join(' ')).not.toContain('secret');
    await expect(signRelease({ artifactsDirectory: f.artifacts, fingerprintPath: f.pin, rpmSign: true, env: { GNUPGHOME: f.dir }, run: async (command: string, args: string[], options: any) => args.includes('--checksig') ? 'keating.rpm: digests OK' : f.run(command, args, options) })).rejects.toThrow('embedded signature was not verified');
  });
  test.skipIf(process.platform === 'win32')('creates and verifies real signatures with an ephemeral test-only key', async () => {
    const f = await fixture(); const home = join(f.dir, 'gnupg'); await mkdir(home, { mode: 0o700 });
    const env = { ...process.env, GNUPGHOME: home };
    // Execute the production Node entry environment: Bun's child_process extra
    // FD emulation can hang GPG even though Node forwards FD 3 correctly.
    const script = `
      import assert from 'node:assert/strict';
      import { readFile, writeFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { runCommand, signRelease } from ${JSON.stringify(new URL('../scripts/sign-release.mjs', import.meta.url).href)};
      const [dir, artifacts] = process.argv.slice(1);
      const env = process.env;
      await runCommand('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase-fd', '3', '--quick-generate-key', 'Keating signing test <test@example.invalid>', 'ed25519', 'sign', '1d'], { env, passphrase: '' });
      const listing = await runCommand('gpg', ['--batch', '--with-colons', '--fingerprint', '--list-secret-keys'], { env });
      const pin = listing.split('\\n').find(line => line.startsWith('fpr:')).split(':')[9];
      const pinPath = join(dir, 'fingerprint.txt'); await writeFile(pinPath, pin);
      await writeFile(join(artifacts, 'keating.deb'), 'test-only artifact bytes');
      const result = await signRelease({ artifactsDirectory: artifacts, fingerprintPath: pinPath, env });
      assert.equal(result.fingerprint, pin);
      assert.match(await readFile(join(artifacts, 'SHA256SUMS.asc'), 'utf8'), /BEGIN PGP SIGNATURE/);
      await runCommand('gpg', ['--batch', '--verify', join(artifacts, 'keating.deb.asc'), join(artifacts, 'keating.deb')], { env });
      await writeFile(join(artifacts, 'keating.deb'), 'tampered');
      await assert.rejects(runCommand('gpg', ['--batch', '--verify', join(artifacts, 'keating.deb.asc'), join(artifacts, 'keating.deb')], { env }), /failed/);
      console.log('ephemeral signatures verified; tampering rejected');
    `;
    expect(await runCommand('node', ['--input-type=module', '-e', script, f.dir, f.artifacts], { env })).toContain('tampering rejected');
  }, 20000);
});
