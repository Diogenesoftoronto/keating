#!/usr/bin/env bun
/**
 * Keating media store.
 *
 * Videos, audio and large images live in the `keating-media` Railway bucket instead of git.
 * `media.manifest.json` (committed) maps each repo path to a git blob id; the bytes live at
 * `objects/<blob id>` in the bucket. Paths in the manifest are gitignored via the managed
 * block in `.gitignore`.
 *
 *   bun scripts/media.ts pull [prefix...]     download missing/changed media (all, or under prefixes)
 *   bun scripts/media.ts status [prefix...]   show missing / modified / untracked media
 *   bun scripts/media.ts push <path...>       upload files, add/update them in the manifest + .gitignore
 *   bun scripts/media.ts rm <path...>         drop paths from the manifest (bytes stay in the bucket)
 *   bun scripts/media.ts stage <dir> [out]    copy <dir>'s tracked files + its media to a temp dir for
 *                                             `railway up <out> --path-as-root --no-gitignore`
 *
 * Credentials: KEATING_MEDIA_ENDPOINT, KEATING_MEDIA_BUCKET, KEATING_MEDIA_ACCESS_KEY_ID,
 * KEATING_MEDIA_SECRET_ACCESS_KEY — from the environment, `.env.media` at the repo root, or
 * ~/.config/keating-media/env.
 * Every failure exits non-zero so builds never ship with missing media.
 */
import { S3Client } from "bun";
import { mkdir, cp, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

type Entry = { oid: string; size: number };
type Manifest = { version: 1; bucket: string; objects: string; files: Record<string, Entry> };

const root = findRoot(process.cwd());
const manifestPath = join(root, "media.manifest.json");
const gitignorePath = join(root, ".gitignore");
const BEGIN = "# >>> keating-media: paths stored in the keating-media bucket (managed by scripts/media.ts)";
const END = "# <<< keating-media";

function findRoot(start: string): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "media.manifest.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error("media.manifest.json not found in this directory or any parent");
    dir = up;
  }
}

