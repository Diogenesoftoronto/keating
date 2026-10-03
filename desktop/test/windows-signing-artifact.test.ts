import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { uploadSigningRequest } = require('../scripts/windows-signing-artifact.cjs');

const run = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const jwt = (claims: unknown) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.testsignature`;
const token = jwt({ scp: `Other.Scope Actions.Results:${run}:${job}` });
const resultsUrl = 'https://results-receiver.actions.githubusercontent.com/';
const blobUrl = 'https://artifactstore123.blob.core.windows.net/container/archive.zip?sig=private-test-sas';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'keating-artifact-test-'));
  directories.push(directory);
  const archivePath = join(directory, 'request.zip');
  const archive = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40), Buffer.from('public PE request')]);
  writeFileSync(archivePath, archive);
  const env = { ACTIONS_RUNTIME_TOKEN: token, ACTIONS_RESULTS_URL: resultsUrl };
  const calls: { url: string; options: any }[] = [];
  const fetch = async (url: URL, options: any) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return Response.json({ ok: true, signed_upload_url: blobUrl });
    if (calls.length === 2) return new Response(null, { status: 201 });
    return Response.json({ ok: true, artifact_id: '12345' });
  };
  return { archivePath, archive, env, calls, fetch, name: 'relay-request-12345-unique' };
}

test('uploads and finalizes ZIP under run/job IDs from the runtime JWT only', async () => {
  const f = fixture();
  const result = await uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch: f.fetch });
  const digest = createHash('sha256').update(f.archive).digest('hex');
  expect(result).toEqual({ id: 12345, name: f.name, size: f.archive.length, digest });
  expect(f.calls[0].url).toBe(`${resultsUrl}twirp/github.actions.results.api.v1.ArtifactService/CreateArtifact`);
  expect(JSON.parse(f.calls[0].options.body)).toEqual({ workflow_run_backend_id: run, workflow_job_run_backend_id: job, name: f.name, version: 4 });
  expect(f.calls[0].options.headers.Authorization).toBe(`Bearer ${token}`);
  expect(f.calls[1].url).toBe(blobUrl);
  expect(f.calls[1].options.method).toBe('PUT');
  expect(f.calls[1].options.body).toEqual(f.archive);
  expect(f.calls[1].options.headers.Authorization).toBeUndefined();
  expect(f.calls[1].options.headers['Content-MD5']).toBe(createHash('md5').update(f.archive).digest('base64'));
  expect(JSON.parse(f.calls[2].options.body)).toEqual({ workflow_run_backend_id: run, workflow_job_run_backend_id: job,
    name: f.name, size: String(f.archive.length), hash: `sha256:${digest}` });
  expect(f.calls[2].url.endsWith('/FinalizeArtifact')).toBe(true);
  for (const call of f.calls) expect(call.options.redirect).toBe('error');
});

test('rejects absent, malformed, expired, duplicate and unscoped JWTs before networking', async () => {
  for (const bad of ['', 'bad', jwt({}), jwt({ scp: 'Actions.Results:outside:job' }),
    jwt({ scp: `Actions.Results:${run}:${job}:extra` }), jwt({ scp: `Actions.Results:${run}:${job} Actions.Results:${run}:${job}` }),
    jwt({ scp: `Actions.Results:${run}:${job}`, exp: 1 })]) {
    const f = fixture();
    await expect(uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, {
      env: { ...f.env, ACTIONS_RUNTIME_TOKEN: bad }, fetch: f.fetch })).rejects.toThrow('Signing request artifact upload failed');
    expect(f.calls).toHaveLength(0);
  }
});

test('rejects Results service URL substitutions before sending the runtime token', async () => {
  for (const url of ['http://results-receiver.actions.githubusercontent.com/', 'https://actions.githubusercontent.com/',
    'https://results-receiver.actions.githubusercontent.com.attacker.test/', 'https://attacker.test/',
    'https://user:password@results-receiver.actions.githubusercontent.com/', 'https://results-receiver.actions.githubusercontent.com:444/',
    `${resultsUrl}?token=bad`, `${resultsUrl}#bad`]) {
    const f = fixture();
    await expect(uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, {
      env: { ...f.env, ACTIONS_RESULTS_URL: url }, fetch: f.fetch })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  }
});

