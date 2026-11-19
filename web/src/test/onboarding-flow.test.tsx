import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { INTAKE_PROMPTS } from "../keating/profile-intake";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// The browser dependency lives with the existing repository browser harness.
const spike = "spikes/flue-host/package.json";
const localSpike = resolve(import.meta.dir, "../../..", spike);
const packagePath = existsSync(resolve(localSpike, "../node_modules/playwright")) ? localSpike
  : resolve(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim(), "..", spike);
const { chromium } = createRequire(packagePath)("playwright");
let browser: Awaited<ReturnType<typeof chromium.launch>>;
let page: Awaited<ReturnType<typeof browser.newPage>>;
const fixture = "http://onboarding.local/";
beforeAll(async () => {
  const entry = resolve(import.meta.dir, "onboarding-fixture.tsx");
  const built = await Bun.build({
    entrypoints: [entry], target: "browser",
    files: { [entry]: `
      import { createRoot } from "react-dom/client";
      import { ChatOnboarding } from "../components/ChatOnboarding";
      import { loadDeclaredProfile, saveDeclaredProfile } from "../keating/learner-profile-store";
      if (!localStorage.getItem("keating:learner-profile:v2")) {
        saveDeclaredProfile({...loadDeclaredProfile(), pronouns:"they/them", interests:["chess"], weeklyMinutes:90, depth:"rigorous"});
      }
      const signal = (name, value) => document.body.dataset[name] = value;
      createRoot(document.body.appendChild(document.createElement("div"))).render(
        <ChatOnboarding isSignedIn={async () => false}
          onUseKeating={() => signal("model","selected")} onConnectAccount={() => signal("sign","opened")}
          onChooseModel={() => signal("picker","opened")} onComplete={goal => signal("complete",goal)} onSkip={() => signal("skip","yes")}/>
      );
    ` },
    plugins: [{
      name: "onboarding-fixture-adapters",
      setup(build) {
        // Keep the account, deck database and inference runtimes outside this component test.
        const doubles: Record<string, string> = {
          "../notorganic-provider": 'export const NOTORGANIC_DEFAULT_MODEL={id:"hosted",provider:"test",api:"test",name:"Hosted model"}',
          "../lib/model-catalog": 'export const modelKey = model => model.id',
          "../keating/onboarding-anki-import": 'export const describeAnkiImport=()=>"", importAnkiForOnboarding=async()=>({proposals:[]})',
          "../hooks/keating-storage": 'export const getInitPromise=async()=>{}, keatingStorage={}',
          "../keating/profile-intake": `
            export const INTAKE_PROMPTS = ${JSON.stringify(INTAKE_PROMPTS)}; export const verbatimIntakeFields = () => ({});
            export async function extractIntakeProposals() {
              if (!sessionStorage.getItem("retried")) { sessionStorage.setItem("retried","1"); throw Error("try again"); }
              await new Promise(resolve => window.addEventListener("finish-extraction",resolve,{once:true}));
              return {proposals:[{field:"interests",value:"music",source:"conversation",evidence:"I enjoy music"}]};
            }`,
        };
        build.onResolve({filter:/^\.\.\/(notorganic-provider|lib\/model-catalog|hooks\/keating-storage|keating\/profile-intake|keating\/onboarding-anki-import)$/}, args =>
          args.importer.endsWith("ChatOnboarding.tsx") || args.importer.endsWith("AnkiInterestImport.tsx") || args.importer.endsWith("ProfileIntakeChat.tsx")
            ? {path:args.path, namespace:"onboarding-adapter"} : undefined);
        build.onLoad({filter:/.*/,namespace:"onboarding-adapter"}, args => ({contents:doubles[args.path],loader:"js"}));
      },
    }],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const js = await built.outputs.find(output => output.path.endsWith(".js"))!.text();
  const css = await built.outputs.find(output => output.path.endsWith(".css"))!.text();
  const tokens = await Bun.file(resolve(import.meta.dir, "../../styled-system/styles.css")).text();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true });
  await page.route("**/*", (route: { request(): { url(): string }; fulfill(options: object): Promise<void>; abort(): Promise<void> }) => {
    const url = route.request().url();
    if (!url.startsWith(fixture)) return route.abort();
    if (url.endsWith("/fixture.js")) return route.fulfill({ contentType: "text/javascript", body: js });
    if (url.endsWith("/fixture.css")) return route.fulfill({ contentType: "text/css", body: tokens + css });
    if (url !== fixture) return route.abort();
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{font-size:130%}</style><link rel="stylesheet" href="/fixture.css"><body><script type="module" src="/fixture.js"></script>' });
  });
}, 30000);

