import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const usage = "Usage: bun scripts/openui-diagnostics/probe-question-viewport.mjs <loopback Vite classroom URL> [screenshot directory]";
if (process.argv[2] === "--help") { console.log(usage); process.exit(0); }
if (!process.argv[2] || process.argv.length > 4) throw new Error(usage);
const site = new URL(process.argv[2]);
if (!["http:", "https:"].includes(site.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(site.hostname) || site.username || site.password) throw new Error(usage);
const output = process.argv[3];
if (output) await mkdir(output, { recursive: true });
const { chromium } = createRequire(new URL("../../spikes/flue-host/package.json", import.meta.url))("playwright");
const archive = new URL("../../docs/benchmarks/jev-paired-prediction-2026-11-18/", import.meta.url);
const [ledger, turn] = await Promise.all(["ledger.json", "sock-draw.json"].map(async file => JSON.parse(await readFile(new URL(file, archive), "utf8"))));
const recorded = ledger.entries[15];
assert.equal(recorded.cell, "sock-draw");
assert.equal(recorded.stage, "generation");
const question = recorded.message.content.find(part => part.type === "text").text;
assert.match(question, /Which colour are you more likely to pick\?/);

// Supply the archived answer at the model stream boundary. Normal Flue publication,
// React rendering, keyboard submission, session persistence and viewport logic still run.
async function installReplay(page) {
  await page.waitForFunction(() => performance.getEntriesByType("resource").some(entry => new URL(entry.name).pathname.endsWith("/src/keating/flue/conversation.ts")));
  await page.evaluate(async question => {
    const source = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname.endsWith("/src/keating/flue/conversation.ts")).name;
    const { FlueConversation } = await import(source);
    const { response } = await import("/src/test/fixtures/flue-chat.ts");
    const replay = window.questionViewportReplay = { kind: "question", publish: null, finished: false };
    const sendPrepared = FlueConversation.prototype.sendPrepared;
    FlueConversation.prototype.sendPrepared = function(message) {
      this.streamFunction = async () => {
        await new Promise(resolve => { replay.publish = resolve; });
        replay.publish = null;
        const prose = Array.from({ length: 35 }, (_, i) => `Reading note ${i + 1}. This paragraph provides earlier material for the learner to reread while the following turn is pending.`).join("\n\n");
        return response([{ type: "text", text: replay.kind === "question" ? question : prose }]);
      };
      // This replay needs neither a provider credential nor a hosted decision.
      return sendPrepared.call(this, message, async () => {}).finally(() => { replay.finished = true; });
    };
  }, question);
}

function readBounds() {
  const composer = document.querySelector('[placeholder="Message Keating"]');
  let viewport = composer.parentElement, footer;
  while (viewport && getComputedStyle(viewport).overflowY !== "auto") {
    if (getComputedStyle(viewport).position === "sticky") footer = viewport;
    viewport = viewport.parentElement;
  }
  const question = document.querySelector("fieldset[data-question-kind]");
  const bounds = node => {
    if (!node) return null;
    const { top, bottom } = node.getBoundingClientRect();
    return [Math.round(top), Math.round(bottom)];
  };
  return {
    readingArea: [Math.round(viewport.getBoundingClientRect().top), Math.round(footer.getBoundingClientRect().top)],
    latestLearner: bounds(Array.from(viewport.querySelectorAll(".you-bubble")).at(-1)),
    prompt: bounds(question?.querySelector("legend")), firstOption: bounds(question?.querySelector("label")),
    scrollTop: Math.round(viewport.scrollTop), remaining: Math.round(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop),
    composerFocused: document.activeElement === composer,
  };
}

