#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIN_PATH = resolve(HERE, '../signing/fingerprint.txt');
const ARTIFACT = /(?:\.AppImage|\.deb|\.rpm|\.exe|\.tar\.gz)$/;
const LINUX = /(?:\.AppImage|\.deb|\.rpm)$/;

/** No command output is logged: signing tools can print sensitive diagnostics. */
export function runCommand(command, args, { passphrase, env = process.env } = {}) {
  return new Promise((resolveResult, reject) => {
    const safeEnv = { ...env };
    delete safeEnv.KEATING_RELEASE_SIGNING_KEY;
    delete safeEnv.KEATING_RELEASE_SIGNING_PASSPHRASE;
    const child = spawn(command, args, { shell: false, env: safeEnv, stdio: ['ignore', 'pipe', 'pipe', passphrase === undefined ? 'ignore' : 'pipe'] });
    let stdout = '', total = 0, settled = false;
    const fail = (message) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(message)); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(`${basename(command)} exceeded its execution limit.`); }, 120000);
    child.once('error', () => fail(`Cannot execute required signing tool ${basename(command)}.`));
    child.stdout.on('data', (data) => { total += data.length; if (total > 1048576) { child.kill('SIGKILL'); fail('Signing tool output exceeded its limit.'); } else stdout += data.toString(); });
    child.stderr.on('data', (data) => { total += data.length; if (total > 1048576) { child.kill('SIGKILL'); fail('Signing tool output exceeded its limit.'); } });
    if (passphrase !== undefined) { child.stdio[3].on('error', () => {}); child.stdio[3].end(`${passphrase}\n`); }
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) { fail(`${basename(command)} failed (exit ${code ?? 'unknown'}); no signing success is claimed.`); return; }
      settled = true; clearTimeout(timer); resolveResult(stdout);
    });
  });
}

