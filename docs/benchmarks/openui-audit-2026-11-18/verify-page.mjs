import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(import.meta.dir, "../../..");
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === "--built"), "Use --built to check the Vite and Nitro output");
const publicDir = resolve(root, args.length ? "web/.output/public" : "web/public");
const website = resolve(publicDir, "reports/teaching-interfaces");
if (args.length) {
  // Capture the options Workbox actually gives its navigation fallback in the emitted worker.
  const vm = await import("node:vm");
  let denylist;
  const workbox = new Proxy({
    NavigationRoute: class { constructor(_handler, options) { denylist = options.denylist; } },
  }, { get: (target, key) => target[key] ?? function () {} });
  const define = (_dependencies, register) => register(workbox);
  vm.runInNewContext(readFileSync(resolve(publicDir, "sw.js"), "utf8"), {
    self: { define, addEventListener() {}, skipWaiting() {} }, define, importScripts() {},
  });
  const bypassesShell = path => denylist.some(rule => rule.test(path));
  assert(bypassesShell("/reports/teaching-interfaces/index.html"));
  assert(bypassesShell("/reports/teaching-interfaces/diagnostics.html?source=episodes&view=unmet"));
  assert(bypassesShell("/api/judgement"));
  assert(!bypassesShell("/chat"));
  console.log("The built navigation fallback keeps the report on its own URL and chat on the app shell.");
}
const { chromium } = createRequire(resolve(root, "spikes/flue-host/package.json"))("playwright-core");
const latest = JSON.parse(execFileSync("bun", [
  "src/cli/main.ts", "openui-diagnostics", resolve(website,"traces/policy-v2.3.json"),
], {cwd:root,encoding:"utf8"})).overall;
assert.deepEqual(latest.learnerActionSelected, {numerator:3,denominator:3,unknown:1,rate:1});
assert.equal(latest.editableCode.any.numerator,2);
const cases = [
  { source: "audit", recording: "november-audit", expected: 6, size: 20 },
  { source: "episodes", recording: "terminal-episodes", expected: 34, size: 804 },
];
for (const study of cases) {
  const raw = execFileSync("bun", [
    "src/cli/main.ts", "openui-diagnostics", resolve(website, "traces", study.recording + ".json"),
    "--cue", "implicit-action", "--view", "unmet", "--limit", "1",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(JSON.parse(raw).matchingTurns, study.expected);
}

const browser = await chromium.launch();
try {
  if (args.length) await verifySettingsLink(browser);
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 840 }, offline: true, reducedMotion: "reduce",
      colorScheme: width === 390 ? "dark" : "light",
    });
    const page = await context.newPage();
    const errors = [], external = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:/i, route => {
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(resolve(website, "index.html")).href);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    const links = await page.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.href));
    for (const url of links.filter(link => link.startsWith("file:"))) {
      assert(existsSync(fileURLToPath(url)), "Missing linked file " + url);
    }
    const firstDisclosure = page.locator("details").first();
    const wasOpen = await firstDisclosure.evaluate(node => node.open);
    await firstDisclosure.locator("summary").first().click();
    assert.equal(await firstDisclosure.evaluate(node => node.open), !wasOpen);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("link", { name: /offline inspector/i }).first().click();
    for (const study of cases) {
      const sources = page.getByLabel("Data source");
      if (await sources.inputValue() !== study.source) await sources.selectOption(study.source);
      await page.locator(".ou-drill > summary b").filter({ hasText: String(study.size) }).waitFor();
      await page.getByLabel("Learner cue").selectOption("implicit-action");
      const drill = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Inspect turns/ }) }).first();
      const filter = page.getByLabel("Show turns");
      if (!(await filter.isVisible())) await drill.locator("summary").first().click();
      await filter.selectOption("unmet");
      await drill.getByText(new RegExp("^" + study.expected + " missed on this turn")).waitFor();
      assert(await drill.locator("details").count() > 0);
    }
    const directLink = links.find(url => url.includes("source=episodes") && url.includes("view=unmet"));
    assert(directLink, "The article must link to the September missed-cue view");
    await page.goto(directLink);
    await page.getByText(/^34 missed on this turn/).waitFor();
    assert.equal(await page.getByLabel("Learner cue").inputValue(), "implicit-action");
    assert.equal(await page.getByLabel("Show turns").inputValue(), "unmet");
    const finalLink = links.find(url => url.includes("diagnostics.html?source=final") && url.includes("view=action-unmet"));
    assert(finalLink,"The article must link to the completed final-policy recording");
    await page.goto(finalLink);
    assert.equal(await page.getByLabel("Data source").inputValue(),"final");
    const finalDrill = page.locator("details").filter({has:page.locator("summary",{hasText:/^Inspect turns/})}).first();
    assert.equal(await page.getByLabel("Show turns").inputValue(), "action-unmet");
    await finalDrill.getByText("0 missed on this turn out of 3 with a known outcome · 1 unknown.").waitFor();
    await page.getByLabel("Show turns").selectOption("editable-code");
    await finalDrill.getByText(/^2 matching turns$/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(width + "px: article links, original missed cues, and both final Python editors match the CLI; zero external requests or page errors.");
    await context.close();
  }
} finally {
  await browser.close();
}

