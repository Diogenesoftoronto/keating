import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as pause } from "node:timers/promises";
import { DEFAULT_SYSTEM_ONE_MODEL as judge, MINIMAX_M31_FLASH_PROFILE as tutor } from "../../packages/runtime-config/src/models.ts";

const usage = "Usage: bun scripts/openui-diagnostics/probe-classroom-observer.mjs <classroom-url>";
const argument = process.argv[2];
if (argument === "--help") { console.log(usage); process.exit(0); }
if (!argument || process.argv.length !== 3) throw new Error(usage);
const base = new URL(argument);
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error(usage);
const origin = base.origin;
const prompt = "There are two blue socks and one yellow sock in a drawer. I’m going to draw one at random without looking. I’d like to guess which colour I’m more likely to pick before you explain.";
const { chromium } = createRequire(new URL("../../spikes/flue-host/package.json", import.meta.url))("playwright");

async function configureModels(page) {
  await page.goto(origin + "/chat", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog").first();
  await settings.getByRole("button", { name: "Models & Providers", exact: true }).click();
  await settings.getByRole("combobox", { name: "Choose a judgement model" }).selectOption("typesafe");
  const review = settings.locator("#settings-section-judgement");
  await review.getByRole("textbox", { name: "Model ID" }).fill(judge);
  await review.getByLabel("TypeSafe API key", { exact: true }).fill("observer-probe-dummy-judge");
  await review.getByRole("button", { name: "Save API key", exact: true }).click();
  await review.getByText("API key saved on this device.", { exact: true }).waitFor();
  await settings.getByLabel("Search providers and models").fill(tutor.provider);
  const provider = settings.getByRole("option").filter({ has: page.getByText(tutor.provider, { exact: true }) });
  await provider.click();
  const tutorKey = settings.getByLabel(tutor.provider + " API Key", { exact: true });
  const connected = provider.getByTitle("Connected");
  let credentialEntryAttempts = 0;
  do {
    credentialEntryAttempts++;
    await tutorKey.fill("observer-probe-dummy-tutor");
    await tutorKey.press("Tab"); // Save on blur and await the provider's persisted connection.
    if (await connected.waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
  } while (credentialEntryAttempts < 2 && await tutorKey.inputValue() === "");
  await connected.waitFor({ timeout: 5000 });
  await page.goto(origin + "/chat", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Change model\. Current model:/u }).click();
  const picker = page.getByRole("dialog", { name: "Find a model", exact: true });
  await picker.getByRole("combobox", { name: "Provider", exact: true }).selectOption(tutor.provider);
  await picker.getByRole("textbox", { name: "Find a model", exact: true }).fill(tutor.name);
  await picker.locator(".model-picker__item").filter({ hasText: "Model ID: " + tutor.id }).locator(".model-picker__option").click();
  if (await picker.isVisible()) await picker.getByRole("button", { name: "Close model picker" }).click();
  await page.getByRole("button", { name: "Change model. Current model: " + tutor.name, exact: true }).waitFor();
  return credentialEntryAttempts;
}

async function withheldRows(page, expected) {
  await page.waitForFunction(() => window.webMCP?.availableTools?.has("keating.openui_diagnostics"));
  let observed;
  const deadline = Date.now() + 20_000;
  do {
    const data = await page.evaluate(async () => {
      const result = await window.webMCP.availableTools.get("keating.openui_diagnostics").execute({ view: "withheld", limit: 2 });
      if (result.isError) throw new Error("WebMCP could not read withheld turns");
      return JSON.parse(result.content[0].text);
    });
    observed = data.matchingTurns;
    if (observed === expected && data.turns.length === expected) return data.turns;
    await pause(200);
  } while (Date.now() < deadline);
  throw new Error(`WebMCP returned ${observed} withheld turns, expected ${expected}`);
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: [
  "--disable-background-networking", "--disable-extensions", "--no-proxy-server",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE " + base.hostname,
] });
let phase = "load and configure the classroom";
let submitted = false, injected = 0, unexpectedDecisions = 0, blockedChatProxyRequests = 0;
try {
  const context = await browser.newContext({ serviceWorkers: "block", reducedMotion: "reduce" });
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (request.method() === "POST" && url.pathname === "/api/judgement/typesafe") {
      let body;
      try { body = request.postDataJSON(); } catch { /* Unexpected body is denied below. */ }
      if (submitted && injected === 0 && body?.model === judge && body.questions?.learning_task && body.questions?.draft_standard
        && body.state?.turn?.learnerMessage?.endsWith(prompt)) {
        injected++;
        return route.fulfill({ status: 403, contentType: "application/json",
          headers: { "X-Keating-Judgement-Error": "relay-origin-denied", "Cache-Control": "no-store" },
          body: JSON.stringify({ statusCode: 403, statusMessage: "Cross-origin review requests are not allowed." }),
        });
      }
      unexpectedDecisions++;
    }
    if (url.pathname.startsWith("/api/chat-proxy/")) blockedChatProxyRequests++;
    const asset = url.pathname === "/chat" || url.pathname === "/gt.config.json" || url.pathname === "/api/agent-runtime/config"
      || /^\/(?:assets|brand|fonts|icons|images|binaries|vendor|static)\//u.test(url.pathname)
      || /^\/(?:favicon[^/]*|(?:site|manifest)\.webmanifest)$/u.test(url.pathname)
      || (loopback && !url.pathname.startsWith("/api/")); // Vite serves sources from the checkout.
    if (asset && ["GET", "HEAD"].includes(request.method())) {
      const headers = await request.allHeaders();
      if (!headers.authorization && !headers["x-api-key"] && !headers["x-target-url"]) return route.continue();
    }
    return route.abort();
  });
  await context.addInitScript(site => {
    if (location.origin !== site) return;
    localStorage.setItem("keating.analytics.preferences.v1", JSON.stringify({ captureEnabled: false, replayEnabled: false, arizeEvaluationEnabled: false }));
    localStorage.setItem("keating:onboarding:v1", JSON.stringify({ version: 2, outcome: "skipped", step: 0 }));
    localStorage.setItem("keating:tour:v1", JSON.stringify({ version: 1, outcome: "skipped", step: 0 }));
  }, origin);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const credentialEntryAttempts = await configureModels(page);
  await context.clearCookies();
  await withheldRows(page, 0);
  phase = "observe the first chat turn";
  await page.getByPlaceholder("Message Keating", { exact: true }).fill(prompt);
  submitted = true;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("alert", { name: /Decision planning failed/i }).waitFor();
  const [before] = await withheldRows(page, 1);

  phase = "read the withheld turn after reload";
  await page.reload({ waitUntil: "domcontentloaded" });
  const [row] = await withheldRows(page, 1);
  assert.deepEqual(row, before, "The recorded first turn changed after reload");
  assert.equal(row.turnIndex, 0);
  assert.equal(row.reply, "withheld");
  assert.equal(row.decisionModel ?? null, null);
  assert.equal(row.draftAttempts, 0);
  assert.equal(row.pairReviews?.length ?? 0, 0);
  assert.deepEqual(row.decisionFailure, { stage: "planning", reason: "backend-unauthorized", detail: "relay-origin-denied", configuredModel: judge });

  phase = "compare the Settings export with WebMCP";
  await page.goto(origin + "/chat?settings=diagnostics", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Interface use", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Data source" }).selectOption("browser");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export trace", exact: true }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.deepEqual(exported.turns, [row], "Settings and WebMCP returned different turns");
  assert.equal(injected, 1);
  assert.equal(unexpectedDecisions, 0, "Expected exactly one planning request and no other decision requests");
  console.log(JSON.stringify({ status: "passed", origin, injected, credentialEntryAttempts, blockedChatProxyRequests, reply: row.reply,
    turnIndex: row.turnIndex, draftAttempts: row.draftAttempts, decisionFailure: row.decisionFailure, persistedAfterReload: true, settingsExportMatched: true }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", origin, phase, injected, blockedChatProxyRequests, unexpectedDecisions, error: error.message.split("\n")[0] }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
