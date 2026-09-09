import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env.GNUPGHOME;
const key = process.env.KEATING_RELEASE_SIGNING_KEY;
const passphrase = process.env.KEATING_RELEASE_SIGNING_PASSPHRASE;
if (!home || !key || !passphrase) throw new Error('Release signing secrets and an isolated GNUPGHOME are required.');
mkdirSync(home, { recursive: true, mode: 0o700 });
chmodSync(home, 0o700);
writeFileSync(join(home, 'gpg-agent.conf'), 'default-cache-ttl 7200\nmax-cache-ttl 7200\n', { mode: 0o600 });
function gpg(args, input) {
  const result = spawnSync('gpg', ['--batch', '--yes', ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('Release signing key preparation failed. Check the configured secrets.');
  return result.stdout;
}
gpg(['--import'], key);
const pin = readFileSync(new URL('../signing/fingerprint.txt', import.meta.url), 'utf8').trim();
const fingerprints = gpg(['--with-colons', '--list-secret-keys', pin]).split('\n').filter(line => line.startsWith('fpr:')).map(line => line.split(':')[9]);
if (fingerprints[0] !== pin) throw new Error('Imported signing key does not match the committed fingerprint.');
// Warm the agent for Flatpak/GPGME; the passphrase travels only through stdin.
gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', pin,
  '--output', join(home, 'unlock.sig'), '--detach-sign', new URL('../signing/fingerprint.txt', import.meta.url).pathname], passphrase + '\n');
console.log(`Prepared Keating release signing key ${pin}.`);
