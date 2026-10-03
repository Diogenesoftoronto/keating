// Run on the owner's computer. The keyring password is used only as local
// osslsigncode stdin; only signed public PE files and public receipts upload.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { assertActiveRelayRun, assertRelayArtifact, assertRelayRelease, assertRelayRequest } from './windows-signing-relay.mjs';
import { inspectBuildSource } from './windows-preview-build.mjs';
import { assertPreviewCertificate, assertVerifiedSelfSignedOutput } from './windows-selfsigned.mjs';

const ghRepo = 'Diogenesoftoronto/keating';
const repo = resolve(import.meta.dirname, '../..');
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => index % 2 ? pairs : [...pairs, [value, args[index + 1]]], []));
const runId = options['--run-id'];
const releaseTag = options['--release-tag'];
const tool = options['--tool'];
const stateDirectory = options['--state-dir'];
if (!/^\d+$/.test(runId) || !tool || !stateDirectory) throw new Error('Use --run-id <id> --release-tag <tag> --tool <osslsigncode> --state-dir <private-local-directory>');

function run(command, args, input) {
  try { return execFileSync(command, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 10 * 1024 * 1024 }); }
  catch { throw new Error(`Local signing ${basename(command)} operation failed; private subprocess output suppressed`); }
}
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const api = path => JSON.parse(run('gh', ['api', `repos/${ghRepo}/${path}`]));
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const publicCertificate = join(repo, 'desktop/signing/windows-selfsigned-public.pem');
const certificateSHA256 = readFileSync(join(repo, 'desktop/signing/windows-selfsigned-fingerprint.txt'), 'utf8').trim();
assertPreviewCertificate(readFileSync(publicCertificate), certificateSHA256);
const source = inspectBuildSource(repo, releaseTag);
if (!run(tool, ['--version']).includes('osslsigncode 2.10')) throw new Error('Pinned local osslsigncode 2.10 required');
const initialRelease = api(`releases/tags/${releaseTag}`);
const workflow = api(`actions/runs/${runId}`);
const expected = { ...source, runId, runAttempt: String(workflow.run_attempt), certificateSHA256, releaseId: initialRelease.id };
assertRelayRelease(initialRelease, expected);
if (api(`commits/${releaseTag}`).sha !== source.sourceCommit) throw new Error('Remote source tag differs from local checkout');
if (workflow.head_sha !== source.sourceCommit || workflow.event !== 'workflow_dispatch'
    || !/^\.github\/workflows\/windows-local-signing-release\.yml(?:@|$)/.test(workflow.path)) {
  throw new Error('Only the reviewed native Windows release run may request signatures');
}
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
const stateStat = lstatSync(stateDirectory);
if (!stateStat.isDirectory() || stateStat.uid !== process.getuid() || stateStat.mode & 0o077) throw new Error('Local signing state directory must be private and owner-controlled');
const pfx = join(homedir(), '.local/share/keating-signing/windows-selfsigned/keating-windows-selfsigned.pfx');
const pfxStat = lstatSync(pfx);
if (!pfxStat.isFile() || pfxStat.uid !== process.getuid() || pfxStat.mode & 0o077) throw new Error('Private local PFX permissions are invalid');
let password;
const records = [];
const completed = new Set();
const reportPath = join(stateDirectory, 'local-signing-report.json');
if (existsSync(reportPath)) {
  const previous = JSON.parse(readFileSync(reportPath, 'utf8'));
  for (const key of ['sourceCommit', 'releaseTag', 'runId', 'runAttempt', 'certificateSHA256', 'releaseId']) {
    if (previous[key] !== expected[key]) throw new Error('Existing local signing report belongs to another session');
  }
  for (const record of previous.records) {
    assertRelayRequest(record, expected);
    records.push(record);
    completed.add(record.requestId);
  }
}
const deadline = Date.now() + 90 * 60 * 1000;
while (Date.now() < deadline) {
  const release = api(`releases/${expected.releaseId}`);
  assertRelayRelease(release, expected);
  const runState = api(`actions/runs/${runId}`);
  if (runState.head_sha !== source.sourceCommit || api(`commits/${releaseTag}`).sha !== source.sourceCommit) throw new Error('Source changed during the signing exchange');
  if (runState.status === 'completed') {
    if (runState.conclusion !== 'success') throw new Error(`Native Windows workflow concluded ${runState.conclusion}`);
    console.log(`Native Windows workflow succeeded; ${records.length} local signatures. Private key and password remained local.`);
    password?.fill(0);
    process.exit(0);
  }
  if (runState.status === 'queued') { await pause(5000); continue; }
  assertActiveRelayRun(runState, expected);
  const artifactPages = JSON.parse(run('gh', ['api', `repos/${ghRepo}/actions/runs/${runId}/artifacts?per_page=100`, '--paginate', '--slurp']));
  const requests = artifactPages.flatMap(page => page.artifacts).filter(artifact => /^relay-[0-9a-f-]{36}$/.test(artifact.name));
  for (const artifact of requests) {
    const requestId = artifact.name.slice(6);
    if (completed.has(requestId)) continue;
    const createdAt = Date.parse(artifact.created_at);
    const startedAt = Date.parse(runState.run_started_at);
    if (!Number.isFinite(createdAt) || !Number.isFinite(startedAt)) throw new Error('Artifact/run attempt timestamps are unavailable');
    if (createdAt < startedAt) continue;
    assertRelayArtifact(artifact, expected);
    const temporary = mkdtempSync(join(stateDirectory, `${requestId}-`));
    const archive = join(temporary, 'request.zip');
    const descriptor = openSync(archive, 'wx', 0o600);
    try {
      execFileSync('gh', ['api', `repos/${ghRepo}/actions/artifacts/${artifact.id}/zip`], { stdio: ['ignore', descriptor, 'pipe'], timeout: 180000 });
    } catch { throw new Error('Run-scoped signing artifact download failed'); }
    finally { closeSync(descriptor); }
    if (`sha256:${sha256(archive)}` !== artifact.digest) throw new Error('Signing artifact ZIP digest mismatch');
    // Accept exactly two flat entries. Do not extract arbitrary ZIP paths or
    // links into the owner filesystem, even from an authenticated workflow.
    run('python3', ['-c', [
      'import pathlib, shutil, stat, sys, zipfile',
      'archive, destination, request_id = sys.argv[1:]',
      'names = [f"relay-{request_id}.request.json", f"relay-{request_id}.unsigned.exe"]',
      'with zipfile.ZipFile(archive) as z:',
      ' assert len(z.infolist()) == 2 and set(z.namelist()) == set(names)',
      ' for name in names:',
      '  info = z.getinfo(name)',
      '  assert not stat.S_ISLNK(info.external_attr >> 16)',
      '  assert 0 < info.file_size <= (16384 if name.endswith(".json") else 1024 ** 3)',
      '  with z.open(info) as source, open(pathlib.Path(destination) / name, "xb") as output:',
      '   shutil.copyfileobj(source, output)',
    ].join('\n'), archive, temporary, requestId]);
    const request = assertRelayRequest(JSON.parse(readFileSync(join(temporary, `relay-${requestId}.request.json`), 'utf8')), expected);
    if (request.requestId !== requestId) throw new Error('Request identifier differs from asset');
    const unsignedName = `relay-${requestId}.unsigned.exe`;
    const unsigned = join(temporary, unsignedName);
    if (statSync(unsigned).size !== request.size || sha256(unsigned) !== request.unsignedSHA256) throw new Error('Unsigned binary SHA256 mismatch');
    const beforeData = join(temporary, 'before.der');
    run(tool, ['extract-data', '-h', 'sha256', '-in', unsigned, '-out', beforeData]);
    if (sha256(beforeData) !== request.authenticodeDataSHA256) throw new Error('Request Authenticode payload mismatch');
    assertActiveRelayRun(api(`actions/runs/${runId}`), expected);
    if (!password) {
      const lookup = spawnSync('secret-tool', ['lookup', 'application', 'keating', 'purpose', 'windows-selfsigned-code-signing'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      if (lookup.error || lookup.status !== 0 || !lookup.stdout?.length) throw new Error('Existing OS-keyring password is unavailable');
      password = lookup.stdout;
    }
    const signed = join(temporary, `relay-${requestId}.signed.exe`);
    run(tool, ['sign', '-pkcs12', pfx, '-readpass', '-', '-h', 'sha256', '-n', 'Keating Self-Signed Preview',
      '-i', 'https://keating.help', '-ts', 'http://timestamp.digicert.com', '-in', unsigned, '-out', signed], password);
    const afterData = join(temporary, 'after.der');
    run(tool, ['extract-data', '-h', 'sha256', '-in', signed, '-out', afterData]);
    if (sha256(afterData) !== request.authenticodeDataSHA256) throw new Error('Local signing changed the PE payload');
    const output = run(tool, ['verify', '-CAfile', publicCertificate, '-TSA-CAfile', '/etc/ssl/certs/ca-certificates.crt',
      '-require-leaf-hash', `sha256:${certificateSHA256}`, '-index', '0', '-in', signed]);
    const proof = assertVerifiedSelfSignedOutput(output, 0);
    const response = { ...request, signedSHA256: sha256(signed), timestampVerified: proof.timestampVerified, signatureVerified: proof.signatureVerified };
    const responsePath = join(temporary, `relay-${requestId}.response.json`);
    writeFileSync(responsePath, JSON.stringify(response), { mode: 0o600 });
    // Only these two explicit public files may leave the owner computer.
    assertActiveRelayRun(api(`actions/runs/${runId}`), expected);
    assertRelayRelease(api(`releases/${expected.releaseId}`), expected);
    run('gh', ['release', 'upload', releaseTag, signed, '--repo', ghRepo]);
    run('gh', ['release', 'upload', releaseTag, responsePath, '--repo', ghRepo]);
    completed.add(requestId);
    records.push({ ...response, artifactId: artifact.id, artifactDigest: artifact.digest, integrity: proof });
    writeFileSync(reportPath, JSON.stringify({ ...expected, privateKeyUploaded: false, passwordUploaded: false, records }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Locally signed and verified: ${request.file}`);
    rmSync(temporary, { recursive: true, force: true });
  }
  await pause(5000);
}
password?.fill(0);
throw new Error('Local signing session timed out');
