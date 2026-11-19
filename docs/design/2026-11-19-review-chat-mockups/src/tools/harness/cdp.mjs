// Minimal CDP driver: node cdp.mjs <file.html> <width> <height> <script.json>
// script: [{wait:ms}|{shot:"out.png",clip?:[x,y,w,h]}|{move:[x,y]}|{click:[x,y]}|{eval:"js"}|{reduce:true}]
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
const [file, w = "1200", h = "800", scriptPath] = process.argv.slice(2);
const steps = scriptPath ? JSON.parse(readFileSync(scriptPath, "utf8")) : [{ wait: 2500 }];
const HS = process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
const port = 9400 + Math.floor(Math.random() * 400);
const env = { ...process.env }; delete env.LD_LIBRARY_PATH;
const proc = spawn(HS, ["--headless", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--remote-debugging-port=${port}`, `--window-size=${w},${h}`, "--hide-scrollbars", "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2", "about:blank"], { env, stdio: "ignore" });
// Never leave a browser behind: a Keating page holds about 1 GB, and a step that throws used to orphan it.
const reap = () => { try { proc.kill("SIGKILL"); } catch {} };
process.on("exit", reap);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { reap(); process.exit(130); });
setTimeout(() => { console.error("cdp.mjs: timed out, closing the browser"); reap(); process.exit(124); }, +(process.env.CDP_TIMEOUT ?? 300000)).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(100); try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = l.find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d.error); pending.delete(d.id); } else if (d.method === "Runtime.consoleAPICalled") logs.push(d.params.args.map((a) => a.value ?? a.description ?? "").join(" ")); else if (d.method === "Runtime.exceptionThrown") logs.push("EXC " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "fine" }, { name: "hover", value: "hover" }, { name: "any-pointer", value: "fine" }, { name: "any-hover", value: "hover" }] });
await send("Page.navigate", { url: /^https?:/.test(file) ? file : "file://" + file });
if (/^https?:/.test(file)) await sleep(+(process.env.CDP_SETTLE ?? 3500));
await sleep(600);
for (const s of steps) {
  if (s.wait) await sleep(s.wait);
  if (s.resize) await send("Emulation.setDeviceMetricsOverride", { width: s.resize[0], height: s.resize[1], deviceScaleFactor: 1, mobile: false });
  if (s.reduce) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  if (s.move) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.move[0], y: s.move[1], pointerType: "mouse" });
  if (s.click) { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: s.click[0], y: s.click[1], button: "left", clickCount: 1 }); }
  if (s.scrollTo) await send("Runtime.evaluate", { expression: `(()=>{const e=${s.find ?? `document.querySelector(${JSON.stringify(s.scrollTo)})`};const r=e.getBoundingClientRect();window.scrollTo(0,window.scrollY+r.top-(${s.top ?? 80}));})()` });
  if (s.hoverSel || s.clickSel) {
    const sel = s.hoverSel ?? s.clickSel;
    const r = await send("Runtime.evaluate", { expression: `(()=>{const e=${s.find ?? `document.querySelector(${JSON.stringify(sel)})`};if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];})()`, returnByValue: true });
    const p = r.result?.value; if (!p) logs.push("NOT FOUND " + sel);
    else { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1], pointerType: "mouse" }); if (s.clickSel) { await sleep(60); for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p[0], y: p[1], button: "left", clickCount: 1 }); } }
  }
  if (s.dragFrom) {
    const pt = async (expr) => (await send("Runtime.evaluate", { expression: `(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height*(${s.fy ?? 0.5})];})()`, returnByValue: true })).result?.value;
    const a = await pt(s.dragFrom), b = await pt(s.dragTo);
    if (!a || !b) logs.push("DRAG NOT FOUND");
    else {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a[0], y: a[1] });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: a[0], y: a[1], button: "left", clickCount: 1 });
      const n = s.steps ?? 14;
      for (let i = 1; i <= n; i++) { const t = i / n, wob = s.shake ? Math.sin(i * 2.4) * 40 : 0; await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a[0] + (b[0] - a[0]) * t + wob, y: a[1] + (b[1] - a[1]) * t, button: "left", buttons: 1 }); await sleep(18); }
      if (s.hold) { for (let i = 0; i < 4; i++) { await sleep(s.hold / 4); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b[0], y: b[1], button: "left", buttons: 1 }); } }
      if (s.midShot) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(s.midShot, Buffer.from(r.data, "base64")); }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b[0], y: b[1], button: "left", clickCount: 1 });
    }
  }
  if (s.evalFile) s.eval = readFileSync(s.evalFile, "utf8");
  if (s.goto) { await send("Page.navigate", { url: s.goto }); await sleep(s.settle ?? 3500); }
  if (s.eval) { const r = await send("Runtime.evaluate", { expression: s.eval, awaitPromise: true, returnByValue: true }); logs.push("EVAL " + JSON.stringify(r.result?.value ?? r.exceptionDetails?.exception?.description ?? r)); }
  if (s.shot) { const p = { format: "png" }; if (s.clip) p.clip = { x: s.clip[0], y: s.clip[1], width: s.clip[2], height: s.clip[3], scale: s.scale ?? 1 }; if (s.full) p.captureBeyondViewport = true; const r = await send("Page.captureScreenshot", p); writeFileSync(s.shot, Buffer.from(r.data, "base64")); }
}
console.log(logs.join("\n"));
ws.close(); proc.kill();