async function check(browser, mode) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 }, serviceWorkers: "block", reducedMotion: mode === "standard" ? "no-preference" : "reduce" });
  try {
    await context.routeWebSocket("**/*", route => route.close());
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === site.origin && ["GET", "HEAD"].includes(request.method()) && (!url.pathname.startsWith("/api/") || url.pathname === "/api/agent-runtime/config")) {
        const headers = await request.allHeaders();
        if (!headers.authorization && !headers["x-api-key"] && !headers["x-target-url"]) return route.continue();
      }
      return route.abort();
    });
    await context.addInitScript(() => {
      performance.setResourceTimingBufferSize(15000);
      for (const key of ["keating:onboarding:v1", "keating:tour:v1"]) localStorage.setItem(key, JSON.stringify({ version: key.includes("onboarding") ? 2 : 1, outcome: "skipped", step: 0 }));
      localStorage.setItem("keating.analytics.preferences.v1", JSON.stringify({ captureEnabled: false, replayEnabled: false, arizeEvaluationEnabled: false }));
    });
    const page = await context.newPage();
    await page.goto(site.origin + "/chat", { waitUntil: "domcontentloaded" });
    const composer = page.getByPlaceholder("Message Keating", { exact: true });
    await composer.waitFor();
    await installReplay(page);
    async function send(kind, text) {
      await page.evaluate(kind => { window.questionViewportReplay.kind = kind; window.questionViewportReplay.finished = false; }, kind);
      await composer.fill(text);
      await composer.press("Enter");
      await page.waitForFunction(() => window.questionViewportReplay.publish !== null);
    }
    async function publish() {
      await page.evaluate(() => window.questionViewportReplay.publish());
      await page.waitForFunction(() => window.questionViewportReplay.finished);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function waitForAnchor() {
      await page.waitForFunction(() => {
        const learner = Array.from(document.querySelectorAll(".you-bubble")).at(-1);
        if (!learner) return false;
        let viewport = learner.parentElement;
        while (viewport && getComputedStyle(viewport).overflowY !== "auto") viewport = viewport.parentElement;
        return viewport && Math.abs(learner.getBoundingClientRect().top - viewport.getBoundingClientRect().top) < 65;
      });
      await settleScroll();
    }
    async function settleScroll() {
      await page.evaluate(async () => {
        const learner = Array.from(document.querySelectorAll(".you-bubble")).at(-1);
        let previous = learner.getBoundingClientRect().top;
        let stable = 0;
        for (let frame = 0; frame < 60 && stable < 4; frame++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const top = learner.getBoundingClientRect().top;
          stable = Math.abs(top - previous) <= 0.5 ? stable + 1 : 0;
          previous = top;
        }
      });
    }
    const result = { mode };
    if (mode === "manual") {
      await send("prose", "Show the earlier reading notes.");
      await publish();
      await send("prose", "Expand on those notes in a second reply.");
      await waitForAnchor();
      result.proseBefore = await page.evaluate(readBounds);
      await publish();
      result.proseAfter = await page.evaluate(readBounds);
      assert(result.proseAfter.remaining > 300, "A long reply should remain below the learner's message");
      assert(Math.abs(result.proseAfter.latestLearner[0] - result.proseBefore.latestLearner[0]) <= 2,
        `Publishing the reply moved the learner's message: ${JSON.stringify({ before: result.proseBefore, after: result.proseAfter })}`);
    }
    await send("question", turn.learner);
    if (mode === "manual") {
      await waitForAnchor();
      const start = await page.evaluate(readBounds);
      await page.mouse.move(720, 350);
      await page.mouse.wheel(0, -680);
      await page.waitForFunction(previous => {
        let el = document.querySelector('[placeholder="Message Keating"]').parentElement;
        while (el && getComputedStyle(el).overflowY !== "auto") el = el.parentElement;
        return el.scrollTop < previous - 300;
      }, start.scrollTop);
      await settleScroll();
    }
    result.before = await page.evaluate(readBounds);
    if (output && mode === "manual") await page.screenshot({ path: join(output, "manual-before.png") });
    await publish();
    await page.locator("fieldset[data-question-kind] > legend").waitFor();
    result.after = await page.evaluate(readBounds);
    if (output) await page.screenshot({ path: join(output, mode + ".png") });
    const { readingArea, prompt, firstOption, composerFocused } = result.after;
    assert(composerFocused, "The Question must preserve keyboard focus on the composer");
    if (mode === "manual") {
      // The busy footer and ready footer differ slightly in size. A reading
      // position must survive that change to within one line of body text.
      assert(Math.abs(result.after.scrollTop - result.before.scrollTop) <= 16,
        `An incoming Question moved the reader: ${JSON.stringify({ before: result.before, after: result.after })}`);
    } else {
      assert(Math.abs(result.after.latestLearner[0] - result.before.latestLearner[0]) <= 2,
        "Publishing the first reply moved the learner's message");
      assert(prompt[0] >= readingArea[0] && prompt[1] <= readingArea[1], "The Question prompt was clipped");
      assert(firstOption[0] >= readingArea[0] && firstOption[1] <= readingArea[1], "The first option was clipped");
    }
    if (mode === "reduced") {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("fieldset[data-question-kind] > legend").waitFor();
      result.restored = await page.evaluate(readBounds);
      assert(result.restored.remaining <= 2, "Restoring an existing thread should keep the original bottom anchor");
    }
    return result;
  } finally { await context.close(); }
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ["--disable-background-networking", "--disable-extensions", "--no-proxy-server", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE " + site.hostname] });
try {
  for (const mode of ["reduced", "standard", "manual"]) console.log(JSON.stringify(await check(browser, mode)));
} finally { await browser.close(); }
