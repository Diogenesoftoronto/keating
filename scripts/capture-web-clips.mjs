// Record the current web UI with headless Chrome and a loopback demo provider.
// Usage: bun scripts/capture-web-clips.mjs [--base=http://localhost:3000] [--only=web-landing,...] [--out=docs/assets]

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const frameRoot = join(root, ".keating/outputs/video/frames");
const children = new Set();

export function isLoopback(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function frameTimeline(frames) {
  if (!frames.length) throw new Error("Chrome produced no screencast frames");
  const lines = ["ffconcat version 1.0"];
  let duration = 0;
  frames.forEach((frame, index) => {
    if (!Number.isFinite(frame.timestamp)) throw new Error("Missing screencast timestamp");
    const seconds = index + 1 < frames.length ? frames[index + 1].timestamp - frame.timestamp : 1;
    if (!(seconds > 0)) throw new Error("Screencast timestamps must increase");
    if (!/^frame_\d{5}\.jpg$/.test(frame.file)) throw new Error("Invalid frame filename");
    lines.push(`file '${frame.file}'`, "option framerate 1000000", `duration ${seconds.toFixed(6)}`);
    duration += seconds;
  });
  lines.push(`file '${frames.at(-1).file}'`, "option framerate 1000000");
  return { concat: `${lines.join("\n")}\n`, duration };
}

export async function until(check, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`Timed out after ${timeout} ms: ${label}`);
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...options });
  children.add(child);
  child.output = "";
  child.stdout?.on("data", (data) => { child.output = (child.output + data).slice(-16000); });
  child.stderr?.on("data", (data) => { child.output = (child.output + data).slice(-16000); });
  child.done = new Promise((resolve, reject) => {
    child.once("error", (error) => { children.delete(child); reject(error); });
    child.once("exit", (code, signal) => { children.delete(child); resolve({ code, signal }); });
  });
  child.done.catch(() => {});
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([child.done, sleep(3000)]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
  await child.done;
}

async function run(command, args) {
  const child = start(command, args);
  const result = await child.done;
  if (result.code !== 0) throw new Error(`${command} failed: ${child.output}`);
  return child.output.trim();
}

class CDP {
  id = 0;
  pending = new Map();
  listeners = new Map();

