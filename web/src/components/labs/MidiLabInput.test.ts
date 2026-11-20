import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";

test("MIDI opt-in, filtering, recovery and the on-screen keyboard", async () => {
  const root = resolve(import.meta.dir, "../../..");
  const { chromium } = createRequire(resolve(root, "../spikes/flue-host/package.json"))("playwright");
  const outDir = await mkdtemp(join(tmpdir(), "keating-midi-input-"));
  const browser = await chromium.launch();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response('<div id="root"></div><script type="module" src="/main.js"></script>', {
      headers: { "Content-Type": "text/html" },
    });
    return new Response(Bun.file(join(outDir, path)));
  } });
  try {
    const entry = "virtual:midi-harness";
    await build({
      root, configFile: false, publicDir: false, logLevel: "silent",
      esbuild: { jsx: "automatic" }, plugins: [{
        name: "midi-harness", resolveId(id) { if (id === entry) return "\0" + entry; },
        load(id) {
          if (id !== "\0" + entry) return;
          return `import { createElement } from "react"; import { createRoot } from "react-dom/client";
            import { MidiLabInput } from "/src/components/labs/MidiLabInput.tsx";
            const root = createRoot(document.querySelector("#root"));
            const onNote = (note, input) => window.attempts.push(input + "/" + note);
            window.attempts = [];
            window.showInput = disabled => root.render(createElement(MidiLabInput, {notes:[60,127], disabled, onNote}));
            window.showInput(false);`;
        },
      }], build: { outDir, rollupOptions: { input: entry, output: { entryFileNames: "main.js" } } },
    });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      class Input extends EventTarget {
        state = "connected";
        opens = 0;
        closes = 0;
        constructor(public id: string, public name: string) { super(); }
        async open() { this.opens++; return this; }
        async close() { this.closes++; return this; }
        emit(bytes: number[]) {
          const event = Object.assign(new Event("midimessage"), { data: new Uint8Array(bytes) });
          this.dispatchEvent(event);
        }
      }
      const a = new Input("a", "Piano A");
      const b = new Input("b", "Piano B");
      const access = Object.assign(new EventTarget(), { inputs: new Map([[a.id, a], [b.id, b]]) });
      const fixture = { a, b, access, calls: [] as { sysex: boolean }[] };
      Object.assign(window, { midiFixture: fixture });
      Object.defineProperty(navigator, "requestMIDIAccess", { value: async (opts: {sysex:boolean}) => {
        fixture.calls.push(opts);
        return access;
      } });
    });
    await page.goto(server.url.href);
    await page.getByRole("button", { name: "Play C4, MIDI 60" }).click();
    expect(await page.evaluate("window.attempts")).toEqual(["screen/60"]);
    expect(await page.evaluate("window.midiFixture.calls")).toEqual([]);
    await page.getByRole("combobox", { name: /Octave/ }).selectOption("10");
    await page.getByRole("button", { name: "Play G9, MIDI 127" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Connect MIDI" }).click();
    expect(await page.evaluate("window.midiFixture.calls")).toEqual([{ sysex: false }]);
    expect(await page.evaluate("window.midiFixture.a.opens")).toBe(0);
    await page.getByLabel("MIDI input").selectOption("a");
    await page.waitForFunction("window.midiFixture.a.opens === 1");
    await page.evaluate(`midiFixture.b.emit([0x90,72,127]); midiFixture.a.emit([0x80,60,60]);
      midiFixture.a.emit([0x91,64,0]); midiFixture.a.emit([0xb0,64,127]); midiFixture.a.emit([0x92,67,90]);`);
    expect(await page.evaluate("window.attempts")).toEqual(["screen/60", "screen/127", "device/67"]);
    await page.evaluate('midiFixture.a.state="disconnected"; midiFixture.access.dispatchEvent(new Event("statechange"))');
    await page.getByText("The selected input disconnected.", { exact: false }).waitFor();
    expect(await page.getByLabel("MIDI input").inputValue()).toBe("");
    await page.evaluate("midiFixture.a.emit([0x90,77,99])");
    await page.getByLabel("MIDI input").selectOption("b");
    await page.waitForFunction("midiFixture.b.opens === 1");
    await page.getByRole("button", { name: "Disconnect MIDI" }).click();
    await page.waitForFunction("midiFixture.b.closes === 1");
    await page.evaluate("midiFixture.b.emit([0x90,79,90])");
    await page.getByRole("button", { name: "Connect MIDI" }).click();
    await page.getByLabel("MIDI input").selectOption("b");
    await page.waitForFunction("midiFixture.b.opens === 2");
    await page.evaluate("showInput(true)");
    await page.waitForFunction("midiFixture.b.closes === 2");
    await page.evaluate("midiFixture.b.emit([0x90,80,90])");
    expect(await page.evaluate("window.attempts")).toEqual(["screen/60", "screen/127", "device/67"]);
    expect(await page.getByRole("button", { name: "Connect MIDI" }).isDisabled()).toBe(true);
  } finally {
    await browser.close();
    server.stop(true);
    await rm(outDir, { recursive: true, force: true });
  }
}, 60_000);
