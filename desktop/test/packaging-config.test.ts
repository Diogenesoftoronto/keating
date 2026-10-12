import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("all desktop platforms validate against the installed Electron Builder schema with required Windows signing", async () => {
  const desktop = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.build.win.forceCodeSigning).toBe(true);
  expect(manifest.build.win.signExts).toEqual([".dll", ".node"]);
  expect(manifest.build.win.signtoolOptions.signingHashAlgorithms).toEqual(["sha256"]);
  const result = spawnSync("node", ["--input-type=commonjs", "-e", `
    const { validateConfiguration } = require("app-builder-lib/out/util/config/config.js");
    validateConfiguration(require("./package.json").build).catch(error => {
      console.error(error); process.exitCode = 1;
    });
  `], { cwd: desktop, encoding: "utf8", timeout: 15_000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}, 20_000);