test('rejects unexpected, unsigned and redirecting blob destinations', async () => {
  for (const url of ['https://attacker.test/blob?sig=secret', 'http://artifactstore123.blob.core.windows.net/blob?sig=secret',
    'https://artifactstore123.blob.core.windows.net.attacker.test/blob?sig=secret', 'https://artifactstore123.blob.core.windows.net/blob',
    'https://user@artifactstore123.blob.core.windows.net/blob?sig=secret', `${blobUrl}&comp=block`]) {
    const f = fixture();
    const fetch = async (destination: URL, options: any) => {
      f.calls.push({ url: String(destination), options });
      return Response.json({ ok: true, signed_upload_url: url });
    };
    await expect(uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch })).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  }
});

test('creation, upload and finalization must each succeed before returning an artifact', async () => {
  for (const failedStage of [1, 2, 3]) {
    const f = fixture();
    const fetch = async (url: URL, options: any) => {
      if (f.calls.length + 1 === failedStage) {
        f.calls.push({ url: String(url), options });
        return new Response('sensitive service response', { status: 403 });
      }
      return f.fetch(url, options);
    };
    await expect(uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch })).rejects.toThrow('Signing request artifact upload failed');
    expect(f.calls).toHaveLength(failedStage);
  }
});

test('rejects backend false success flags and malformed artifact IDs', async () => {
  for (const result of [{ ok: false, artifact_id: '123' }, { ok: 'true', artifact_id: '123' }, { ok: true, artifact_id: 123 },
    { ok: true, artifact_id: '0' }, { ok: true, artifact_id: '9007199254740992' }]) {
    const f = fixture();
    const fetch = async (url: URL, options: any) => f.calls.length === 2 ? Response.json(result) : f.fetch(url, options);
    await expect(uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch })).rejects.toThrow();
  }
});

test('does not expose runtime tokens, SAS URLs, response bodies or nested fetch errors', async () => {
  const f = fixture();
  const fetch = async () => { throw new Error(`${token} ${blobUrl} secret-body`); };
  let failure: any;
  try { await uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch }); } catch (error) { failure = error; }
  expect(failure.message).toBe('Signing request artifact upload failed');
  expect(failure.cause).toBeUndefined();
  for (const secret of [token, blobUrl, 'secret-body']) expect(failure.stack).not.toContain(secret);
});

test('redirects and malformed backend JSON cannot advance the upload', async () => {
  for (const response of [new Response(null, { status: 302, headers: { Location: 'https://attacker.test/' } }),
    new Response('not-json', { status: 200 }), Response.json({ ok: false, signed_upload_url: blobUrl })]) {
    const f = fixture();
    const fetch = async (url: URL, options: any) => {
      f.calls.push({ url: String(url), options });
      return response;
    };
    await expect(uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch })).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].options.redirect).toBe('error');
  }
});

test('file changes after creation cannot replace the exact ZIP bytes or finalized digest', async () => {
  const f = fixture();
  const fetch = async (url: URL, options: any) => {
    if (f.calls.length === 0) writeFileSync(f.archivePath, Buffer.from('substituted after creation'));
    return f.fetch(url, options);
  };
  const result = await uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch });
  expect(f.calls[1].options.body).toEqual(f.archive);
  expect(result.digest).toBe(createHash('sha256').update(f.archive).digest('hex'));
  expect(JSON.parse(f.calls[2].options.body).hash).toBe(`sha256:${result.digest}`);
});

test('rejects unsafe artifact names, non-ZIPs and symlinked input before networking', async () => {
  for (const name of ['../request', 'request.zip/slash', 'request\nsecret', '', 'x'.repeat(201)]) {
    const f = fixture();
    await expect(uploadSigningRequest({ archivePath: f.archivePath, name }, { env: f.env, fetch: f.fetch })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  }
  const f = fixture();
  writeFileSync(f.archivePath, Buffer.alloc(64));
  await expect(uploadSigningRequest({ archivePath: f.archivePath, name: f.name }, { env: f.env, fetch: f.fetch })).rejects.toThrow();
  const linked = `${f.archivePath}.link`;
  symlinkSync(f.archivePath, linked);
  await expect(uploadSigningRequest({ archivePath: linked, name: f.name }, { env: f.env, fetch: f.fetch })).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