function loadEnvFile() {
  const config = process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config");
  for (const file of [join(root, ".env.media"), join(config, "keating-media", "env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

function client(): S3Client {
  loadEnvFile();
  const need = ["KEATING_MEDIA_ENDPOINT", "KEATING_MEDIA_BUCKET", "KEATING_MEDIA_ACCESS_KEY_ID", "KEATING_MEDIA_SECRET_ACCESS_KEY"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing ${missing.join(", ")} (set them, or put them in .env.media at the repo root or ~/.config/keating-media/env)`);
  // Railway buckets are virtual-host style: Bun expects the bucket in the endpoint hostname.
  const endpoint = new URL(process.env.KEATING_MEDIA_ENDPOINT!);
  const bucket = process.env.KEATING_MEDIA_BUCKET!;
  if (!endpoint.hostname.startsWith(bucket + ".")) endpoint.hostname = `${bucket}.${endpoint.hostname}`;
  return new S3Client({
    endpoint: endpoint.origin,
    bucket,
    accessKeyId: process.env.KEATING_MEDIA_ACCESS_KEY_ID,
    secretAccessKey: process.env.KEATING_MEDIA_SECRET_ACCESS_KEY,
    virtualHostedStyle: true,
  });
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await Bun.file(manifestPath).text());
}

async function writeManifest(m: Manifest) {
  const files = Object.fromEntries(Object.entries(m.files).sort(([a], [b]) => (a < b ? -1 : 1)));
  await Bun.write(manifestPath, JSON.stringify({ ...m, files }, null, 1) + "\n");
  await writeGitignore(Object.keys(files));
}

/**
 * Each media path is ignored from the deepest existing .gitignore above it, because a nested
 * .gitignore (often with `!` re-includes) outranks the root one. Blocks go at the end of each
 * file so they also win over earlier negations in that file.
 */
async function writeGitignore(paths: string[]) {
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    let dir = dirname(p);
    while (dir !== "." && !existsSync(join(root, dir, ".gitignore"))) dir = dirname(dir);
    const base = dir === "." ? "" : dir + "/";
    groups.set(base, [...(groups.get(base) ?? []), p.slice(base.length)]);
  }
  const listed = Bun.spawnSync(["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.gitignore", ".gitignore"]);
  const existing = listed.stdout.toString().split("\0").filter(Boolean);
  const re = new RegExp(`\\n*${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?`);
  for (const file of new Set([gitignorePath, ...existing.map((f) => join(root, f)), ...[...groups.keys()].map((b) => join(root, b, ".gitignore"))])) {
    const base = relative(root, dirname(file)).replace(/\\/g, "/");
    const entries = groups.get(base ? base + "/" : "") ?? [];
    const text = existsSync(file) ? await Bun.file(file).text() : "";
    if (!entries.length && !re.test(text)) continue;
    const stripped = text.replace(re, "\n").replace(/\n*$/, "\n");
    const block = [BEGIN, ...entries.sort().map((p) => "/" + p.replace(/([*?[\]!#\\ ])/g, "\\$1")), END].join("\n");
    await Bun.write(file, entries.length ? `${stripped === "\n" ? "" : stripped + "\n"}${block}\n` : stripped);
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** git blob id of a byte buffer, so manifest ids match `git hash-object`. */
function blobOid(bytes: Uint8Array): string {
  const h = new Bun.CryptoHasher("sha1");
  h.update(`blob ${bytes.byteLength}\0`);
  h.update(bytes);
  return h.digest("hex");
}

async function localOid(path: string): Promise<string | null> {
  const f = Bun.file(join(root, path));
  if (!(await f.exists())) return null;
  return blobOid(new Uint8Array(await f.arrayBuffer()));
}

function select(files: Record<string, Entry>, prefixes: string[]) {
  const norm = prefixes.map((p) => relative(root, resolve(process.cwd(), p)).replace(/\\/g, "/"));
  return Object.entries(files).filter(([p]) => !norm.length || norm.some((n) => n === "" || p === n || p.startsWith(n.replace(/\/?$/, "/"))));
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

async function pull(prefixes: string[]) {
  const m = await readManifest();
  const s3 = client();
  const todo: [string, Entry][] = [];
  for (const [p, e] of select(m.files, prefixes)) if ((await localOid(p)) !== e.oid) todo.push([p, e]);
  let done = 0;
  await pool(todo, 8, async ([p, e]) => {
    const bytes = new Uint8Array(await s3.file(m.objects + e.oid).arrayBuffer());
    if (blobOid(bytes) !== e.oid) throw new Error(`checksum mismatch for ${p}`);
    await mkdir(dirname(join(root, p)), { recursive: true });
    await Bun.write(join(root, p), bytes);
    done++;
  });
  console.error(`media: ${done} downloaded, ${select(m.files, prefixes).length - done} already up to date`);
}

async function status(prefixes: string[]) {
  const m = await readManifest();
  let bad = 0;
  for (const [p, e] of select(m.files, prefixes)) {
    const oid = await localOid(p);
    if (oid === e.oid) continue;
    bad++;
    console.log(`${oid === null ? "missing " : "modified"}  ${p}`);
  }
  console.log(bad ? `media: ${bad} file(s) differ from the manifest (pull to restore, push to record)` : "media: everything matches the manifest");
}

async function push(paths: string[]) {
  if (!paths.length) throw new Error("push needs at least one path");
  const m = await readManifest();
  const s3 = client();
  for (const arg of paths) {
    const p = relative(root, resolve(process.cwd(), arg)).replace(/\\/g, "/");
    const bytes = new Uint8Array(await Bun.file(join(root, p)).arrayBuffer());
    const oid = blobOid(bytes);
    const key = m.objects + oid;
    if (!(await s3.file(key).exists())) await s3.write(key, bytes);
    m.files[p] = { oid, size: bytes.byteLength };
    console.log(`pushed ${p} (${oid.slice(0, 10)}, ${(bytes.byteLength / 1e6).toFixed(1)} MB)`);
  }
  await writeManifest(m);
  console.log("media: manifest and .gitignore updated — commit media.manifest.json and .gitignore");
}

async function remove(paths: string[]) {
  const m = await readManifest();
  for (const arg of paths) delete m.files[relative(root, resolve(process.cwd(), arg)).replace(/\\/g, "/")];
  await writeManifest(m);
}

async function stage(dir: string, out?: string) {
  const rel = relative(root, resolve(process.cwd(), dir)).replace(/\\/g, "/");
  await pull([rel]);
  const target = out ? resolve(out) : await mkdtemp(join(tmpdir(), "keating-stage-"));
  if (out) await rm(target, { recursive: true, force: true });
  const listed = Bun.spawnSync(["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", rel]);
  if (listed.exitCode !== 0) throw new Error(listed.stderr.toString());
  const m = await readManifest();
  const files = new Set(listed.stdout.toString().split("\0").filter(Boolean));
  for (const [p] of select(m.files, [rel])) files.add(p);
  for (const p of files) {
    if (!existsSync(join(root, p))) continue;
    const dest = join(target, relative(rel, p));
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(root, p), dest);
  }
  console.log(target);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "pull") await pull(args);
  else if (cmd === "status") await status(args);
  else if (cmd === "push") await push(args);
  else if (cmd === "rm") await remove(args);
  else if (cmd === "stage") await stage(args[0] ?? ".", args[1]);
  else {
    console.log(readFileSync(new URL(import.meta.url).pathname, "utf8").split("*/")[0]);
    process.exit(cmd ? 1 : 0);
  }
} catch (error) {
  console.error(`media: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