  async connect(url) {
    this.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Cannot connect to Chrome CDP")), { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
      }
    });
    this.socket.addEventListener("close", () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Chrome disconnected during ${entry.method}`));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`Chrome disconnected during ${method}`));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after 30000 ms: CDP ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method).delete(listener);
  }
}

function findElement({ selector, text }) {
  const visible = (element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
  if (selector) return [...document.querySelectorAll(selector)].find(visible);
  const elements = [...document.querySelectorAll("body *")].filter(visible);
  return elements.find((element) => element.textContent.trim() === text)
    ?? elements.reverse().find((element) => element.textContent.includes(text));
}

function routeLocalProvider(providerUrl) {
  const fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const targetBase = request.headers.get("x-target-url");
    if (url.origin === location.origin && url.pathname.startsWith("/api/chat-proxy/")
      && [providerUrl, `${providerUrl}/v1`].includes(targetBase)) {
      const target = `${targetBase}${url.pathname.slice("/api/chat-proxy".length)}${url.search}`;
      return fetch(new Request(target, request));
    }
    return fetch(request);
  };
}

async function record(cdp, clip, base, out, providerUrl) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  let fatal;
  const listeners = [];
  const frames = [];
  const writes = [];
  const diagnostics = [];
  let recording = false;
  const directory = join(frameRoot, clip.name);
  const width = clip.width ?? 1920;
  const height = clip.height ?? 1080;
  const evaluate = async (js) => {
    if (fatal) throw fatal;
    const result = await send("Runtime.evaluate", { expression: `(async () => { ${js}\n })()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const find = (step) => `(${findElement.toString()})(${JSON.stringify(step)})`;
  const waitFor = (step) => until(
    () => evaluate(`return Boolean(${find(step)});`), step.timeout ?? 15000,
    `waitFor ${step.selector ?? JSON.stringify(step.text)}`,
  );
  const settle = async () => {
    await until(() => evaluate("return document.readyState === 'complete' && !!document.querySelector('main, textarea, [contenteditable=true]');"), 30000, "page content");
    await evaluate("await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));");
  };
  const navigate = async (path, reload = false) => {
    const url = new URL(path, base).href;
    if (!isLoopback(url)) throw new Error(`Non-local navigation refused: ${url}`);
    const { frameTree } = await send("Page.getFrameTree");
    const loaded = new Set();
    const unsubscribe = cdp.on("Page.lifecycleEvent", (event, session) => {
      if (session === sessionId && event.frameId === frameTree.frame.id && event.name === "load") loaded.add(event.loaderId);
    });
    try {
      const result = await send(reload ? "Page.reload" : "Page.navigate", reload ? { ignoreCache: true } : { url });
      if (result.errorText) throw new Error(`Navigation failed: ${result.errorText} (${url})`);
      if (reload || result.loaderId) await until(() => {
        if (fatal) throw fatal;
        return reload ? [...loaded].some((id) => id !== frameTree.frame.loaderId) : loaded.has(result.loaderId);
      }, 30000, `page load ${url}`);
      await settle();
    } finally { unsubscribe(); }
  };
  try {
    await mkdir(directory, { recursive: true });
    for (const file of await readdir(directory)) {
      if (/^frame_\d{5}\.jpg$/.test(file)) await rm(join(directory, file));
    }
    listeners.push(cdp.on("Fetch.requestPaused", (event, session) => {
      if (session !== sessionId) return;
      const url = new URL(event.request.url);
      const target = event.request.headers["x-target-url"];
      const localProxy = providerUrl && url.origin === new URL(base).origin
        && url.pathname.startsWith("/api/chat-proxy/") && target === providerUrl;
      const runtimeConfig = url.origin === new URL(base).origin && url.pathname === "/api/agent-runtime/config";
      const allowed = isLoopback(url.href) && (!url.pathname.startsWith("/api/") || localProxy || runtimeConfig);
      if (!allowed) diagnostics.push(`Blocked request: ${url.origin}${url.pathname}`);
      if (!allowed && event.resourceType === "Document") fatal = new Error(`Non-local or API navigation refused: ${url.origin}${url.pathname}`);
      send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed
        ? { requestId: event.requestId }
        : { requestId: event.requestId, errorReason: "BlockedByClient" }).catch((error) => { fatal ??= error; });
    }));
    listeners.push(cdp.on("Runtime.consoleAPICalled", (event, session) => {
      if (session !== sessionId || !["warning", "error"].includes(event.type)) return;
      diagnostics.push(event.args.map((arg) => arg.type === "string" ? arg.value : arg.subtype === "error" ? arg.description : "").join(" ").slice(0, 1500));
    }));
    listeners.push(cdp.on("Network.loadingFailed", (event, session) => {
      if (session === sessionId) diagnostics.push(`Request failed: ${event.errorText}${event.corsErrorStatus ? ` (${event.corsErrorStatus.corsError})` : ""}`);
    }));
    listeners.push(cdp.on("Page.screencastFrame", (event, session) => {
      if (session !== sessionId) return;
      send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch((error) => { fatal ??= error; });
      if (!recording) return;
      const timestamp = event.metadata.timestamp;
      if (frames.length && timestamp <= frames.at(-1).timestamp) return;
      const file = `frame_${String(frames.length).padStart(5, "0")}.jpg`;
      frames.push({ file, timestamp, metadata: event.metadata });
      writes.push(writeFile(join(directory, file), Buffer.from(event.data, "base64")).catch((error) => { fatal ??= error; }));
    }));
    await send("Page.enable");
    await cdp.send("Browser.grantPermissions", { permissions: ["durableStorage"], origin: new URL(base).origin, browserContextId });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__REACT_GRAB_DISABLED__ = true;" });
    // The app proxies custom providers; capture sends only our own provider directly for local CORS/SSE.
    if (providerUrl) await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${routeLocalProvider.toString()})(${JSON.stringify(providerUrl)});` });
    await send("Page.setLifecycleEventsEnabled", { enabled: true });
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Network.setBypassServiceWorker", { bypass: true });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: "light" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ] });
    await navigate(clip.steps[0].path);
    if (clip.seed) {
      await evaluate(`const providerUrl = ${JSON.stringify(providerUrl)}; ${clip.seed}`);
      await navigate(clip.steps[0].path, true);
    }
    recording = true;
    await send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    await until(() => { if (fatal) throw fatal; return frames.length > 0; }, 10000, "first screencast frame");
    for (const [index, step] of clip.steps.entries()) {
      if (index === 0) continue;
      if (fatal) throw fatal;
      try {
        switch (step.kind) {
          case "goto": await navigate(step.path); break;
          case "wait": await sleep(step.ms); break;
          case "waitFor": await waitFor(step); break;
          case "click": {
            await waitFor(step);
            const point = await evaluate(`const element = ${find(step)}; element.scrollIntoView({block:'nearest', behavior:'instant'}); const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
            await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
            break;
          }
          case "type":
            await waitFor(step);
            await evaluate(`${find(step)}.focus();`);
            for (const key of step.text) {
              await send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key });
              await send("Input.dispatchKeyEvent", { type: "keyUp", key });
              await sleep(step.delay ?? 50);
            }
            break;
          case "press": {
            const keys = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Space: 32, Home: 36, End: 35 };
            const parts = step.key.split("+");
            const key = parts.pop();
            const masks = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };
            const modifiers = parts.reduce((mask, part) => mask | (masks[part] ?? 0), 0);
            if (!(key in keys) && key.length !== 1) throw new Error(`Unsupported key: ${step.key}`);
            const event = { key: key === "Space" ? " " : key, modifiers, windowsVirtualKeyCode: keys[key] ?? key.toUpperCase().charCodeAt(0) };
            await send("Input.dispatchKeyEvent", { type: "keyDown", ...event, ...(key === "Enter" ? { text: "\r" } : {}) });
            await send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
            break;
          }
          case "scroll":
            if (typeof step.to === "string") await waitFor({ selector: step.to, timeout: step.timeout });
            await evaluate(`const to = ${JSON.stringify(step.to)}; const ms = ${step.ms ?? 1000};
              const start = scrollY; const max = document.scrollingElement.scrollHeight - innerHeight;
              const target = Math.max(0, Math.min(max, typeof to === 'number' ? to : document.querySelector(to).getBoundingClientRect().top + scrollY - 70));
              await new Promise(resolve => { const began = performance.now(); const tick = now => {
                const t = ms ? Math.min(1, (now - began) / ms) : 1;
                const eased = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
                scrollTo({top: start + (target-start)*eased, behavior:'instant'});
                if (t < 1) requestAnimationFrame(tick); else resolve();
              }; requestAnimationFrame(tick); });`);
            break;
          case "eval": await evaluate(step.js); break;
          default: throw new Error(`Unknown step kind: ${step.kind}`);
        }
      } catch (error) {
        throw new Error(`${clip.name} step ${index + 1} (${step.kind}): ${error.message}`);
      }
    }
    await send("Page.stopScreencast");
    recording = false;
    await Promise.all(writes);
    if (fatal) throw fatal;
    const { concat, duration } = frameTimeline(frames);
    await writeFile(join(directory, "frames.ffconcat"), concat);
    await writeFile(join(directory, "timestamps.json"), `${JSON.stringify(frames, null, 2)}\n`);
    const output = join(out, `${clip.name}.mp4`);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(directory, "frames.ffconcat"), "-vf", "fps=30,scale=in_range=pc:out_range=tv,format=yuv420p", "-t", duration.toFixed(6), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-color_range", "tv", "-movflags", "+faststart", output]);
    const seconds = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output]);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Number(seconds) / 2), "-i", output, "-frames:v", "1", "-update", "1", join(frameRoot, `${clip.name}-check.jpg`)]);
    console.log(`${clip.name}: ${frames.length} frames, ${seconds}s -> ${output}`);
  } catch (error) {
    await writeFile(join(frameRoot, `${clip.name}-diagnostics.json`), `${JSON.stringify(diagnostics, null, 2)}\n`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 }).catch(() => null);
    if (shot) await writeFile(join(frameRoot, `${clip.name}-failed.jpg`), Buffer.from(shot.data, "base64"));
    throw error;
  } finally {
    recording = false;
    await Promise.all(writes);
    for (const unsubscribe of listeners) unsubscribe();
    await cdp.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }
}

