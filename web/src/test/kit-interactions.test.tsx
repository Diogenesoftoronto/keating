import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AppBar } from "../design-system/kit";
import { renderWithRouter } from "./course-render";

// Use the repository's browser-test dependency. A memory-only build mounts the real story.
const spike = "spikes/flue-host/package.json";
const localSpike = resolve(import.meta.dir, "../../..", spike);
const packagePath = existsSync(resolve(localSpike, "../node_modules/playwright")) ? localSpike
  : resolve(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim(), "..", spike);
const { chromium } = createRequire(packagePath)("playwright");
let browser: Awaited<ReturnType<typeof chromium.launch>>;
let page: Awaited<ReturnType<typeof browser.newPage>>;
const fixture = "http://kit.local/";
beforeAll(async () => {
  const entry = resolve(import.meta.dir, "kit-fixture.tsx");
  const built = await Bun.build({
    entrypoints: [entry], target: "browser",
    files: { [entry]: `
      import { createRoot } from "react-dom/client";
      import { Light, Dark } from "../design-system/Kit.stories";
      const story = location.search === "?dark" ? Dark : Light;
      createRoot(document.body.appendChild(document.createElement("div"))).render(story.render());
    ` },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!built.success) throw new AggregateError(built.logs, "Kit story build failed");
  const js = await built.outputs.find(output => output.path.endsWith(".js"))!.text();
  const css = await built.outputs.find(output => output.path.endsWith(".css"))!.text();
  const tokens = await Bun.file(resolve(import.meta.dir, "../../styled-system/styles.css")).text();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true });
  await page.route("**/*", (route: { request(): { url(): string }; fulfill(options: object): Promise<void>; abort(): Promise<void> }) => {
    const url = route.request().url();
    if (!url.startsWith(fixture)) return route.abort();
    if (url.endsWith("/kit.js")) return route.fulfill({ contentType: "text/javascript", body: js });
    if (url.endsWith("/kit.css")) return route.fulfill({ contentType: "text/css", body: tokens + css });
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><link rel="stylesheet" href="/kit.css"><body><script type="module" src="/kit.js"></script>' });
  });
}, 30000);
beforeEach(async () => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "More" }).waitFor();
});
afterAll(async () => { await browser?.close(); });
const focused = () => page.locator(":focus").innerText();

test("Segmented wraps focus, selects one radio and describes its hint", async () => {
  const radios = page.getByRole("radiogroup", { name: "Readings" });
  await radios.getByRole("radio", { name: "All" }).press("ArrowLeft");
  expect(await focused()).toBe("Saved");
  expect(await radios.getByRole("radio", { checked: true }).getAttribute("tabindex")).toBe("0");
  expect(await radios.getByRole("radio", { checked: false }).getAttribute("tabindex")).toBe("-1");
  const description = await radios.getAttribute("aria-describedby");
  expect(await page.locator(`[id="${description}"]`).innerText()).toBe("Readings you pinned.");
  await page.keyboard.press("ArrowDown");
  expect(await focused()).toBe("All");
  expect(await radios.getAttribute("aria-describedby")).toBeNull();
});

