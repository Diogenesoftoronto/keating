#!/usr/bin/env bun
/** Upload a bounded snapshot of this checkout, including uncommitted app work. */
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const STAGING_PROJECT = "314d5558-957b-4e19-9ae0-bc08c8b5cf78";
export const STAGING_SERVICE = "a3937c22-5298-4079-aa29-e009e7efbe61";
export const STAGING_ENVIRONMENT = "65227e01-d875-4707-8467-e27165c820b8";
const PROMOTION_SERVICE = "a1fef6d6-698e-4e0b-8647-452ac4399614";
const PRODUCTION_ENVIRONMENT = "343e403a-fac6-4a18-a413-d3bfd5f758f1";

// Match the Dockerfile's source inputs. Never include local credentials or
// generated state, even if someone accidentally tracked them in Git.
export function stagingSourcePath(path: string): boolean {
  // Original artwork is only used by offline asset-generation scripts. The
  // prepared runtime images already live in web/public; shipping both exceeded
  // Railway's archive upload limit as the media library grew.
  if (path.startsWith("web/artwork/")) return false;
  if (path.split("/").some(part => part === ".." || part.startsWith(".env") || ["node_modules", "dist", ".output", ".git", ".keating", "styled-system"].includes(part))) return false;
  if (/\.(?:pem|key|p12|pfx|log|sqlite|db)$/i.test(path)) return false;
  return ["Dockerfile.web", "railway.toml", ".dockerignore", "desktop/src/navigation.ts"].includes(path)
    || ["web/", "shared/", "packages/learner-contracts/", "packages/agent-runtime/", "packages/p2p-core/", "spikes/flue-host/src/"].some(prefix => path.startsWith(prefix))
    || ["spikes/flue-host/package.json", "spikes/flue-host/bun.lock"].includes(path);
}

async function run(args: string[], cwd = process.cwd()): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit !== 0) {
    const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    throw new Error(`${args.slice(0, 3).join(" ")} failed (${exit}): ${details.slice(-6000) || "No output from command."}`);
  }
  return stdout;
}

export async function makeStagingSnapshot(root: string, destination: string) {
  const branch = (await run(["git", "branch", "--show-current"], root)).trim() || "detached";
  const sha = (await run(["git", "rev-parse", "HEAD"], root)).trim();
  let dirty = (await run(["git", "status", "--porcelain"], root)).length > 0;
  const files = [...new Set((await run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], root)).split("\0").filter(stagingSourcePath))].sort();
  const hash = createHash("sha256").update(sha).update(branch);
  let count = 0;
  for (const file of files) {
    const source = join(root, file);
    let stat;
    try {
      let ancestor = root;
      for (const part of file.split("/")) {
        ancestor = join(ancestor, part);
        stat = await lstat(ancestor);
        if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in staging sources: ${file}`);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in staging sources: ${file}`);
    if (!stat.isFile()) continue;
    const content = await readFile(source);
    hash.update(file).update("\0").update(String(stat.mode & 0o777)).update("\0").update(content).update("\0");
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    await chmod(target, stat.mode & 0o777);
    count++;
  }
  // A session may keep editing while the snapshot is copied. Such a preview
  // remains usable, but must not become an eligible committed release.
  dirty = dirty || (await run(["git", "status", "--porcelain"], root)).length > 0;
  if ((await run(["git", "rev-parse", "HEAD"], root)).trim() !== sha) throw new Error("HEAD changed during the snapshot; retry staging from the current commit.");
  const fingerprint = hash.digest("hex");
  const receipt = { sha, branch, dirty, fingerprint, files: count, createdAt: new Date().toISOString(), promotionEligible: !dirty };
  await mkdir(join(destination, "web/public"), { recursive: true });
  await writeFile(join(destination, "web/public/staging-build.json"), JSON.stringify(receipt));
  return receipt;
}

async function stagingUrl(): Promise<string> {
  const status = JSON.parse(await run(["railway", "status", "--json"]));
  if (status.id !== STAGING_PROJECT) throw new Error("Link this checkout to the Keating Railway project before uploading staging.");
  const env = status.environments.edges.find((edge: any) => edge.node.id === STAGING_ENVIRONMENT)?.node;
  const service = env?.serviceInstances.edges.find((edge: any) => edge.node.serviceId === STAGING_SERVICE)?.node;
  const domain = service?.domains.serviceDomains[0]?.domain;
  if (!domain) throw new Error("Keating staging has no Railway-generated domain.");
  return `https://${domain}`;
}