async function verifySettingsLink(browser) {
  const server = spawn("node", [resolve(root, "web/.output/server/index.mjs")], {
    cwd:resolve(root,"web"), env:{PATH:process.env.PATH,NITRO_HOST:"127.0.0.1",NITRO_PORT:"0",NODE_ENV:"production"},
    stdio:["ignore","pipe","pipe"],
  });
  const exited = once(server, "exit");
  try {
    const origin = await new Promise((ready, fail) => {
      const timeout = setTimeout(() => fail(Error("The local Nitro build did not start")), 15000);
      const onOutput = chunk => {
        const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) { clearTimeout(timeout); ready(url); }
      };
      server.stdout.on("data", onOutput);
      server.stderr.on("data", onOutput);
      server.once("exit", () => { clearTimeout(timeout); fail(Error("The local Nitro build exited")); });
    });
    const context = await browser.newContext({serviceWorkers:"block"});
    await context.route("**/*", route => new URL(route.request().url()).origin === origin && route.request().method() === "GET"
      ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(origin + "/chat?settings=diagnostics&source=final&view=action-unmet");
    await page.getByText("0 missed on this turn out of 3 with a known outcome · 1 unknown.").waitFor();
    assert.equal(await page.getByLabel("Data source").inputValue(),"final");
    assert.equal(await page.getByLabel("Show turns").inputValue(),"action-unmet");
    const link = page.getByRole("link",{name:"How Keating chooses a teaching interface"});
    const [guide] = await Promise.all([context.waitForEvent("page"),link.click()]);
    await guide.getByRole("heading",{level:1}).waitFor();
    await guide.locator('a[href*="source=episodes"][href*="view=unmet"]').first().click();
    await guide.getByText(/^34 missed on this turn/).waitFor();
    await page.goto(origin+"/chat?settings=diagnostics&source=review&cue=implicit-action&view=draft-loss");
    await page.getByText("2 matching turns",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("Data source").inputValue(),"review");
    assert.equal(await page.getByLabel("Show turns").inputValue(),"selection");
    await page.getByLabel("Decision model").selectOption("jev-1.14.0");
    await page.getByText("1 matching turn",{exact:true}).waitFor();
    await page.goto(origin+"/chat?settings=diagnostics&source=assessment-opt-out&view=assessment-opt-out");
    await page.getByText("2 matching turns",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("Show turns").inputValue(),"assessment-opt-out");
    await context.close();
    console.log("Chat Settings opened the requested four-turn filter and linked through the field guide to the 34 historical misses.");
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGTERM");
    await exited;
  }
}