test("Tabs synchronize focus, underline and panel on arrows, Home and End", async () => {
  const tabs = page.getByRole("tablist", { name: "Workshop" });
  await tabs.getByRole("tab", { name: "Reading" }).focus();
  for (const [key, panel] of [["ArrowRight", "notes"], ["End", "group"], ["Home", "reading"], ["ArrowLeft", "group"]]) {
    await page.keyboard.press(key);
    const active = tabs.getByRole("tab", { selected: true });
    expect(await active.getAttribute("id")).toBe(await page.locator(":focus").getAttribute("id"));
    expect(await active.getAttribute("aria-controls")).toBe(panel);
    expect(await active.locator(".k-underline").count()).toBe(1);
    expect(await page.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(panel + "-tab");
    expect(await tabs.locator('[tabindex="0"]').count()).toBe(1);
  }
});

test("Sheet opens modally, ignores content clicks and returns focus after Escape and backdrop", async () => {
  const opener = page.getByRole("button", { name: "Add note" });
  for (const reason of ["Escape", "backdrop"]) {
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Reading note" });
    expect(await dialog.evaluate((node: Element) => node.matches(":modal"))).toBe(true);
    await dialog.getByLabel("Passage").click();
    if (reason === "Escape") await page.keyboard.press("Escape");
    else await page.mouse.click(1, 1);
    await dialog.waitFor({ state: "hidden" });
    expect(await focused()).toBe("Add note");
  }
});

test("Menu skips disabled actions, wraps and restores trigger focus", async () => {
  const trigger = page.getByRole("button", { name: "Actions" });
  await trigger.press("ArrowUp");
  expect(await focused()).toBe("Pin reading");
  await page.keyboard.press("ArrowDown");
  expect(await focused()).toBe("Edit note");
  await page.keyboard.press("Escape");
  expect(await focused()).toBe("Actions");
  expect(await trigger.getAttribute("aria-expanded")).toBe("false");
});

test("AppMenu exposes destinations and theme action, and dismisses on outside press", async () => {
  const trigger = page.getByRole("button", { name: "More" });
  await trigger.press("ArrowDown");
  const entries = page.getByRole("menuitem");
  expect(await entries.allTextContents()).toEqual(["Chat", "Courses", "Rooms", "Learning activity", "Reviews", "Settings", "Dark mode"]);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  expect(await page.locator("html").getAttribute("class")).toContain("dark");
  await trigger.click();
  await page.getByText("Assigned reading").click();
  expect(await trigger.getAttribute("aria-expanded")).toBe("false");
  expect(await trigger.evaluate((node: Element) => document.activeElement === node)).toBe(true);
});

test("Busy Button is disabled and AppBar renders its back destination", async () => {
  const busy = page.getByRole("button", { name: "Saving" });
  expect(await busy.isDisabled()).toBe(true);
  expect(await busy.getAttribute("aria-busy")).toBe("true");
  const markup = await renderWithRouter(<AppBar title="Workspace" back={{ label: "Courses", to: "/courses" }} menu={false}/>);
  expect(markup).toContain('href="/courses"');
  expect(markup).toContain(">Courses<");
});

test("Both themes retain focus outlines, high contrast and coarse-pointer targets", async () => {
  for (const suffix of ["", "?dark"]) {
    await page.goto(fixture + suffix);
    const button = page.getByRole("button", { name: "Add note" });
    await button.waitFor();
    expect(await page.locator("html").evaluate((node: Element) => node.classList.contains("dark"))).toBe(suffix === "?dark");
    // The theme class lands after first paint, so let the colour transition finish before sampling.
    expect(await button.evaluate(async (node: HTMLElement) => {
      await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => undefined)));
      return getComputedStyle(node).backgroundColor;
    })).toBe(suffix ? "rgb(75, 227, 136)" : "rgb(20, 116, 60)");
    await page.evaluate(() => { document.documentElement.dataset.highContrast = "true"; });
    expect(await button.evaluate((node: HTMLElement) => {
      const style = getComputedStyle(node);
      return style.borderTopColor === style.color;
    })).toBe(true);
    for (const box of await page.locator(".k-button,.k-icon,button.k-chip,.k-seg button,.k-tabs button,.k-find input").evaluateAll(
      (nodes: HTMLElement[]) => nodes.filter(node => node.checkVisibility()).map(node => node.getBoundingClientRect().toJSON())
    )) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("tab", { name: "Reading" }).press("ArrowRight");
    expect(await page.locator(":focus").evaluate((node: HTMLElement) => getComputedStyle(node).outlineStyle)).toBe("solid");
  }
});

test("Tab underline slides with motion and snaps with either reduced-motion preference", async () => {
  for (const mode of ["motion", "learner", "os"]) {
    await page.emulateMedia({ reducedMotion: mode === "os" ? "reduce" : "no-preference" });
    await page.evaluate((saved: boolean) => { document.documentElement.dataset.reduceMotion = String(saved); }, mode === "learner");
    const reading = page.getByRole("tab", { name: "Reading" });
    await reading.click();
    await page.waitForFunction(() => {
      const mark = document.querySelector(".k-underline")!;
      return Math.abs(mark.getBoundingClientRect().left - mark.parentElement!.getBoundingClientRect().left) < 1;
    });
    const offsets = await page.evaluate(async () => {
      document.getElementById("group-tab")!.click();
      const offsets: number[] = [];
      for (let i = 0; i < 8; i++) {
        await new Promise(requestAnimationFrame);
        const line = document.querySelector(".k-underline")!;
        offsets.push(Math.abs(line.getBoundingClientRect().left - line.parentElement!.getBoundingClientRect().left));
      }
      return offsets;
    });
    if (mode === "motion") expect(offsets.some((offset: number) => offset > 1)).toBe(true);
    else expect(Math.max(...offsets)).toBeLessThan(1);
  }
});
