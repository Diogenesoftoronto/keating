import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const { chromium } = createRequire(resolve(import.meta.dir, "../../../../../spikes/flue-host/package.json"))("playwright-core");
export const localUrl = path => pathToFileURL(path).href;

export async function offlinePage(browser, viewport = { width: 1100, height: 880 }, reducedMotion = "reduce") {
  const context = await browser.newContext({ viewport, offline: true, reducedMotion });
  const page = await context.newPage();
  const errors = [], external = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    if (/^(?:file|blob|data):/u.test(route.request().url())) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    window.previewCsp = [];
    document.addEventListener("securitypolicyviolation", e => window.previewCsp.push(e.violatedDirective + " " + e.blockedURI));
  });
  return { page, context, async healthy() {
    assert.deepEqual({ errors, external, csp: await page.evaluate(() => window.previewCsp) }, { errors: [], external: [], csp: [] });
  } };
}

export async function opening(sim) {
  await sim.locator("svg.recharts-surface").first().waitFor();
  const data = await sim.locator("tbody tr").evaluateAll(rows =>
    rows.map(row => [...row.querySelectorAll("td")].map(cell => cell.textContent.trim())));
  assert.ok(data.length > 1 && data.every(cells => cells.length === 2));
  return {
    vary: await sim.getByRole("combobox", {name: "Graph horizontal axis"}).innerText(),
    watch: await sim.getByRole("combobox", {name: "Graph output"}).innerText(),
    points: data.length, distinctValues: new Set(data.map(row => row[1])).size,
    first: data[0], last: data.at(-1),
  };
}

/** Photograph the old player's own opening view before touching its controls. */
export async function archivedOpening(browser, file) {
  const { page, context, healthy } = await offlinePage(browser);
  try {
    await page.goto(localUrl(file) + "#bus");
    const sim = page.locator("main>section:not([hidden]) [data-simulation]");
    const view = await opening(sim);
    const image = await sim.locator("figure").screenshot({ animations: "disabled", type: "png" });
    await healthy();
    return { ...view, image: "data:image/png;base64," + image.toString("base64") };
  } finally { await context.close(); }
}