export async function collectArtifacts(directory) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Artifact trees must not contain symbolic links.');
      if (entry.isDirectory()) await visit(path);
      else if (ARTIFACT.test(entry.name)) {
        if (!entry.isFile()) throw new Error('A release artifact is not a regular file.');
        if (/[\r\n\\]/.test(entry.name)) throw new Error('Artifact names must not contain newlines or backslashes.');
        files.push(path);
      }
    }
  }
  await visit(directory);
  files.sort((a, b) => basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0);
  if (!files.length) throw new Error('No supported release artifacts were found.');
  const names = new Set();
  for (const file of files) {
    if (names.has(basename(file))) throw new Error(`Duplicate artifact basename: ${basename(file)}`);
    names.add(basename(file));
  }
  return files;
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function signRpms(files, fingerprint, passphrase, env, run) {
  const rpms = files.filter((file) => file.endsWith('.rpm'));
  if (!rpms.length) throw new Error('--rpm-sign was requested but no RPM artifacts exist.');
  await run('rpmsign', ['--version'], { env });
  const directory = await mkdtemp(join(tmpdir(), 'keating-rpmsign-'));
  try {
    // RPM invokes its signer through a macro. The wrapper contains no secret;
    // it reads an inherited FD and gives a fresh FD to each GPG invocation.
    const keyFile = join(directory, 'release-key.asc');
    await writeFile(keyFile, await run('gpg', ['--batch', '--armor', '--export', fingerprint], { env }));
    const keyring = join(directory, 'rpmdb');
    await run('rpm', ['--dbpath', keyring, '--initdb'], { env });
    await run('rpm', ['--dbpath', keyring, '--import', keyFile], { env });
    const wrapper = join(directory, 'gpg-wrapper.mjs');
    await writeFile(wrapper, `#!${process.execPath}\nimport { readFileSync } from 'node:fs';\nimport { spawn } from 'node:child_process';\nconst pass = readFileSync(3);\nconst child = spawn('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase-fd', '3', ...process.argv.slice(2)], { stdio: ['ignore', 'inherit', 'inherit', 'pipe'], shell: false });\nchild.stdio[3].on('error', () => {});\nchild.stdio[3].end(pass);\nchild.on('error', () => process.exit(1));\nchild.on('close', code => process.exit(code ?? 1));\n`, { mode: 0o700 });
    await chmod(wrapper, 0o700);
    if (/["\r\n]/.test(wrapper)) throw new Error('Unsafe RPM signer wrapper path.');
    const command = `"${wrapper}" --no-armor --local-user "${fingerprint}" --detach-sign --output "%{__signature_filename}" "%{__plaintext_filename}"`;
    for (const file of rpms) {
      if (/["\r\n]/.test(file)) throw new Error('Unsafe RPM artifact path.');
      await run('rpmsign', ['--define', `_gpg_name ${fingerprint}`, '--define', `_openpgp_sign_id ${fingerprint}`, '--define', '_openpgp_sign gpg', '--define', `__gpg ${wrapper}`, '--define', `__gpg_sign_cmd ${command}`, '--addsign', file], { passphrase, env });
      const verification = await run('rpm', ['--dbpath', keyring, '--checksig', file], { env });
      if (!/\bsignatures OK\b/.test(verification) || /NOT OK|NOKEY|NOTTRUSTED|UNSIGNED/i.test(verification)) {
        throw new Error('The RPM embedded signature was not verified against the pinned release key.');
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Trusted programmatic options permit ephemeral keys in tests; CLI always uses the committed pin. */
export async function signRelease({ artifactsDirectory, rpmSign = false, fingerprintPath = PIN_PATH, env = process.env, run = runCommand }) {
  const directory = resolve(artifactsDirectory);
  const fingerprint = (await readFile(fingerprintPath, 'utf8')).trim().toUpperCase();
  if (!/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(fingerprint)) throw new Error('The committed release key fingerprint is invalid.');
  if (!env.GNUPGHOME) throw new Error('GNUPGHOME must name the caller-prepared signing keyring.');
  const passphrase = env.KEATING_RELEASE_SIGNING_PASSPHRASE ?? '';
  if (/[\r\n]/.test(passphrase)) throw new Error('Signing passphrases must be a single line.');
  const listing = await run('gpg', ['--batch', '--with-colons', '--fingerprint', '--list-secret-keys', fingerprint], { env });
  let primary = false;
  let match = false;
  for (const line of listing.split('\n')) {
    const columns = line.split(':');
    if (columns[0] === 'sec') primary = true;
    else if (columns[0] === 'ssb') primary = false;
    else if (columns[0] === 'fpr' && primary) { if (columns[9]?.toUpperCase() === fingerprint) match = true; primary = false; }
  }
  if (!match) throw new Error('The imported secret primary key does not match the committed release fingerprint.');
  const files = await collectArtifacts(directory);
  if (rpmSign) await signRpms(files, fingerprint, passphrase, env, run);
  const publicKey = await run('gpg', ['--batch', '--armor', '--export', fingerprint], { env });
  if (!publicKey.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) throw new Error('Cannot export the pinned public release key.');
  await writeFile(join(directory, 'keating-release-key.asc'), publicKey);
  const manifest = (await Promise.all(files.map(async (file) => `${await sha256(file)}  ${basename(file)}\n`))).join('');
  const manifestPath = join(directory, 'SHA256SUMS');
  await writeFile(manifestPath, manifest);
  const signed = [manifestPath, ...files.filter((file) => LINUX.test(file))];
  for (const file of signed) {
    await run('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase-fd', '3', '--local-user', fingerprint, '--armor', '--detach-sign', '--output', `${file}.asc`, '--', file], { passphrase, env });
    await run('gpg', ['--batch', '--verify', `${file}.asc`, file], { env });
  }
  return { fingerprint, artifacts: files.length, detachedSignatures: signed.length, rpmEmbeddedSignatures: rpmSign ? files.filter((file) => file.endsWith('.rpm')).length : 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let artifactsDirectory, rpmSign = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--artifacts' && args[index + 1]) artifactsDirectory = args[++index];
    else if (args[index] === '--rpm-sign') rpmSign = true;
    else throw new Error('Usage: sign-release.mjs --artifacts <directory> [--rpm-sign]');
  }
  if (!artifactsDirectory) throw new Error('Usage: sign-release.mjs --artifacts <directory> [--rpm-sign]');
  signRelease({ artifactsDirectory, rpmSign }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
