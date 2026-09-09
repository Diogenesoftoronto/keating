#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access, chmod, cp, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flatpakRoot = join(desktopRoot, 'flatpak');
const appId = 'help.keating.desktop';
const help = `Build and GPG-sign Keating's stable Flatpak repository from a prebuilt Linux app.

Usage: node desktop/scripts/build-flatpak.mjs --app-dir DIR --repo DIR --arch x86_64|aarch64 --gpg-sign FINGERPRINT [--version VERSION] [--repo-url HTTPS_URL]

Required installed refs for the target arch (Flathub):
  org.freedesktop.Platform//25.08  org.freedesktop.Sdk//25.08
  org.electronjs.Electron2.BaseApp//25.08
Requires flatpak, gpg, and appstreamcli with its compose addon. APPSTREAMCLI may
select an absolute CLI path. GNUPGHOME selects the signing keyring; unlock its key
before running. Private key material is never copied into the output.
--version defaults to desktop/package.json; pass the artifact's actual version
when importing a previously released app. The script does not rebuild Electron.
Default repository URL: https://diogenesoftoronto.github.io/keating/flatpak
Temporary packaging output is under ignored desktop/flatpak/.local.
`;

function command(program, args, capture = false) {
  const result = spawnSync(program, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status ?? result.signal})`);
  return result.stdout;
}
function options(argv) {
  const values = {};
  const names = new Set(['--app-dir', '--repo', '--arch', '--gpg-sign', '--version', '--repo-url']);
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!names.has(name) || !argv[index + 1] || argv[index + 1].startsWith('--') || values[name]) throw new Error(`Invalid argument: ${name}`);
    values[name] = argv[++index];
  }
  for (const name of ['--app-dir', '--repo', '--arch', '--gpg-sign']) if (!values[name]) throw new Error(`Required argument: ${name}`);
  if (!['x86_64', 'aarch64'].includes(values['--arch'])) throw new Error('Arch must be x86_64 or aarch64');
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(values['--gpg-sign'])) throw new Error('Use the complete GPG signing fingerprint');
  return values;
}
async function validateExecutable(path, arch) {
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(20);
    const { bytesRead } = await file.read(bytes, 0, 20, 0);
    if (bytesRead !== 20 || bytes.subarray(0, 4).toString('hex') !== '7f454c46' || bytes[4] !== 2 || bytes[5] !== 1) throw new Error('Expected a 64-bit little-endian Linux ELF executable');
    if (bytes.readUInt16LE(18) !== (arch === 'x86_64' ? 62 : 183)) throw new Error(`Prebuilt executable does not match --arch ${arch}`);
  } finally { await file.close(); }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); return; }
  const args = options(process.argv.slice(2));
  const appDir = resolve(args['--app-dir']);
  const repo = resolve(args['--repo']);
  const arch = args['--arch'];
  const fingerprint = args['--gpg-sign'];
  const version = args['--version'] ?? JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version');
  const repoUrl = new URL(args['--repo-url'] ?? 'https://diogenesoftoronto.github.io/keating/flatpak');
  if (repoUrl.protocol !== 'https:' || repoUrl.username || repoUrl.password || repoUrl.search || repoUrl.hash) throw new Error('Repository URL must be plain HTTPS');
  await validateExecutable(join(appDir, 'keating-desktop'), arch);
  await access(join(appDir, 'resources/app.asar'));
  await access(join(appDir, 'resources/nitro/server/index.mjs'));
  const appstream = process.env.APPSTREAMCLI || 'appstreamcli';
  try { command(appstream, ['compose', '--help'], true); }
  catch { throw new Error('AppStream compose is required. Install the appstream-compose addon or use Nix appstream (APPSTREAMCLI can select its executable).'); }
  const publicKey = command('gpg', ['--batch', '--export', fingerprint], true);
  if (!publicKey?.length) throw new Error('Signing public key not found');
  const signing = [`--gpg-sign=${fingerprint}`, ...(process.env.GNUPGHOME ? [`--gpg-homedir=${resolve(process.env.GNUPGHOME)}`] : [])];
  const configuration = JSON.parse(await readFile(join(flatpakRoot, `${appId}.json`), 'utf8'));
  const local = join(flatpakRoot, '.local');
  await mkdir(local, { recursive: true });
  await mkdir(repo, { recursive: true });
  const stage = await mkdtemp(join(local, `${arch}-`));
  const build = join(stage, 'build');
  try {
    // This only copies installed refs; it never runs a target-architecture shell.
    command('flatpak', ['build-init', `--arch=${arch}`, `--base=${configuration.base}`, `--base-version=${configuration['base-version']}`, build, appId, configuration.sdk, configuration.runtime, configuration['runtime-version']]);
    await cp(appDir, join(build, 'files/keating'), { recursive: true, dereference: true });
    const install = async (source, target, mode = 0o644) => {
      const destination = join(build, 'files', target);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination);
      await chmod(destination, mode);
    };
    await install(join(flatpakRoot, 'keating'), 'bin/keating', 0o755);
    await install(join(flatpakRoot, `${appId}.desktop`), `share/applications/${appId}.desktop`);
    await install(resolve(desktopRoot, '../web/public/favicon-bot.png'), `share/icons/hicolor/64x64/apps/${appId}.png`);
    const metainfo = (await readFile(join(flatpakRoot, `${appId}.metainfo.xml`), 'utf8')).replace('@VERSION@', version).replace('@DATE@', new Date().toISOString().slice(0, 10));
    await mkdir(join(build, 'files/share/metainfo'), { recursive: true });
    await writeFile(join(build, `files/share/metainfo/${appId}.metainfo.xml`), metainfo);
    const files = join(build, 'files');
    const catalogDirectory = join(files, 'share/app-info/xmls');
    // Compose on the host: the directory contains data only, so an aarch64
    // package can receive catalog metadata on an x86_64 release publisher.
    command(appstream, ['compose', '--no-net', '--prefix=/', `--origin=${appId}`,
      `--result-root=${files}`, `--data-dir=${catalogDirectory}`,
      `--icons-dir=${join(files, 'share/app-info/icons/flatpak')}`,
      `--components=${appId}`, files]);
    const catalogs = await readdir(catalogDirectory);
    if (!catalogs.some((name) => name.endsWith('.xml') || name.endsWith('.xml.gz'))) throw new Error('AppStream compose did not produce a software-center catalog');
    command('flatpak', ['build-finish', '--no-inherit-permissions', '--command=keating', ...configuration['finish-args'], build]);
    command('flatpak', ['build-export', `--arch=${arch}`, ...signing, repo, build, 'stable']);
    const keyPath = join(stage, 'keating.gpg');
    await writeFile(keyPath, publicKey);
    command('flatpak', ['build-update-repo', '--title=Keating', '--comment=Keating desktop stable releases', '--homepage=https://keating.help', '--default-branch=stable', `--gpg-import=${keyPath}`, ...signing, repo]);
    const url = repoUrl.href.replace(/\/$/, '');
    const key = publicKey.toString('base64');
    await writeFile(join(repo, 'keating.flatpakrepo'), `[Flatpak Repo]\nTitle=Keating\nComment=Keating desktop stable releases\nUrl=${url}\nHomepage=https://keating.help\nDefaultBranch=stable\nGPGKey=${key}\n`);
    await writeFile(join(repo, `${appId}.flatpakref`), `[Flatpak Ref]\nTitle=Keating\nName=${appId}\nBranch=stable\nIsRuntime=false\nUrl=${url}\nSuggestRemoteName=keating\nRuntimeRepo=https://flathub.org/repo/flathub.flatpakrepo\nGPGKey=${key}\n`);
    console.log(`Signed app/${appId}/${arch}/stable (${version}) and repository metadata in ${repo}`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
