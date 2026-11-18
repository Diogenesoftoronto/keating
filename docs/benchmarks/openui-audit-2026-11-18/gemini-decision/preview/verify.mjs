// Offline browser check. Run `rtk bun docs/benchmarks/openui-audit-2026-11-18/gemini-decision/preview/verify.mjs`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseOpenUIMessageSegments } from "../../../../../web/src/keating/openui/segments.ts";

const directory = import.meta.dir;
const { chromium } = createRequire(resolve(directory, "../../../../../spikes/flue-host/package.json"))("playwright-core");
const url = pathToFileURL(resolve(directory, "minimax-interfaces.html")).href;
const clean = text => text.replace(/\s+/gu, " ").trim();

async function exactReply(section, key, words) {
  const receipt = JSON.parse(readFileSync(resolve(directory, `../turn-receipts/MiniMax-M2.7-highspeed--${key}.json`), "utf8"));
  assert.equal(await section.locator("pre").textContent(), receipt.public.text);
  const prose = parseOpenUIMessageSegments(receipt.public.text).filter(s => s.type === "text");
  assert.deepEqual((await section.locator(".reply-prose").allInnerTexts()).map(clean), prose.map(s => clean(s.content.replaceAll("**", ""))));
  assert.equal(await section.locator("[data-release-meta]").innerText(), `Released draft 2 · ${words} words outside the interface`);
}

async function exerciseSpinner(section) {
  const group = section.locator('[data-canonical-node="question-group"] [data-question-group]');
  await group.waitFor();
  await exactReply(section, "spinner", 14);
  assert.equal(await group.getByRole("radio").count(), 3);
  assert.equal(await group.getByRole("textbox").count(), 1);
  const next = group.getByRole("button", { name: "Next" });
  assert.equal(await next.isDisabled(), true);
  await group.getByText("Blue again", { exact: true }).click();
  await next.click();
  assert.equal(await group.getByRole("textbox", { name: "Your answer", exact: true }).count(), 1);
  const finish = group.getByRole("button", { name: "Finish check" });
  assert.equal(await finish.isDisabled(), true);
  await group.getByRole("textbox").fill("The wedge counts are unknown.");
  await finish.click();
  await group.getByText("Check complete", { exact: true }).waitFor();
  await section.getByRole("button", { name: "Try another answer" }).click();
  await group.getByRole("textbox", { name: "Your own answer" }).fill("I would need to see the spinner.");
  await next.click();
  await group.getByRole("textbox").fill("I don't know its geometry.");
  await finish.click();
  await group.getByText("Check complete", { exact: true }).waitFor();
}

async function exerciseBus(page, section) {
  const sim = section.locator('[data-canonical-node="simulation"] [data-simulation]');
  await sim.waitFor();
  await exactReply(section, "bus", 97);
  assert.equal(await section.locator(".reply-prose strong").textContent(), "Share what I found");
  assert.equal(await sim.getByRole("slider").count(), 3);
  assert.equal(await sim.getByRole("combobox").count(), 2);
  assert.equal(await sim.locator("[data-simulation-readout]").count(), 3);
  assert.equal(await sim.locator('textarea,input:not([type="range"]):not([type="hidden"])').count(), 0);
  const frequency = sim.getByRole("slider", { name: "Buses per hour (buses)", exact: true });
  const seats = sim.getByRole("slider", { name: "Seats per bus (seats)", exact: true });
  const load = sim.getByRole("slider", { name: "Average load factor (%)", exact: true });
  const across = sim.getByRole("combobox", { name: "Graph horizontal axis" });
  const watch = sim.getByRole("combobox", { name: "Graph output" });
  assert.equal(await across.innerText(), "Average load factor (%)");
  assert.equal(await watch.innerText(), "Seats available per hour (unoccupied) (seats)");
  await across.click();
  await page.getByRole("option", { name: "Buses per hour (buses)", exact: true }).click();
  await watch.click();
  await page.getByRole("option", { name: "Seats offered per hour (seats)", exact: true }).click();
  assert.equal(await sim.locator("figure").getAttribute("aria-label"), "Seats offered per hour (seats) against Buses per hour (buses)");
  const outputs = async () => Promise.all(["capacity", "occupied", "available"].map(async id => {
    const value = await sim.locator(`[data-simulation-readout="${id}"] dd`).textContent();
    return Number(value.match(/^\d+/u)[0]);
  }));
  assert.deepEqual([await frequency.inputValue(), await seats.inputValue(), await load.inputValue()], ["6", "40", "70"]);
  assert.deepEqual(await outputs(), [240, 168, 72]);
  await frequency.focus();
  for (let i = 0; i < 2; i++) await frequency.press("ArrowRight");
  assert.equal(await frequency.inputValue(), "8");
  assert.deepEqual(await outputs(), [320, 224, 96]);
  for (let i = 0; i < 8; i++) await frequency.press("ArrowRight");
  assert.deepEqual([await frequency.inputValue(), await seats.inputValue(), await load.inputValue()], ["16", "40", "70"]);
  assert.deepEqual(await outputs(), [640, 448, 192]);
  await sim.locator("svg.recharts-surface").first().waitFor();
  assert.ok((await sim.locator("[data-simulation-plot]").boundingBox()).height > 80);
  await sim.getByRole("button", { name: "Reset simulation" }).click();
  assert.deepEqual(await outputs(), [240, 168, 72]);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1365, height: 960 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce", offline: true });
    const page = await context.newPage(), errors = [], external = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      window.previewCspViolations = [];
      document.addEventListener("securitypolicyviolation", e => window.previewCspViolations.push(e.blockedURI));
    });
    await page.route("**/*", route => {
      if (/^(?:file|blob|data):/u.test(route.request().url())) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    await page.getByRole("heading", { name: "MiniMax with Gemini Decision" }).waitFor();
    const section = page.locator("main>section:not([hidden])");
    const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await exerciseSpinner(section);
    assert.equal(await overflows(), false);
    await page.getByRole("link", { name: "Bus frequency" }).click();
    await exerciseBus(page, section);
    assert.equal(await overflows(), false);
    await page.getByRole("link", { name: "Spinner prediction" }).click();
    await section.getByText("Check complete", { exact: true }).waitFor();
    assert.deepEqual([errors, external, await page.evaluate(() => window.previewCspViolations)], [[], [], []]);
    console.log(`${viewport.width}×${viewport.height}: both spinner input paths and 6/8/16-bus readouts passed; zero external requests or browser/CSP errors.`);
    await context.close();
  }
} finally { await browser.close(); }
