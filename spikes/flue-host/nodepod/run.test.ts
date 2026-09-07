import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const fixture of ["portable", "official"] as const) {
test(fixture === "portable" ? "portable Keating state survives renders inside real NodePod" : "official Flue dispatch and tool state work with the NodePod SQL adapter", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-nodepod-"));
  const bundle = join(directory, "scenario.cjs");
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    execFileSync("bun", ["build", fixture === "portable" ? "nodepod/portable-scenario.ts" : "nodepod/scenario.ts", "--target=node", "--format=cjs", "--outfile", bundle], { cwd: root, stdio: "pipe" });
    server = await createServer({
      configFile: false, root: resolve(root, "nodepod"),
      server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(root, "../.."), resolve(root, "../../web")] }, headers: {
        "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless",
      } },
      plugins: [{ name: "flue-fixture", configureServer(server) {
        server.middlewares.use(fixture === "portable" ? "/portable.cjs" : "/scenario.cjs", async (_request, response) => {
          response.setHeader("Content-Type", "text/javascript"); response.end(await readFile(bundle));
        });
      } }],
    });
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // Runtime fixtures and model responses are local. No paid provider calls.
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.goto(server.resolvedUrls!.local[0] + "?fixture=" + fixture, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => ["done", "failed"].includes((window as any).flueNodepodTest?.stage), {}, { timeout: 60_000 });
    const evidence = await page.evaluate(() => ({ isolated: crossOriginIsolated, ...(window as any).flueNodepodTest }));
    assert.equal(evidence.isolated, true, "NodePod requires a cross-origin isolated browser");
    assert.equal(evidence.error, null, JSON.stringify(evidence));
    if (fixture === "portable") {
      assert.equal(evidence.result?.exitCode, 0, JSON.stringify({ evidence, errors }, null, 2));
      assert.match(evidence.result.stdout, /PORTABLE_NODEPOD_RESULT=ok/);
    } else {
      assert.equal(evidence.result?.exitCode, 0, JSON.stringify({ evidence, errors }, null, 2));
      assert.match(evidence.result.stdout, /FLUE_NODEPOD_RESULT=.*"ok":true.*"sawPersistedState":true.*"sawRestartedState":true/);
    }
  } finally { await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
});

}