beforeEach(async () => {
  await page.goto(fixture);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
});
afterAll(async () => { await browser?.close(); });
const button = (name: string) => page.getByRole("button", {name,exact:true});
const saved = (key: string) => page.evaluate((name: string) => JSON.parse(localStorage.getItem(name)!), key);

test("a signed-out phone learner finishes with their question and previously saved settings", async () => {
  await page.setViewportSize({width:390,height:844});
  await page.goto(fixture);
  await button("How does a bill become law?").click();
  await button("Continue").click();
  await button("Skip sign-in for now").click();
  await page.getByLabel("What should Keating call you?").fill("Sam");
  const tone = page.getByRole("radiogroup", {name:"Tone"});
  await tone.getByRole("radio", {name:"Warm"}).click();
  await button("Clear Tone").click();
  expect(await tone.getByRole("radio", {checked:true}).count()).toBe(0);
  expect(await tone.getByRole("radio", {name:"Warm"}).getAttribute("tabindex")).toBe("0");
  await tone.getByRole("radio", {name:"Warm"}).press("ArrowRight");
  expect(await tone.getByRole("radio", {name:"Neutral"}).getAttribute("aria-checked")).toBe("true");
  await button("Higher contrast").click();
  expect((await saved("keating:learner-profile:v2")).highContrast).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button("Continue").click();
  await page.getByRole("heading",{name:"You are set, Sam."}).waitFor();
  expect(await page.getByRole("textbox",{name:"Your first message"}).inputValue()).toBe("How does a bill become law?");
  expect(await page.getByRole("textbox",{name:"Your first message"}).getAttribute("readonly")).not.toBeNull();
  await button("Start chatting").click();
  expect(await page.locator("body").getAttribute("data-complete")).toBe("How does a bill become law?");
  expect(await saved("keating:learner-profile:v2")).toMatchObject({pronouns:"they/them",interests:["chess"],weeklyMinutes:90,depth:"rigorous"});
  expect((await saved("keating:onboarding:v1")).outcome).toBe("completed");
});

test("conversation rejects blank shortcuts, retries extraction, and saves accepted proposals before finishing", async () => {
  await page.goto(fixture);
  await page.evaluate(() => Object.assign(window, {SpeechRecognition:class {
    start() {}
    stop() { document.body.dataset.recogniser = "stopped"; }
  }}));
  await page.getByRole("button",{name:/Talk it through/}).click();
  await button("Continue").click();
  await button("Skip sign-in for now").click();
  await page.getByRole("textbox",{name:"Your answer"}).press("Control+Enter");
  expect(await page.getByRole("status").innerText()).toContain("Question 1 of 4");
  await button("Answer out loud").click();
  await button("Skip").click();
  expect(await page.locator("body").getAttribute("data-recogniser")).toBe("stopped");
  for (let i = 0; i < 2; i++) await button("Skip").click();
  await button("Skip and finish").click();
  await button("Try again").click();
  await page.getByText("Reading back what you told me…").waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("finish-extraction")));
  await button("Continue").click();
  await button("Keep").click();
  await button("Save 1").click();
  await page.reload();
  await page.getByRole("button",{name:"Start chatting"}).waitFor();
  expect((await saved("keating:learner-profile:v2")).interests).toEqual(["chess","music"]);
  await page.getByRole("heading",{name:/You are set/}).press("Escape");
  expect(await page.locator("body").getAttribute("data-skip")).toBe("yes");
  expect((await saved("keating:onboarding:v1")).outcome).toBe("skipped");
});
