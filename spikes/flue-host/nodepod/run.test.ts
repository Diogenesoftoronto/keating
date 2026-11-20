import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { flueBrowserRuntime } from "../../../web/scripts/flue/vite-plugin.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const fixture of ["portable", "official", "chat", "native-page", "teaching-lab"] as const) {
  test(
    fixture === "portable"
      ? "portable Keating state survives renders inside real NodePod"
      : fixture === "chat"
        ? "browser chat uses native Flue SDK, real quiz tools and persisted history"
        : fixture === "teaching-lab" ? "authored teaching lab delivers failed and passed observations into the same tutor conversation"
        : fixture === "native-page" ? "native page diagnostics follow a real tool, transcript save, inline frame and full-screen open"
        : "official Flue dispatch and tool state work with the NodePod SQL adapter",
    { timeout: 90_000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "flue-nodepod-"));
      const bundle = join(directory, "scenario.cjs");
      let server: Awaited<ReturnType<typeof createServer>> | undefined;
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        execFileSync(
          "bun",
          [
            "build",
            fixture === "portable"
              ? "nodepod/portable-scenario.ts"
              : "nodepod/scenario.ts",
            "--target=node",
            "--format=cjs",
            "--outfile",
            bundle,
          ],
          { cwd: root, stdio: "pipe" },
        );
        server = await createServer({
          configFile: false,
          root: resolve(root, "nodepod"),
          optimizeDeps: {
            exclude: ["@keating/learner-contracts"],
            entries: [
              resolve(root, "nodepod/client.ts"),
              resolve(root, "../../web/src/test/fixtures/flue-chat.ts"),
              resolve(root, "../../web/src/test/fixtures/flue-native-page.ts"),
              resolve(root, "../../web/src/test/fixtures/flue-teaching-lab.ts"),
            ],
          },
          server: {
            host: "127.0.0.1",
            port: 0,
            watch: null,
            hmr: false,
            fs: { allow: [resolve(root, "../.."), resolve(root, "../../web")] },
            headers: {
              "Cross-Origin-Opener-Policy": "same-origin",
              "Cross-Origin-Embedder-Policy": "credentialless",
            },
          },
          plugins: [
            flueBrowserRuntime(),
            {
              name: "flue-fixture",
              configureServer(server) {
                server.middlewares.use(
                  fixture === "portable" ? "/portable.cjs" : "/scenario.cjs",
                  async (_request, response) => {
                    response.setHeader("Content-Type", "text/javascript");
                    response.end(await readFile(bundle));
                  },
                );
              },
            },
          ],
        });
        await server.listen();
        browser = await chromium.launch({
          headless: true,
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
            : {}),
        });
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        // Runtime fixtures and model responses are local. No paid provider calls.
        await page.route("**/*", (route) =>
          new URL(route.request().url()).hostname === "127.0.0.1"
            ? route.continue()
            : route.abort(),
        );
        await page.goto(server.resolvedUrls!.local[0] + "?fixture=" + fixture, {
          waitUntil: "domcontentloaded",
        });
        if (fixture === "chat") {
          await page.waitForFunction(
            () =>
              (window as any).flueChatQuizReady ||
              (window as any).flueNodepodTest?.stage === "failed",
            {},
            { timeout: 60_000 },
          );
          await page
            .getByRole("button", { name: "Start Quiz", exact: true })
            .click();
          await page
            .getByText("Which is larger: 1/4 or 1/8?", { exact: true })
            .first()
            .waitFor({ state: "visible", timeout: 5_000 });
          await page
            .getByRole("textbox", { name: "Your answer", exact: true })
            .first()
            .fill(
              "A fourth is larger because the whole has fewer equal pieces.",
            );
          assert.equal(
            await page
              .getByRole("textbox", { name: "Your answer", exact: true })
              .first()
              .inputValue(),
            "A fourth is larger because the whole has fewer equal pieces.",
          );
          await page.evaluate(() => (window as any).flueChatContinue());
        }
        if (fixture === "teaching-lab") {
          await page.waitForFunction(() => document.querySelector(".teaching-lab") || (window as any).flueNodepodTest?.stage === "failed");
          assert.equal(await page.evaluate(() => (window as any).flueNodepodTest?.error), null, errors.join("\n"));
          const lab = page.locator(".teaching-lab").first();
          const c = lab.getByRole("button", { name: "Play C4, MIDI 60" });
          const d = lab.getByRole("button", { name: "Play D4, MIDI 62" });
          const e = lab.getByRole("button", { name: "Play E4, MIDI 64" });
          await c.click(); await d.click();
          await page.getByText("Keep C4 and try a different second note.", { exact: true }).first().waitFor();
          await c.click(); await d.click(); // Same unmet checkpoint is not sent twice.
          await c.click(); await e.click();
          await page.getByText("Those notes make a major third.", { exact: true }).first().waitFor();
          await page.evaluate(() => (window as any).withdrawLabKey());
          await d.click();
          await page.waitForFunction(() => (window as any).labMissingCredentialCount() >= 1);
          assert.equal(await page.getByPlaceholder("openai API key").count(), 0);
          await c.click(); // Next note still goes to the keyboard after an automatic turn had no credentials.
          await page.waitForFunction(() => (window as any).labMissingCredentialCount() >= 2);
          assert.equal(await page.getByPlaceholder("openai API key").count(), 0);
          const composer = page.getByPlaceholder("Message Keating");
          await composer.fill("Explain the interval.");
          await page.getByRole("button", { name: "Send message" }).click();
          await page.getByPlaceholder("openai API key").fill("local-fixture-only");
          await page.getByRole("button", { name: "Save key" }).click();
          await page.getByText("The interval spans four semitones.", { exact: true }).first().waitFor();
          await page.evaluate(() => (window as any).finishTeachingLabFixture());
        }
        if (fixture === "native-page") {
          const host = page.locator('[data-native-page-status="ready"]');
          await page.waitForFunction(async () => {
            const api = (window as any).nativePageFixture;
            const native = api && (await api.getRows())[0]?.nativePage;
            return !!(window as any).finishNativePageFixture && native?.saved && native.ready && native.visible === false && native.opened === false;
          }, {}, {timeout:60_000});
          await host.scrollIntoViewIfNeeded();
          await page.waitForFunction(async () => (await (window as any).nativePageFixture.getRows())[0]?.nativePage.visible === true);
          const frame = page.frameLocator('iframe[title="Bus seats"]');
          assert.equal(await host.locator("iframe").getAttribute("sandbox"),"allow-scripts");
          assert.equal(await frame.locator("output").textContent(),"320");
          const slider = frame.getByRole("slider");
          await slider.focus();
          for (let i = 0; i < 8; i++) await slider.press("ArrowRight");
          assert.equal(await frame.locator("output").textContent(),"640");
          await host.getByRole("button",{name:"Open full screen"}).click();
          await page.waitForFunction(async () => (await (window as any).nativePageFixture.getRows())[0]?.nativePage.opened === true);
          await host.getByRole("button",{name:"Exit full screen"}).click();
          const count = await page.evaluate(() => (window as any).nativePageFixture.revisions());
          await page.evaluate(() => (window as any).nativePageFixture.remount());
          await host.waitFor();
          assert.equal(await page.evaluate(() => (window as any).nativePageFixture.revisions()),count);
          await page.evaluate(() => (window as any).nativePageFixture.brokenPage());
          await page.waitForSelector('[data-native-page-status="crashed"]');
          await page.waitForFunction(async () => {
            const second = (await (window as any).nativePageFixture.getRows())[1]?.nativePage;
            return second?.saved && second.frameFailed === true;
          });
          await page.evaluate(() => (window as any).nativePageFixture.codeReply());
          await page.getByRole("button",{name:"Edit",exact:true}).click();
          const editor = page.getByRole("textbox",{name:"Editable code"});
          assert.match(await editor.inputValue(),/print\(i \+ 1\)/);
          await editor.fill("for i in range(3):\n    print(i)");
          await page.evaluate(() => (window as any).finishNativePageFixture());
        }
        await page.waitForFunction(
          () =>
            ["done", "failed"].includes((window as any).flueNodepodTest?.stage),
          {},
          { timeout: 60_000 },
        );
        const evidence = await page.evaluate(() => ({
          isolated: crossOriginIsolated,
          ...(window as any).flueNodepodTest,
        }));
        assert.equal(
          evidence.isolated,
          true,
          "NodePod requires a cross-origin isolated browser",
        );
        assert.equal(evidence.error, null, JSON.stringify(evidence));
        if (fixture === "portable") {
          assert.equal(
            evidence.result?.exitCode,
            0,
            JSON.stringify({ evidence, errors }, null, 2),
          );
          assert.match(evidence.result.stdout, /PORTABLE_NODEPOD_RESULT=ok/);
        } else if (fixture === "chat") {
          assert.equal(
            evidence.result?.exitCode,
            0,
            JSON.stringify({ evidence, errors }, null, 2),
          );
          assert.match(
            evidence.result.stdout,
            /FLUE_CHAT_RESULT=.*"native":true.*"restored":true/,
          );
          assert.match(
            evidence.result.stdout,
            /"cancelled":true.*"exclusive":true/,
          );
          assert.equal(
            errors.filter((error) => !error.includes("ResizeObserver loop"))
              .length,
            0,
            errors.join("\n"),
          );
        } else if (fixture === "teaching-lab") {
          const { sessionId, turns, actions, pending, saved } = evidence.result;
          assert.equal(sessionId, "practice-a-scale");
          assert.deepEqual(turns.map((turn: { passed: boolean }) => turn.passed), [false, true]);
          assert.match(turns[0].evidence, /On-screen keyboard: C4 D4\. Target: C4 E4/);
          assert.match(turns[1].evidence, /On-screen keyboard: C4 E4\. Target: C4 E4/);
          assert.deepEqual(actions, Array(4).fill("observe-lab"));
          assert.equal(pending, 0);
          assert.match(saved, /On-screen keyboard: C4 D4/);
          assert.match(saved, /On-screen keyboard: C4 E4/);
          assert.match(saved, /Those notes make a major third/);
          assert.deepEqual(errors, []);
        } else if (fixture === "native-page") {
          assert.equal(evidence.result?.rows.length,3);
          assert.deepEqual(evidence.result.rows[0].nativePage,
            {succeeded:true,failed:false,attached:true,saved:true,mounted:true,ready:true,visible:true,opened:true,frameFailed:false});
          assert.deepEqual(evidence.result.rows[0].selected,[]);
          assert.deepEqual(evidence.result.rows[1].nativePage,
            {succeeded:true,failed:false,attached:true,saved:true,mounted:true,ready:false,visible:false,opened:false,frameFailed:true});
          assert.deepEqual(evidence.result.rows[2].editableCode,["python"]);
          assert.deepEqual(evidence.result.rows[2].cue,{kind:"implicit-action",targets:["editable-code"],codeLanguage:"python"});
          assert.deepEqual(evidence.result.rows[2].selected,[]);
          assert.deepEqual(errors.filter(error => error !== "Expected local frame error"),[]);
        } else {
          assert.equal(
            evidence.result?.exitCode,
            0,
            JSON.stringify({ evidence, errors }, null, 2),
          );
          assert.match(
            evidence.result.stdout,
            /FLUE_NODEPOD_RESULT=.*"ok":true.*"sawPersistedState":true.*"sawRestartedState":true/,
          );
        }
      } finally {
        await browser?.close();
        await server?.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
