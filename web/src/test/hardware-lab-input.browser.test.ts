import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("serial readings stay local until checked, and manual readings keep their own source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-serial-input-"));
  const entry = join(dir, "fixture.js");
  const require = createRequire(import.meta.url);
  const { chromium } = createRequire(resolve(import.meta.dir, "../../../spikes/flue-host/package.json"))("playwright");
  const browser = await chromium.launch();
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    await writeFile(entry, `
      import React from ${JSON.stringify(require.resolve("react"))};
      import {createRoot} from ${JSON.stringify(require.resolve("react-dom/client"))};
      import {HardwareLabInput} from ${JSON.stringify(resolve(import.meta.dir, "../components/labs/HardwareLabInput.tsx"))};
      const root = createRoot(document.querySelector("main"));
      window.samples = [];
      window.show = (unit, disabled=false) => root.render(React.createElement(HardwareLabInput, {
        baudRate: 9600, unit, disabled, onSample: (v,source) => window.samples.push([v,source])
      }));
      window.unmount = () => root.unmount();
      window.show("mV");
    `);
    const bundle = await Bun.build({entrypoints:[entry], target:"browser", define:{"process.env.NODE_ENV": '"production"'}});
    if (!bundle.success) throw new Error(bundle.logs.join("\n"));
    server = Bun.serve({hostname:"127.0.0.1",port:0,fetch(request) {
      return new URL(request.url).pathname === "/fixture.js"
        ? new Response(bundle.outputs[0], {headers:{"Content-Type":"text/javascript"}})
        : new Response('<main></main><script type="module" src="/fixture.js"></script>',{headers:{"Content-Type":"text/html"}});
    }});
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.addInitScript(() => {
      const win = window as unknown as {
        send: (s:string)=>void; portCloses: number; cancelled: number; opens:number[];
        unplug: ()=>void;
      };
      win.portCloses = 0; win.cancelled = 0; win.opens = [];
      Object.defineProperty(navigator, "serial", {configurable:true, value:{requestPort: async () => {
        const port = Object.assign(new EventTarget(), {
          readable: new ReadableStream<Uint8Array>({
            start(controller) { win.send = text => controller.enqueue(new TextEncoder().encode(text)); },
            cancel() { win.cancelled++; }
          }),
          async open(options: {baudRate:number}) { win.opens.push(options.baudRate); },
          async close() { win.portCloses++; }
        });
        win.unplug = () => port.dispatchEvent(new Event("disconnect"));
        return port;
      }}});
    });
    type Fixture = { send:(s:string)=>void; samples:Array<[number,string]>; portCloses:number; cancelled:number; opens:number[];
      unplug:()=>void; unmount:()=>void; show:(s:string)=>void };
    await page.goto(server.url.href);
    const device = page.getByRole("button", {name:"Check reading",exact:true});
    const manual = page.getByRole("button", {name:"Check manual reading",exact:true});
    const connect = page.getByRole("button", {name:"Connect device",exact:true});
    await connect.click();
    await device.waitFor();
    expect(await device.isDisabled()).toBe(true);
    await page.evaluate(() => (window as unknown as Fixture).send("9".repeat(80) + "\nNaN\n2."));
    expect(await device.isDisabled()).toBe(true);
    await page.evaluate(() => (window as unknown as Fixture).send("5\r\n"));
    await page.getByText("Device reading: 2.5 mV").waitFor();
    expect(await page.evaluate(() => (window as unknown as Fixture).samples)).toEqual([]);
    await device.click();
    await page.getByLabel("Manual reading (mV)").fill("-1e2"); await manual.click();
    expect(await page.evaluate(() => (window as unknown as Fixture).samples)).toEqual([[2.5,"device"],[-100,"manual"]]);
    await page.evaluate(() => (window as unknown as Fixture).unplug());
    await page.getByText("Device disconnected.").waitFor();
    await connect.click(); await device.waitFor();
    expect(await device.isDisabled()).toBe(true);
    await page.evaluate(() => (window as unknown as Fixture).show("V"));
    await connect.waitFor();
    await connect.click(); await device.waitFor();
    await page.getByRole("button", { name: "Disconnect device" }).click();
    await connect.click(); await device.waitFor();
    await page.evaluate(() => (window as unknown as Fixture).unmount());
    await page.waitForFunction(() => (window as unknown as Fixture).portCloses === 4);
    expect(await page.evaluate(() => (window as unknown as Fixture).cancelled)).toBe(4);

    await page.goto(server.url.href);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "serial", {configurable:true, value:undefined});
      (window as unknown as Fixture).show("V");
    });
    await page.getByText("Serial input is unavailable", {exact:false}).waitFor();
    expect(await connect.count()).toBe(0);
    await page.getByLabel("Manual reading (V)").fill("0"); await manual.click();
    expect(await page.evaluate(() => (window as unknown as Fixture).samples)).toEqual([[0,"manual"]]);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "serial", { configurable: true, value: {
        requestPort: async () => { throw new DOMException("No device", "NotFoundError"); }
      }});
      (window as unknown as Fixture).show("mV");
    });
    await connect.click();
    await page.getByText("No device selected.").waitFor();
    expect(await device.count()).toBe(0);
  } finally {
    server?.stop(true);
    await browser.close();
    await rm(dir,{recursive:true,force:true});
  }
}, 30_000);
