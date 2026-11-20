import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { SYSTEMS_LESSONS, runSystemsLesson, type SystemsLessonId } from "../keating/systems-lessons";

type LessonModule = typeof import("../keating/systems-lessons");

test("the Service fixture requires a matching namespace and every selector key", async () => {
  const service = JSON.parse(SYSTEMS_LESSONS.find(lesson => lesson.id === "kubernetes")!.starter);
  const check = () => runSystemsLesson("kubernetes", JSON.stringify(service), new AbortController().signal);
  service.spec.selector = { app: "api", track: "stable" };
  expect((await check()).status).toBe("passed");
  service.metadata.namespace = "default";
  expect((await check()).output).toContain("Selected: (none)");
  service.metadata.namespace = "lab";
  service.spec.selector = {};
  expect((await check()).output).toContain("Selected: (none)");
  service.spec.selector = { app: "api", track: 42 };
  expect((await check()).status).toBe("failed");
});

test("cancellation takes priority over a lesson result", async () => {
  await expect(runSystemsLesson("kubernetes", "{}", AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
});

test("bundled lessons run the learner's edits, report traces and surface compiler diagnostics", async () => {
  const dist = await mkdtemp(join(tmpdir(), "keating-systems-lessons-"));
  const { chromium } = createRequire(resolve(import.meta.dir, "../../../spikes/flue-host/package.json"))("playwright");
  const browser = await chromium.launch();
  let blockRuntime = false;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      if (blockRuntime && path.endsWith(".wasm")) return new Response("Runtime unavailable", { status: 503 });
      return new Response(Bun.file(join(dist, path)));
    },
  });
  try {
    await build({
      configFile: false, root: resolve(import.meta.dir, "../.."), publicDir: false, logLevel: "silent",
      build: { outDir: dist, rollupOptions: {
        input: { lessons: resolve(import.meta.dir, "../keating/systems-lessons.ts"), snippet: resolve(import.meta.dir, "../keating/system-snippet.ts") },
        preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" },
      } },
    });
    const page = await browser.newPage();
    await page.goto(server.url.href);
    const results = await page.evaluate(async (url: string) => {
      const { SYSTEMS_LESSONS, runSystemsLesson }: LessonModule = await import(url);
      const signal = new AbortController().signal;
      const edits: Record<SystemsLessonId, [string, string]> = {
        linux: [">>build.log", ">&3"], kernel: ["offset=$((address /", "offset=$((address %"],
        nix: ["overrides // defaults", "defaults // overrides"], wasm: ["load8_u", "load16_u"],
        kubernetes: ['"track": "canary"', '"track": "stable"'],
      };
      const cases = [];
      for (const lesson of SYSTEMS_LESSONS) {
        const [before, after] = edits[lesson.id];
        const withTrace = lesson.id === "linux" || lesson.id === "kernel";
        const starter = await runSystemsLesson(lesson.id, lesson.starter, signal);
        const fixed = await runSystemsLesson(lesson.id, lesson.starter.replace(before, after), signal, { trace: withTrace });
        cases.push({ id: lesson.id, starter, fixed });
      }
      const badWat = await runSystemsLesson("wasm", "(module (???))", signal);
      const badNix = await runSystemsLesson("nix", "overrides: missingValue", signal);
      const shellError = await runSystemsLesson("linux", "echo diagnostic >&2; exit 4", signal, { trace: true });
      return { cases, badWat, badNix, shellError };
    }, "/lessons.js");

    for (const { id, starter, fixed } of results.cases) {
      expect(starter.status, id + ": " + starter.output).toBe("failed");
      expect(fixed.status, id + ": " + fixed.output).toBe("passed");
      if (id === "linux" || id === "kernel") {
        expect(fixed.output).toContain("Shell trace (stderr)\n+ ");
        expect(fixed.output).toContain(id === "linux" ? "mv build.log build.old" : "translate 4096");
      }
    }
    expect(results.badWat.status).toBe("failed");
    expect(results.badWat.output).toContain("register.wat");
    expect(results.badNix.status).toBe("failed");
    expect(results.badNix.output).toContain("missingValue");
    expect(results.shellError.feedback).toContain("status 4");
    expect(results.shellError.output).toContain("diagnostic");

    // Chat evaluates arbitrary source without the authored exercise's harness or target.
    const snippets = await page.evaluate(async (url: string) => {
      const { runSystemSnippet: run }: typeof import("../keating/system-snippet") = await import(url);
      const signal = new AbortController().signal;
      const wat = '(module (func (export "twice") (param i64) (result i64) local.get 0 i64.const 2 i64.mul))';
      return {
        shell: await run("linux", "printf chat; exit 3", signal, { trace: true }),
        nix: await run("nix", "let n = 7; in n * n", signal),
        wasm: await run("wasm", wat, signal, { exportName: "twice", args: ["29n"] }),
        arity: await run("wasm", wat, signal, { exportName: "twice" }),
        yaml: await run("kubernetes", "kind: Pod\napiVersion: v1\nmetadata: {name: leaf, labels: {app: tree}}\n---\nkind: Service\napiVersion: v1\nmetadata: {name: branch}\nspec: {selector: {app: tree}}", signal),
      };
    }, "/snippet.js");
    expect(snippets.shell).toMatchObject({ stdout: "chat", exitCode: 3 });
    expect(snippets.shell.stderr).toContain("+ printf chat");
    expect(snippets.nix.stdout).toBe("49");
    expect(snippets.wasm.stdout).toContain("twice(29n) → 58");
    expect(snippets.arity).toMatchObject({ exitCode: 1 });
    expect(snippets.arity.stderr).toContain("expects 1 arguments");
    expect(snippets.yaml.stdout).toContain("Service default/branch\nSelected: leaf");

    // A new browser context cannot reuse the evaluator from the successful run.
    blockRuntime = true;
    const blockedPage = await browser.newPage();
    await blockedPage.goto(server.url.href);
    const unavailable = await blockedPage.evaluate(async (url: string) => {
      const { runSystemsLesson }: LessonModule = await import(url);
      return runSystemsLesson("nix", "overrides: 42", new AbortController().signal);
    }, "/lessons.js");
    expect(unavailable.status).toBe("unavailable");
  } finally {
    server.stop(true);
    await browser.close();
    await rm(dist, { recursive: true, force: true });
  }
}, 60_000);