export async function main(args = process.argv.slice(2)) {
  for (const value of args) if (!/^--(base|only|out)=.+/.test(value)) throw new Error(`Unknown option: ${value}`);
  const arg = (name, fallback) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const base = arg("base", "http://localhost:3000");
  if (!isLoopback(base) || !["http:", "https:"].includes(new URL(base).protocol)) throw new Error("--base must be a loopback HTTP(S) URL without credentials");
  const out = resolve(root, arg("out", "docs/assets"));
  const all = JSON.parse(await readFile(join(root, "scripts/web-clips.json"), "utf8"));
  const only = arg("only", "").split(",").filter(Boolean);
  for (const name of only) if (!all.some((clip) => clip.name === name)) throw new Error(`Unknown clip: ${name}`);
  const clips = all.filter((clip) => !only.length || only.includes(clip.name));
  for (const clip of clips) {
    if (!/^web-[a-z0-9-]+$/.test(clip.name) || clip.steps?.[0]?.kind !== "goto") throw new Error(`Invalid clip declaration: ${clip.name}`);
  }
  let profile;
  let chrome;
  let provider;
  let cdp;
  let cancelled = false;
  const abort = () => {
    cancelled = true;
    cdp?.socket.close();
    for (const child of children) child.kill("SIGTERM");
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const reachable = async () => (await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(2000) }).catch(() => null))?.ok;
    if (!(await reachable())) {
      if (new URL(base).port !== "3000") throw new Error(`Dev server unavailable at ${base}; automatic startup is only supported on port 3000`);
      console.log("Starting the unavailable dev server; only this spawned server will be stopped.");
      const server = start("bun", ["run", "dev"], { cwd: join(root, "web"), env: { ...process.env, NO_UPDATE_NOTIFIER: "1" } });
      await until(async () => {
        if (cancelled || server.exitCode !== null) throw new Error("Dev server stopped during startup");
        return reachable();
      }, 120000, "dev server startup");
    }
    await mkdir(join(root, ".keating/tmp"), { recursive: true });
    await mkdir(out, { recursive: true });
    profile = await mkdtemp(join(root, ".keating/tmp/web-clips-"));
    let providerUrl;
    if (clips.some((clip) => clip.provider === "demo")) {
      provider = start("bun", ["scripts/tui-demo-provider.mjs", "0"]);
      await until(() => {
        if (provider.exitCode !== null) throw new Error(`Demo provider exited: ${provider.output}`);
        providerUrl = provider.output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        return Boolean(providerUrl);
      }, 10000, "demo provider startup");
    }
    chrome = start("google-chrome", [
      "--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
      "--window-size=1920,1080", "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps", "--disable-extensions",
      "--disable-domain-reliability", "--metrics-recording-only", "--disable-breakpad", "--disable-quic",
      "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]", "about:blank",
    ]);
    let endpoint;
    await until(async () => {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited: ${chrome.output}`);
      const active = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
      const [port, path] = active.trim().split("\n");
      if (port && path) endpoint = `ws://127.0.0.1:${port}${path}`;
      return Boolean(endpoint);
    }, 15000, "Chrome startup");
    cdp = new CDP();
    await cdp.connect(endpoint);
    const failures = [];
    for (const clip of clips) {
      if (cancelled) throw new Error("Capture interrupted");
      try { await record(cdp, clip, base, out, providerUrl); }
      catch (error) { failures.push(error); console.error(`${clip.name}: ${error.message}`); }
    }
    if (cancelled) throw new Error("Capture interrupted");
    if (failures.length) throw new Error(`${failures.length} clip(s) failed; see errors above`);
  } finally {
    cdp?.socket.close();
    await Promise.all([...children].map(stop));
    if (profile) await rm(profile, { recursive: true, force: true });
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`capture-web-clips: ${error.message}`); process.exitCode = 1; });
}