async function liveReceipt(url: string): Promise<any> {
  try {
    const response = await fetch(`${url}/staging-build.json?t=${Date.now()}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function publishCandidate(root: string, snapshot: string, receipt: Awaited<ReturnType<typeof makeStagingSnapshot>> & { deploymentId: string; url: string }) {
  await mkdir(join(root, ".keating"), { recursive: true });
  const receiptPath = join(root, ".keating/staging-last.json");
  let previous;
  try { previous = JSON.parse(await readFile(receiptPath, "utf8")); } catch {}
  const verifiedAt = previous?.deploymentId === receipt.deploymentId && Number.isFinite(Date.parse(previous.verifiedAt)) ? previous.verifiedAt : new Date().toISOString();
  await writeFile(receiptPath, JSON.stringify({ ...receipt, verifiedAt }, null, 2));
  const bundle = await mkdtemp(join(tmpdir(), "keating-promotion-bundle-"));
  try {
    await mkdir(join(bundle, "candidate"));
    await mkdir(join(bundle, "scripts"));
    await writeFile(join(bundle, "scripts/promote-staging.ts"), await readFile(join(root, "scripts/promote-staging.ts")));
    await writeFile(join(bundle, "Dockerfile"), await readFile(join(root, "scripts/staging-scheduler/Dockerfile")));
    await writeFile(join(bundle, "railway.toml"), await readFile(join(root, "scripts/staging-scheduler/railway.toml")));
    const archive = join(bundle, "candidate/source.tar.gz");
    await run(["tar", "-czf", archive, "-C", snapshot, "."]);
    const archiveSha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
    const candidate = { ...receipt, verifiedAt, archivePath: "/candidate/source.tar.gz", archiveSha256 };
    await writeFile(join(bundle, "candidate/candidate.json"), JSON.stringify(candidate, null, 2));
    // Local commands use the same immutable archive and receipt as Railway.
    const local = join(root, ".keating/promotion-candidate");
    await mkdir(local, { recursive: true });
    await writeFile(join(local, "source.tar.gz"), await readFile(archive));
    await writeFile(join(local, "candidate.json"), JSON.stringify({ ...candidate, archivePath: join(local, "source.tar.gz") }, null, 2));
    console.log("Updating Railway's hourly promotion candidate (GitHub is not used).");
    const result = await run(["railway", "up", bundle, "--path-as-root", "--project", STAGING_PROJECT, "--service", PROMOTION_SERVICE, "--environment", PRODUCTION_ENVIRONMENT, "--detach", "--json", "--message", `keating-promotion-candidate:${receipt.fingerprint}`], root);
    console.log(result.trim());
    console.log(receipt.dirty ? "Uncommitted preview: automatic production promotion is disabled for this candidate." : "Clean candidate: Railway checks its deployment and health hourly and waits eight hours before promotion.");
  } finally { await rm(bundle, { recursive: true, force: true }); }
}

async function main() {
  const action = process.argv[2] ?? "deploy";
  if (!["deploy", "status", "snapshot"].includes(action)) throw new Error("Usage: bun scripts/staging.ts [deploy|status|snapshot]");
  if (action === "deploy" && ["0", "false"].includes(process.env.KEATING_STAGING_ENABLED ?? "")) { console.log("Staging upload disabled by KEATING_STAGING_ENABLED."); return; }
  const root = (await run(["git", "rev-parse", "--show-toplevel"])).trim();
  if (action === "status") { const url = await stagingUrl(); console.log(JSON.stringify({ url: `${url}/chat`, build: await liveReceipt(url) }, null, 2)); return; }
  const snapshot = await mkdtemp(join(tmpdir(), "keating-staging-"));
  try {
    const receipt = await makeStagingSnapshot(root, snapshot);
    if (action === "snapshot") { console.log(JSON.stringify({ ...receipt, path: snapshot }, null, 2)); return; }
    const url = await stagingUrl();
    const live = await liveReceipt(url);
    if (live?.fingerprint === receipt.fingerprint && live.dirty === receipt.dirty) {
      const deployments = JSON.parse(await run(["railway", "deployment", "list", "--service", STAGING_SERVICE, "--environment", STAGING_ENVIRONMENT, "--limit", "1", "--json"], root));
      const latest = deployments[0];
      if (latest?.status === "SUCCESS" && latest.meta?.cliMessage === `keating-staging:${receipt.fingerprint}`) {
        console.log(`Staging already matches ${receipt.branch} (${receipt.sha.slice(0, 8)}): ${url}/chat`);
        // Preserve the original age and the exact build marker in the archive.
        await writeFile(join(snapshot, "web/public/staging-build.json"), JSON.stringify(live));
        await publishCandidate(root, snapshot, { ...receipt, createdAt: live.createdAt, deploymentId: latest.id, url });
        return;
      }
    }
    console.log(`Uploading ${receipt.files} app files from ${receipt.branch} (${receipt.sha.slice(0, 8)}${receipt.dirty ? " + uncommitted work" : ""}).`);
    const message = `keating-staging:${receipt.fingerprint}`;
    const output = await run(["railway", "up", snapshot, "--path-as-root", "--project", STAGING_PROJECT, "--service", STAGING_SERVICE, "--environment", STAGING_ENVIRONMENT, "--detach", "--json", "--message", message], root);
    console.log(output.trim());
    const upload = output.split("\n").map(line => { try { return JSON.parse(line); } catch { return null; } }).find(item => item?.deploymentId);
    if (!upload?.deploymentId) throw new Error("Railway upload returned no deployment ID; inspect staging before retrying.");
    const deadline = Date.now() + 30 * 60 * 1000;
    let lastStatus = "";
    while (Date.now() < deadline) {
      const deployments = JSON.parse(await run(["railway", "deployment", "list", "--service", STAGING_SERVICE, "--environment", STAGING_ENVIRONMENT, "--limit", "10", "--json"], root));
      const deployment = deployments.find((item: any) => item.id === upload.deploymentId);
      if (deployment && deployment.status !== lastStatus) { console.log(`Staging ${deployment.id}: ${deployment.status}`); lastStatus = deployment.status; }
      if (deployment && ["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(deployment.status)) throw new Error(`Staging deployment ${deployment.status}: ${deployment.id}`);
      if (deployment?.status === "SUCCESS" && (await liveReceipt(url))?.fingerprint === receipt.fingerprint) {
        const chat = await fetch(`${url}/chat`, { signal: AbortSignal.timeout(15000) });
        if (!chat.ok) throw new Error(`Staging chat returned HTTP ${chat.status}`);
        console.log(`Ready: ${url}/chat\nIncludes this checkout's app changes.`);
        await publishCandidate(root, snapshot, { ...receipt, deploymentId: deployment.id, url });
        return;
      }
      await Bun.sleep(10000);
    }
    throw new Error("Timed out waiting for this staging snapshot to become healthy.");
  } finally {
    if (action !== "snapshot") await rm(snapshot, { recursive: true, force: true });
  }
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
