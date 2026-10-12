import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stageProductionDependencies } from "../scripts/stage-production-dependencies.mjs";

async function put(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

test("stages hoisted production closure and preserves nested conflicting versions without workspace node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "keating-hoisted-runtime-"));
  try {
    const workspace = join(root, "packages", "p2p-core");
    await put(join(workspace, "package.json"), JSON.stringify({ dependencies: { first: "1", second: "1" }, devDependencies: { excluded: "1" } }));
    for (const [name, dependencies, value] of [["first", { shared: "1" }, "first"], ["second", { shared: "2" }, "second"], ["shared", {}, "one"], ["excluded", {}, "excluded"]] as const) {
      const directory = join(root, "node_modules", name);
      await put(join(directory, "package.json"), JSON.stringify({ name, main: "index.cjs", dependencies }));
      await put(join(directory, "index.cjs"), name === "first" || name === "second" ? 'module.exports = require("shared");' : `module.exports = ${JSON.stringify(value)};`);
    }
    const nested = join(root, "node_modules", "second", "node_modules", "shared");
    await put(join(nested, "package.json"), JSON.stringify({ name: "shared", main: "index.cjs" }));
    await put(join(nested, "index.cjs"), 'module.exports = "two";');
    const app = join(root, "app");
    await put(join(app, "package.json"), "{}");
    await stageProductionDependencies({ packageDirectory: workspace, appDirectory: app });
    const require = createRequire(join(app, "package.json"));
    expect(require.resolve("first")).toBe(join(app, "node_modules", "first", "index.cjs"));
    expect(require.resolve("second")).toBe(join(app, "node_modules", "second", "index.cjs"));
    expect(require("first")).toBe("one");
    expect(require("second")).toBe("two");
    await expect(access(join(app, "node_modules", "excluded"))).rejects.toThrow();
    expect(await readFile(join(app, "node_modules", "second", "node_modules", "shared", "index.cjs"), "utf8")).toContain("two");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing mandatory production dependency fails staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "keating-missing-runtime-"));
  try {
    await put(join(root, "package.json"), JSON.stringify({ dependencies: { "keating-uninstalled-fixture": "1" } }));
    await expect(stageProductionDependencies({ packageDirectory: root, appDirectory: join(root, "app") })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
