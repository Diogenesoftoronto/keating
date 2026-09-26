import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { makeStagingSnapshot, stagingSourcePath } from "../scripts/staging.js";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "keating-snapshot-test-"));
  temporary.push(base);
  const root = join(base, "checkout");
  mkdirSync(root);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const write = (path: string, text: string) => {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text);
  };
  git("init", "-b", "feature/current-work");
  git("config", "user.name", "Staging Test");
  git("config", "user.email", "staging@example.test");
  write(".gitignore", "web/.cache/\nweb/ignored-secret.txt\nweb/node_modules/\nweb/dist/\n");
  write("Dockerfile.web", "FROM scratch\n");
  write("web/src/tracked.ts", "export const state = 'committed';\n");
  write("web/src/deleted.ts", "export const removed = true;\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  return { base, root, write, git, snapshot: (name: string) => join(base, name) };
}

describe("staging upload snapshots", () => {
  test("includes committed and current app work while preserving branch, index, and deletions", async () => {
    const { root, write, git, snapshot } = fixture();
    write("web/src/tracked.ts", "export const state = 'edited';\n");
    write("web/src/untracked.ts", "export const newFeature = true;\n");
    write("shared/new-domain.ts", "export const domain = 'new';\n");
    write("docs/private-notes.md", "Not part of the app upload.\n");
    write("web/artwork/stop-motion-v1/raw/frame.png", "authoring original\n");
    write("web/public/brand/stop-motion-v1/frame.avif", "runtime frame\n");
    rmSync(join(root, "web/src/deleted.ts"));
    const before = git("status", "--porcelain");
    const destination = snapshot("upload");
    const receipt = await makeStagingSnapshot(root, destination);
    expect(receipt).toMatchObject({ sha: git("rev-parse", "HEAD"), branch: "feature/current-work", dirty: true, promotionEligible: false });
    expect(readFileSync(join(destination, "web/src/tracked.ts"), "utf8")).toContain("edited");
    expect(existsSync(join(destination, "web/src/untracked.ts"))).toBe(true);
    expect(existsSync(join(destination, "shared/new-domain.ts"))).toBe(true);
    expect(existsSync(join(destination, "web/src/deleted.ts"))).toBe(false);
    expect(existsSync(join(destination, "docs/private-notes.md"))).toBe(false);
    expect(existsSync(join(destination, "web/artwork/stop-motion-v1/raw/frame.png"))).toBe(false);
    expect(existsSync(join(destination, "web/public/brand/stop-motion-v1/frame.avif"))).toBe(true);
    expect(JSON.parse(readFileSync(join(destination, "web/public/staging-build.json"), "utf8"))).toEqual(receipt);
    expect(git("status", "--porcelain")).toBe(before);
    expect(git("branch", "--show-current")).toBe("feature/current-work");
  });

  test("excludes ignored credentials and generated files, including force-tracked sensitive paths", async () => {
    const { root, write, git, snapshot } = fixture();
    const excluded = ["web/.env", "web/.env.local", "web/server/.env.production", "web/server/private.pem", "web/server/private.KEY", "web/server/account.sqlite", "web/node_modules/dependency.js", "web/dist/index.html", "web/.output/server.js", "web/styled-system/generated.ts", "web/.keating/session.json"];
    for (const path of excluded) write(path, "NEVER UPLOAD\n");
    git("add", "--force", ...excluded);
    write("web/.cache/secret.json", "ignored private state\n");
    write("web/ignored-secret.txt", "ignored credential\n");
    const destination = snapshot("upload");
    await makeStagingSnapshot(root, destination);
    for (const path of [...excluded, "web/.cache/secret.json", "web/ignored-secret.txt"]) expect(existsSync(join(destination, path)), path).toBe(false);
    expect(existsSync(join(destination, "web/src/tracked.ts"))).toBe(true);
  });

  test("fingerprint is stable across snapshots and ignores files outside the upload", async () => {
    const { root, write, snapshot } = fixture();
    const first = await makeStagingSnapshot(root, snapshot("first"));
    write("docs/notes.md", "unrelated dirty work\n");
    write("web/ignored-secret.txt", "ignored local work\n");
    const second = await makeStagingSnapshot(root, snapshot("second"));
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.dirty).toBe(false);
    expect(second.dirty).toBe(true);
    write("web/src/tracked.ts", "changed app content\n");
    const changed = await makeStagingSnapshot(root, snapshot("changed"));
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    chmodSync(join(root, "web/src/tracked.ts"), 0o755);
    const executable = await makeStagingSnapshot(root, snapshot("executable"));
    expect(executable.fingerprint).not.toBe(changed.fingerprint);
    rmSync(join(root, "web/src/tracked.ts"));
    const deleted = await makeStagingSnapshot(root, snapshot("deleted"));
    expect(deleted.fingerprint).not.toBe(executable.fingerprint);
  });

  test("refuses a symlink file instead of uploading its target", async () => {
    const { base, root, snapshot } = fixture();
    const secret = join(base, "outside-secret.ts");
    writeFileSync(secret, "outside credential\n");
    symlinkSync(secret, join(root, "web/src/linked.ts"));
    await expect(makeStagingSnapshot(root, snapshot("upload"))).rejects.toThrow(/symlink/i);
  });

  test("refuses a symlink ancestor of a tracked source file", async () => {
    const { base, root, snapshot } = fixture();
    const external = join(base, "outside-sources");
    mkdirSync(external);
    writeFileSync(join(external, "tracked.ts"), "outside credential disguised as source\n");
    rmSync(join(root, "web/src"), { recursive: true });
    symlinkSync(external, join(root, "web/src"));
    await expect(makeStagingSnapshot(root, snapshot("upload"))).rejects.toThrow(/symlink|outside|contain/i);
  });

  test("source allowlist covers Docker inputs and rejects traversal", () => {
    for (const path of ["Dockerfile.web", "railway.toml", ".dockerignore", "web/package.json", "shared/policy.ts", "packages/learner-contracts/src/index.ts", "packages/agent-runtime/package.json", "packages/p2p-core/src/index.ts", "spikes/flue-host/src/index.ts", "spikes/flue-host/bun.lock", "desktop/src/navigation.ts"]) expect(stagingSourcePath(path), path).toBe(true);
    for (const path of ["web/../secret.ts", "web/.env.local", "web/node_modules/file.js", "src/cli/main.ts", "desktop/src/secret.ts", "spikes/flue-host/.private", "/web/src/absolute.ts"]) expect(stagingSourcePath(path), path).toBe(false);
  });
});
