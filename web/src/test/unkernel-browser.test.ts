import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import type { runLinuxLesson } from "../keating/unkernel";

test("the bundled Linux lesson loads on demand and isolates each run", async () => {
  const dist = await mkdtemp(join(tmpdir(), "keating-linux-lesson-"));
  const { chromium } = createRequire(resolve(import.meta.dir, "../../../spikes/flue-host/package.json"))("playwright");
  const browser = await chromium.launch();
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === "/") return new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
      return new Response(Bun.file(join(dist, path)));
    },
  });
  try {
    await build({
      configFile: false,
      root: resolve(import.meta.dir, "../.."),
      publicDir: false,
      logLevel: "silent",
      build: {
        outDir: dist,
        rollupOptions: {
          input: resolve(import.meta.dir, "../keating/unkernel/index.ts"),
          preserveEntrySignatures: "strict",
          output: { entryFileNames: "runner.js" },
        },
      },
    });
    const page = await browser.newPage();
    await page.goto(server.url.href);
    const modulePath = "/runner.js";
    await page.evaluate(async (url: string) => { await import(url); }, modulePath);
    expect(requests.some(path => path.endsWith(".wasm"))).toBe(false);

    const results = await page.evaluate(async (url: string) => {
      const { runLinuxLesson: run }: { runLinuxLesson: typeof runLinuxLesson } = await import(url);
      const signal = new AbortController().signal;
      const first = await run("uname -sm; ls /sys/class/net; touch /tmp/learner; echo diagnostic >&2; exit 9", signal);
      const second = await run("test ! -e /tmp/learner && echo fresh", signal);
      const tooMuchOutput = await run("yes", signal).then(() => null, (e: Error) => e.message);
      const tooLarge = await run("x".repeat(32_769), signal).then(() => null, (e: Error) => e.message);
      const controller = new AbortController();
      const busy = run("while :; do :; done", controller.signal);
      setTimeout(() => controller.abort(), 100);
      const aborted = await busy.then(() => null, (e: Error) => e.name);
      return { first, second, tooMuchOutput, tooLarge, aborted };
    }, modulePath);
    expect(requests.some(path => path.endsWith(".wasm"))).toBe(true);
    expect(results.first).toEqual({ stdout: "Linux riscv64\nlo\n", stderr: "diagnostic\n", exitCode: 9 });
    expect(results.second).toEqual({ stdout: "fresh\n", stderr: "", exitCode: 0 });
    expect(results.tooMuchOutput).toContain("64 KiB");
    expect(results.tooLarge).toContain("32 KiB");
    expect(results.aborted).toBe("AbortError");
  } finally {
    server.stop(true);
    await browser.close();
    await rm(dist, { recursive: true, force: true });
  }
}, 45_000);
