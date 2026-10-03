import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let repositoryHelper: string | undefined;
try { repositoryHelper = require.resolve("app-builder-lib/out/util/repositoryInfo.js"); } catch {}
if (process.env.KEATING_REQUIRE_PACKAGER_TEST === "1") {
  if (!repositoryHelper) throw new Error("Required Electron Builder repository metadata integration is unavailable.");
  for (const name of ["electron-builder", "app-builder-lib"]) {
    if (require(`${name}/package.json`).version !== "25.1.8") throw new Error(`Required ${name} version is 25.1.8.`);
  }
}

async function put(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

test("staging carries the verified repository into the generated app manifest", async () => {
  const desktop = fileURLToPath(new URL("..", import.meta.url));
  const source = JSON.parse(await readFile(join(desktop, "package.json"), "utf8"));
  const rootPackage = JSON.parse(await readFile(join(desktop, "..", "package.json"), "utf8"));
  expect(source.repository).toEqual(rootPackage.repository);
  expect(source.repository).toEqual({ type: "git", url: "git+https://github.com/Diogenesoftoronto/keating.git" });
  const root = await mkdtemp(join(tmpdir(), "keating-desktop-metadata-"));
  try {
    const project = join(root, "desktop");
    await put(join(project, "package.json"), JSON.stringify(source));
    await put(join(project, "dist", "main.js"), "export {};");
    await put(join(root, "web", ".output", "server", "index.mjs"), "export {};");
    await put(join(root, "packages", "p2p-core", "dist", "index.js"), "export {};");
    await put(join(root, "packages", "p2p-core", "package.json"), JSON.stringify({ name: "@keating/p2p-core" }));
    await mkdir(join(root, "packages", "p2p-core", "node_modules"), { recursive: true });
    await put(join(root, "node_modules", "@huggingface", "tokenizers", "LICENSE"), "fixture license");
    for (const name of ["onnxruntime-node", "onnxruntime-common"]) {
      await put(join(project, "node_modules", name, "package.json"), JSON.stringify({ name, main: "index.js" }));
      await put(join(project, "node_modules", name, "index.js"), "module.exports = {};");
    }
    await put(join(project, "node_modules", "onnxruntime-node", "bin", "napi-v6", process.platform, process.arch, "binding.node"), "fixture binding");
    await mkdir(join(project, "scripts"), { recursive: true });
    for (const script of ["stage-nitro.mjs", "stage-onnx-runtime.mjs"]) {
      await cp(join(desktop, "scripts", script), join(project, "scripts", script));
    }
    const result = spawnSync(process.execPath, [join(project, "scripts", "stage-nitro.mjs")], { cwd: project, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const app = join(project, "dist", "app");
    const generated = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
    expect(generated.repository).toEqual(source.repository);
    await access(join(project, "dist", "nitro", "server", "index.mjs"));
    if (repositoryHelper) {
      const { getRepositoryInfo } = require(repositoryHelper);
      // Neither fixture project has .git/config: success must come from metadata.
      for (const [directory, metadata, devMetadata] of [[project, generated, source], [app, generated, null]]) {
        const info = await getRepositoryInfo(directory, metadata, devMetadata);
        expect(info).toMatchObject({ type: "github", user: "Diogenesoftoronto", project: "keating" });
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(!repositoryHelper)("registered desktop metadata resolves GitHub without a Git checkout", async () => {
  const desktop = fileURLToPath(new URL("..", import.meta.url));
  const metadata = JSON.parse(await readFile(join(desktop, "package.json"), "utf8"));
  const { getRepositoryInfo } = require(repositoryHelper!);
  expect(await getRepositoryInfo(join(tmpdir(), "keating-no-git-metadata-fixture"), metadata, metadata)).toMatchObject({ type: "github", user: "Diogenesoftoronto", project: "keating" });
});
