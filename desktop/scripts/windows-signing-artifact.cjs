// Wire protocol verified against the official @actions/artifact 2.3.2 package:
// internal/shared/util, internal/shared/artifact-twirp-client, upload/upload-artifact,
// generated/results/api/v1/artifact.twirp-client and google/protobuf/wrappers.
// https://registry.npmjs.org/@actions/artifact/-/artifact-2.3.2.tgz
// SHA512: uX2Mr5KEPcwnzqa0Og9wOTEKIae6C/yx9P/m8bIglzCS5nZDkcQC/zRWjjoEsyVecL6oQpBx5BuqQj/yuVm0gw==
// Only public signing-request ZIPs belong here. Runtime authorization stays in
// memory and goes only to the allowlisted Actions Results service, never Azure.
const { createHash } = require('node:crypto');
const { lstat, open } = require('node:fs/promises');

const SERVICE = 'github.actions.results.api.v1.ArtifactService';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARCHIVE_BYTES = 1024 ** 3 + 16 * 1024 ** 2;

function checkedUrl(value, blob) {
  const url = new URL(value);
  const hostAllowed = blob
    ? /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname)
    : /^(?:[a-z0-9-]+\.)+actions\.githubusercontent\.com$/.test(url.hostname);
  if (!hostAllowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      (blob ? !url.searchParams.get('sig') || url.searchParams.has('comp') || url.pathname === '/' : url.search)) {
    throw new Error('Invalid artifact service address');
  }
  return url;
}

function runtimeIdentity(token) {
  if (typeof token !== 'string' || token.length > 20000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Invalid artifact runtime identity');
  }
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const scopes = typeof claims.scp === 'string' ? claims.scp.split(/\s+/).filter(scope => scope.startsWith('Actions.Results:')) : [];
  if (scopes.length !== 1 || (claims.exp !== undefined && (typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000))) {
    throw new Error('Invalid artifact runtime identity');
  }
  const parts = scopes[0].split(':');
  if (parts.length !== 3 || !UUID.test(parts[1]) || !UUID.test(parts[2])) throw new Error('Invalid artifact runtime identity');
  // The backend verifies the bearer JWT signature and its run/job scope. Never
  // accept caller-supplied backend IDs or substitute a shared GH_TOKEN here.
  return { workflow_run_backend_id: parts[1], workflow_job_run_backend_id: parts[2] };
}

async function uploadSigningRequest({ archivePath, name }, { fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  try {
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(name) || typeof archivePath !== 'string' ||
        typeof fetchImpl !== 'function') throw new Error('Invalid signing request');
    const token = env.ACTIONS_RUNTIME_TOKEN;
    const identity = runtimeIdentity(token);
    const resultsUrl = checkedUrl(env.ACTIONS_RESULTS_URL, false);
    const before = await lstat(archivePath);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 22 || before.size > MAX_ARCHIVE_BYTES) throw new Error('Invalid archive');
    const handle = await open(archivePath, 'r');
    let archive;
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size) throw new Error('Archive changed');
      // One immutable buffer supplies both the digest and the exact upload body.
      archive = await handle.readFile();
    } finally { await handle.close(); }
    if (archive.length !== before.size || archive.length > MAX_ARCHIVE_BYTES || archive.readUInt32LE(0) !== 0x04034b50) {
      throw new Error('Invalid archive');
    }
    const digest = createHash('sha256').update(archive).digest('hex');
    const rpc = async (method, body) => {
      const response = await fetchImpl(new URL(`/twirp/${SERVICE}/${method}`, resultsUrl), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (response.status !== 200) throw new Error('Artifact service rejected request');
      const data = await response.json();
      if (!data || data.ok !== true) throw new Error('Artifact service rejected request');
      return data;
    };
    const created = await rpc('CreateArtifact', { ...identity, name, version: 4 });
    const uploadUrl = checkedUrl(created.signed_upload_url, true);
    // Azure Put Blob: https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob
    const uploaded = await fetchImpl(uploadUrl, {
      method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(600000),
      headers: { 'Content-Type': 'application/zip', 'Content-Length': String(archive.length),
        'Content-MD5': createHash('md5').update(archive).digest('base64'), 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2023-11-03' },
      body: archive,
    });
    if (uploaded.status !== 201) throw new Error('Artifact storage rejected upload');
    const finalized = await rpc('FinalizeArtifact', { ...identity, name, size: String(archive.length), hash: `sha256:${digest}` });
    if (typeof finalized.artifact_id !== 'string' || !/^[1-9][0-9]*$/.test(finalized.artifact_id)) throw new Error('Invalid artifact ID');
    const id = Number(finalized.artifact_id);
    if (!Number.isSafeInteger(id)) throw new Error('Invalid artifact ID');
    return { id, name, size: archive.length, digest };
  } catch {
    // Never include API bodies, URL SAS parameters, auth headers, nested causes,
    // fetch errors or the runtime JWT in an error or log.
    throw new Error('Signing request artifact upload failed');
  }
}

module.exports = { uploadSigningRequest };
