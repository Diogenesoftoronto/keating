#!/usr/bin/env bun
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { CDP, isLoopback, start, stop, until } from "../capture-web-clips.mjs";
import { assemble } from "./assemble.mjs";
import { startProvider } from "./provider.mjs";

const here = import.meta.dirname;
const root = resolve(here, "../..");
const mockups = join(root, "docs/design/2026-11-19-review-chat-mockups");
const scratchRoot = process.env.WALKTHROUGH_SCRATCH ?? "/tmp/keating-design-shots/W2";
const media = join(root, "docs/walkthroughs/media");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const viewportSizes = { desktop: [1280, 800], phone: [390, 844] };
const json = async path => JSON.parse(await readFile(path, "utf8"));

function overlay() {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("inert", "");
  host.setAttribute("popover", "manual");
  host.style.cssText = "all:initial;position:fixed;inset:0;width:auto;height:auto;margin:0;z-index:2147483647;pointer-events:none;contain:strict";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = '<style>svg{position:absolute;overflow:visible;filter:drop-shadow(0 1px 1px #0007)}i{position:absolute;width:20px;height:20px;border:3px solid #36cf72;border-radius:50%;box-shadow:0 0 0 1px #163823;box-sizing:border-box}</style><svg width="21" height="25" viewBox="0 0 21 25"><path d="M2 2v17l5-4 3 7 4-2-3-7h7Z" fill="#17291d" stroke="#fff" stroke-width="1.75" stroke-linejoin="round"/></svg>';
  const pointer = shadow.querySelector("svg");
  window.__walkthroughPointer = (x, y, click) => {
    pointer.style.transform = "translate(" + (x - 2) + "px," + (y - 2) + "px)";
    if (!click) return;
    const ring = shadow.appendChild(document.createElement("i"));
    ring.style.left = x - 10 + "px";
    ring.style.top = y - 10 + "px";
    ring.animate([{ transform: "scale(.55)", opacity: 1 }, { transform: "scale(1.8)", opacity: 0 }], { duration: 400 }).finished.then(() => ring.remove());
  };
  const install = () => {
    const style = document.createElement("style");
    style.textContent = '[data-popmelt-top-layer-host],[data-popmelt-browser-host],[data-openui-devtools-root],[aria-label="Open OpenUI Inspect"],[aria-label="OpenUI Inspect"] { display:none !important } .rm-created-invite .rm-qr { display:none !important } .rm-created-invite input { opacity:0 !important }';
    document.documentElement.append(style, host);
    let modal;
    const keepPointerAboveDialogs = () => {
      const active = [...document.querySelectorAll("dialog:modal")].at(-1);
      if (active === modal && host.matches(":popover-open")) return;
      modal = active;
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    };
    keepPointerAboveDialogs();
    new MutationObserver(keepPointerAboveDialogs).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["open"],
    });
  };
  if (document.documentElement) install();
  else document.addEventListener("DOMContentLoaded", install, { once: true });
  window.__walkthroughPointer(innerWidth / 2, innerHeight / 2);
}

// Mirror capture-web-clips' local-provider routing for the app's custom-provider proxy.
function routeLocalProvider(providerUrl) {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const target = request.headers.get("x-target-url");
    if (url.origin === location.origin && url.pathname.startsWith("/api/chat-proxy/")
      && [providerUrl, providerUrl + "/v1"].includes(target)) {
      const endpoint = target + url.pathname.slice("/api/chat-proxy".length) + url.search;
      return fetchOriginal(endpoint, {
        method: request.method,
        headers: request.headers,
        body: request.body ? await request.arrayBuffer() : undefined,
        signal: request.signal,
        credentials: "omit",
      });
    }
    return fetchOriginal(request);
  };
}

function freezeDevUpdates() {
  window.WebSocket = class extends window.WebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      const requested = Array.isArray(protocols) ? protocols : [protocols];
      if (requested.some(protocol => protocol === "vite-hmr" || protocol === "vite-ping")) this.close();
    }
  };
}

function locate({ selector, label, within, nth = 0, enabled = false, contains = false }) {
  const scope = within ? document.querySelector(within) : document;
  if (!scope) return null;
  const normalize = value => (value ?? "").replace(/\s+/g, " ").trim();
  const visible = element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility === "visible"
      && (!enabled || (!element.matches(":disabled") && !element.closest("[aria-disabled=true],[inert]")));
  };
  let candidates = scope.querySelectorAll(selector ?? 'button,a,label,input,[role=button],[role=menuitem],[role=tab],[role=option],[role=radio],[role=switch],summary');
  if (label !== undefined) candidates = [...candidates].filter(element =>
    [element.innerText, element.getAttribute("aria-label"), element.title, element.placeholder]
      .some(value => contains ? normalize(value).includes(label) : normalize(value) === label));
  return [...candidates].filter(visible)[nth] ?? null;
}

async function browserPath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache/ms-playwright");
  const names = (await readdir(cache)).filter(name => /^chromium_headless_shell-\d+$/.test(name));
  names.sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
  if (!names.length) throw new Error("Playwright headless shell is missing. Set CHROME to its executable.");
  return join(cache, names[0], "chrome-headless-shell-linux64/chrome-headless-shell");
}

function validate(board) {
  if (!slugPattern.test(board.slug) || !(board.viewport in viewportSizes) ||
      !["light", "dark"].includes(board.theme) || !board.steps?.length) {
    throw new Error("Storyboard requires slug, viewport (desktop or phone), theme (light or dark), and steps.");
  }
  if (board.steps[0].kind !== "goto") throw new Error("Step 1 must be goto.");
  const allowed = ["goto", "click", "type", "drag", "hover", "scroll", "wait-for", "caption", "chapter", "pause", "press", "profile", "select-text", "seed"];
  const usedStills = new Set();
  for (const [i, step] of board.steps.entries()) {
    if (!allowed.includes(step.kind)) throw new Error("Unknown step " + (i + 1) + ": " + step.kind);
    if (step.kind === "caption" && (!step.text?.trim() || step.text.trim().split(/\s+/).length > 12 || /[\r\n]/.test(step.text))) {
      throw new Error("Step " + (i + 1) + ": caption requires one line of at most 12 words.");
    }
    if (step.kind === "chapter" && (!slugPattern.test(step.id) || !step.title || !step.explanation || !step.alt)) {
      throw new Error("Step " + (i + 1) + ": chapter requires id, title, explanation, and alt.");
    }
    if (step.still && (!slugPattern.test(step.still) || usedStills.has(step.still))) {
      throw new Error("Step " + (i + 1) + ": invalid or duplicate still name.");
    }
    if (step.still) usedStills.add(step.still);
  }
}

async function capture(board, base, scratch, log, providerUrl) {
  const { slug, theme, viewport } = board;
  const [width, height] = viewportSizes[viewport];
  const fixtures = new Map();
  for (const name of new Set([...(board.fixtures ?? []), ...board.steps.flatMap(step => step.fixtures ?? [])])) {
    if (!slugPattern.test(name)) throw new Error("Invalid fixture: " + name);
    const path = join(here, "fixtures", name);
    const data = await json(path + ".json").catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    fixtures.set(name, { data, code: await readFile(path + ".js", "utf8") });
  }
  const origin = new URL(base).origin;
  const env = { ...process.env };
  delete env.LD_LIBRARY_PATH;
  const executable = await browserPath();
  await access(executable, constants.X_OK);
  const profile = await mkdtemp(join(scratch, "chrome-"));
  const chrome = start(executable, [
    "--headless", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + profile,
    "--window-size=" + width + "," + height, "--force-device-scale-factor=1", "--hide-scrollbars",
    ...(viewport === "desktop" ? ["--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2"] : []),
    "--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-default-apps", "--disable-extensions", "--disable-quic", "--proxy-server=http://127.0.0.1:9",
    "--proxy-bypass-list=localhost;127.0.0.1;[::1]", "about:blank",
  ], { env });
  const cdp = new CDP();
  let sessionId, targetId, activeContext, fatal;
  let recording = false;
  let point = { x: width / 2, y: height / 2 };
  const contexts = new Map();
  const parked = new Map();
  let profileName;
  const frames = [];
  const writes = new Set();
  const stills = new Map();
  const captions = [];
  const chapters = [];
  const started = Date.now();
  const abort = () => { chrome.kill("SIGTERM"); cdp.socket?.close(); };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, abort);
  const watchdog = setTimeout(abort, 180_000);
  const send = (method, params) => cdp.send(method, params, sessionId);
  const evaluate = async js => {
    if (fatal) throw fatal;
    const result = await send("Runtime.evaluate", { expression: "(async () => {" + js + "\n})()", awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const find = target => "(" + locate.toString() + ")(" + JSON.stringify(target) + ")";
  const resolvePage = step => {
    if (step.mockup) {
      if (!/^[a-z0-9-]+-mockups\.html$/.test(step.mockup)) throw new Error("Invalid mockup filename.");
      return pathToFileURL(join(mockups, step.mockup)).href + (step.hash ? "#" + encodeURIComponent(step.hash) : "");
    }
    const url = new URL(step.path, base);
    if (url.origin !== origin || url.username || url.password) throw new Error("Navigation must stay on the app origin.");
    return url.href;
  };
  async function navigate(step) {
    const url = resolvePage(step);
    const loaded = new Set();
    const remove = cdp.on("Page.lifecycleEvent", (event, id) => {
      if (id === sessionId && event.name === "load") loaded.add(event.loaderId);
    });
    try {
      const result = await send("Page.navigate", { url });
      if (result.errorText) throw new Error(result.errorText);
      if (result.loaderId) await until(() => {
        if (fatal) throw fatal;
        return loaded.has(result.loaderId);
      }, step.timeout ?? 15000, "load " + url);
      await evaluate("await document.fonts.ready; window.__walkthroughPointer?.(" + point.x + "," + point.y + ");");
    } finally { remove(); }
  }

  async function seedFixtures(name, seeds) {
    for (const seed of seeds) {
      const { data, code } = fixtures.get(seed);
      log("Seed " + name + "/" + seed);
      await evaluate("const data = " + JSON.stringify(data) + "; const providerUrl = " + JSON.stringify(providerUrl ?? null)
        + "; const theme = " + JSON.stringify(theme) + "; const base = " + JSON.stringify(base) + ";\n" + code);
    }
  }

  async function openProfile(name, step, seeds) {
    if (targetId) {
      if (recording) await send("Page.stopScreencast");
      if (step.keepPrevious) parked.set(profileName, { targetId, sessionId });
      else await cdp.send("Target.closeTarget", { targetId });
    }
    activeContext = contexts.get(name);
    profileName = name;
    if (parked.has(name)) {
      ({ targetId, sessionId } = parked.get(name));
      parked.delete(name);
      await cdp.send("Target.activateTarget", { targetId });
      if (step.path) await navigate(step);
      if (recording) await resumeAt(step.ready ?? []);
      return;
    }
    const fresh = !activeContext;
    if (fresh) {
      ({ browserContextId: activeContext } = await cdp.send("Target.createBrowserContext"));
      contexts.set(name, activeContext);
      await cdp.send("Browser.grantPermissions", { permissions: ["durableStorage", "clipboardReadWrite", "clipboardSanitizedWrite"], origin, browserContextId: activeContext });
    }
    ({ targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId: activeContext }));
    ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }));
    await cdp.send("Target.activateTarget", { targetId });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    // A new navigation loads the current modules. Keep Vite's development
    // hot updates from replacing an in-progress take.
    await send("Network.setBlockedURLs", { urls: ["ws://*/?token=*", "wss://*/?token=*"] });
    await send("Network.setBypassServiceWorker", { bypass: true });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await send("Page.setLifecycleEventsEnabled", { enabled: true });
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    const route = providerUrl ? "(" + routeLocalProvider.toString() + ")(" + JSON.stringify(providerUrl) + ");" : "";
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__REACT_GRAB_DISABLED__ = true;" + route + "(" + freezeDevUpdates.toString() + ")();(" + overlay.toString() + ")();",
    });
    if (fresh && seeds?.length) {
      await navigate({ path: "/" });
      await seedFixtures(name, seeds);
    }
    await navigate(step);
    for (const ready of step.ready ?? []) await waitFor(ready);
    if (recording) {
      await primeFrame();
      await screencast();
    }
  }

  async function resumeAt(conditions) {
    for (const condition of conditions) await waitFor(condition);
    await sleep(250);
    await primeFrame();
    await screencast();
  }

  async function primeFrame() {
    // CDP's first screencast frame can come from a paint before the route was
    // ready. A fresh screenshot sets the start of this scene and rejects it.
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
    const timestamp = Date.now() / 1000;
    if (timestamp <= (frames.at(-1)?.timestamp ?? -Infinity)) return;
    const file = "frame_" + String(frames.length).padStart(5, "0") + ".jpg";
    frames.push({ file, timestamp });
    await writeFile(join(scratch, file), Buffer.from(shot.data, "base64"));
  }

  async function screencast() {
    await send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  }

  async function waitFor(step) {
    const condition = step.condition
      ? "return Boolean(await (" + step.condition + "));"
      : step.text !== undefined
        ? "return document.body && document.body.innerText.includes(" + JSON.stringify(step.text) + ") === " + !step.absent + ";"
        : "return Boolean(" + find(step) + ") === " + !step.absent + ";";
    const description = step.condition ?? step.text ?? step.selector ?? step.label;
    await until(() => evaluate(
      'if (document.querySelector("vite-error-overlay")) throw new Error("Vite reported a compilation error."); ' + condition
    ), step.timeout ?? 10000, description);
  }

  async function targetPoint(target, reveal = true) {
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    await waitFor(target);
    if (target.revealPageTop) await evaluate("window.scrollTo(0, 0);");
    if (reveal) await evaluate("const element = " + find(target) + ";const r = element?.getBoundingClientRect();" +
      'if (r && !element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))) element.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});');
    let found;
    await until(async () => {
      found = await evaluate("const element = " + find(target) + "; if (!element) return null;" +
        "const r = element.getBoundingClientRect(); const y = r.top + r.height / 2;" +
        "for (const factor of [.5,.25,.75]) {const x = r.left + r.width * factor;" +
        "if (element.contains(document.elementFromPoint(x,y))) return {x,y};} return null;");
      return found;
    }, target.timeout ?? 10000, "unobstructed " + (target.selector ?? target.label));
    return found;
  }

  async function mouse(type, at, buttons = 0) {
    await send("Input.dispatchMouseEvent", { type, ...at, pointerType: "mouse", buttons,
      ...(type === "mouseMoved" ? { button: buttons ? "left" : "none" } : { button: "left", clickCount: 1 }) });
  }
  const draw = (at, ring = false) => evaluate("window.__walkthroughPointer(" + at.x + "," + at.y + "," + ring + ");");
  async function move(destination, ms = 270, buttons = 0, throwAtEnd = false) {
    const source = point;
    const segments = Math.max(1, Math.round(ms / 24));
    for (let index = 1; index <= segments; index++) {
      const t = index / segments;
      const easing = throwAtEnd ? t * t : t * t * (3 - 2 * t);
      point = { x: source.x + (destination.x - source.x) * easing, y: source.y + (destination.y - source.y) * easing };
      await draw(point);
      await mouse("mouseMoved", point, buttons);
      if (index < segments) await sleep(ms / segments);
    }
  }

  const at = () => Math.max(0, Date.now() / 1000 - frames[0].timestamp);
  async function still(name) {
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
    const path = join(scratch, slug + "-" + name + ".jpg");
    await writeFile(path, Buffer.from(shot.data, "base64"));
    stills.set(name, path);
  }
  async function action(step) {
    switch (step.kind) {
      case "goto": {
        if (!step.ready?.length) return navigate(step);
        await send("Page.stopScreencast");
        await navigate(step);
        return resumeAt(step.ready);
      }
      case "seed": {
        await seedFixtures(profileName, step.fixtures);
        if (step.reload) {
          if (step.ready?.length) await send("Page.stopScreencast");
          await navigate({ path: await evaluate("return location.pathname + location.search;") });
          if (step.ready?.length) await resumeAt(step.ready);
        }
        return;
      }
      case "profile": {
        if (!slugPattern.test(step.name)) throw new Error("Profile name must be a slug.");
        if (!step.pathFrom) return openProfile(step.name, step, step.fixtures);
        await waitFor(step.pathFrom);
        const link = await evaluate("const node = " + find(step.pathFrom) + "; return node.href ?? node.value ?? node.innerText;");
        if (!link) throw new Error("Invitation control has no URL.");
        return openProfile(step.name, { ...step, path: link }, step.fixtures);
      }
      case "wait-for": return waitFor(step);
      case "pause": return sleep(step.ms);
      case "chapter":
        chapters.push({ id: step.id, title: step.title, start: at(), explanation: step.explanation, alt: step.alt, still: step.image ?? step.id });
        return;
      case "caption":
        captions.push({ start: at(), text: step.text, ...(step.ms ? { end: at() + step.ms / 1000 } : {}) });
        return;
      case "hover": return move(await targetPoint(step), step.ms);
      case "click": {
        const target = { ...step, enabled: true };
        await move(await targetPoint(target), step.ms);
        await until(async () => {
          const hit = await evaluate("return " + find(target) + "?.contains(document.elementFromPoint(" + point.x + "," + point.y + "));");
          if (hit) return true;
          await move(await targetPoint(target), 120);
          return false;
        }, step.timeout ?? 10000, "stable " + (step.label ?? step.selector));
        await draw(point, true);
        await mouse("mousePressed", point, 1);
        if (step.ready?.length) await send("Page.stopScreencast");
        await mouse("mouseReleased", point);
        if (step.ready?.length) await resumeAt(step.ready);
        return;
      }
      case "select-text": {
        await targetPoint({ ...step, text: undefined });
        const endpoints = await evaluate(`
          const root = ${find(step)};
          const text = ${JSON.stringify(step.text)};
          const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const nodes = [];
          let content = "";
          for (let node; (node = walk.nextNode());) {
            nodes.push({ node, start: content.length });
            content += node.data;
          }
          const start = content.indexOf(text);
          if (start === -1) throw new Error("Passage is absent from the transcript.");
          function boundary(offset) {
            const {node, start} = nodes.findLast(item => item.start <= offset);
            const range = document.createRange();
            range.setStart(node, offset - start);
            range.collapse(true);
            const bounds = range.getBoundingClientRect();
            return {x: bounds.x, y: bounds.y + bounds.height / 2};
          }
          return [boundary(start), boundary(start + text.length)];
        `);
        const [from, to] = endpoints;
        from.x += 1;
        to.x -= 1;
        await move(from);
        await mouse("mousePressed", point, 1);
        try { await move(to, 450, 1); await sleep(120); }
        finally { await mouse("mouseReleased", point); }
        return;
      }
      case "drag": {
        await move(await targetPoint(step.from));
        const to = await targetPoint(step.to, false);
        await mouse("mousePressed", point, 1);
        try {
          await move(to, step.ms ?? 600, 1, step.throw === true);
          if (step.hold) await sleep(step.hold);
        } finally { await mouse("mouseReleased", point); }
        return;
      }
      case "type":
        await move(await targetPoint({ ...step, enabled: true, text: undefined }));
        await evaluate(find(step) + ".focus();");
        for (const char of step.text) {
          await send("Input.insertText", { text: char });
          await sleep(step.delay ?? 44);
        }
        return;
      case "press": {
        const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, Backspace: 8, Home: 36, a: 65 };
        if (!(step.key in codes)) throw new Error("Unsupported key: " + step.key);
        const key = { key: step.key, windowsVirtualKeyCode: codes[step.key], modifiers: step.ctrl ? 2 : 0 };
        await send("Input.dispatchKeyEvent", { type: "keyDown", ...key, ...(step.key === "Enter" ? { text: "\r" } : {}) });
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
        return;
      }
      case "scroll":
        if (step.to) {
          await waitFor(step.to);
          return evaluate("const el = " + find(step.to) + "; el.scrollIntoView({block:" + JSON.stringify(step.block ?? "center") + ',behavior:"smooth",container:"nearest"});');
        }
        if (step.selector || step.label) await move(await targetPoint(step));
        for (let i = 0; i < 10; i++) {
          await send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: (step.dx ?? 0) / 10, deltaY: (step.dy ?? 0) / 10 });
          await sleep(28);
        }
    }
  }
  try {
    let endpoint;
    await until(async () => {
      if (chrome.exitCode !== null || chrome.signalCode) throw new Error("Chrome exited " + (chrome.signalCode ?? chrome.exitCode) + ": " + chrome.output);
      const [port, path] = (await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "")).trim().split("\n");
      if (port && path) endpoint = "ws://127.0.0.1:" + port + path;
      return Boolean(endpoint);
    }, 10000, "Chrome startup");
    await cdp.connect(endpoint);
    cdp.on("Fetch.requestPaused", (event, id) => {
      const url = new URL(event.request.url);
      const proxy = url.pathname.startsWith("/api/chat-proxy/");
      const file = url.protocol === "file:" && fileURLToPath(url).startsWith(mockups + "/");
      const allowed = !proxy && (url.origin === origin || url.origin === providerUrl || file || ["data:", "blob:"].includes(url.protocol));
      if (!allowed) log("Blocked " + url.origin + url.pathname);
      cdp.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed
        ? { requestId: event.requestId }
        : { requestId: event.requestId, errorReason: "BlockedByClient" }, id)
        .catch(error => { if (id === sessionId) fatal ??= error; });
    });
    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }, id) => {
      if (id === sessionId) log("Page exception: " + (exceptionDetails.exception?.description ?? exceptionDetails.text));
    });
    cdp.on("Page.frameNavigated", ({ frame }, id) => {
      if (recording && id === sessionId && !frame.parentId) log("Page navigation: " + new URL(frame.url).pathname.replace(/(\/rooms\/join\/).+/, "$1[hidden]"));
    });
    cdp.on("Runtime.consoleAPICalled", ({ type, args }, id) => {
      if (id !== sessionId || !["warning", "error", "log"].includes(type)) return;
      const message = args.map(arg => arg.value ?? arg.description ?? "").join(" ");
      if (type !== "log" || message.startsWith("[keating:")) log("Page " + type + ": " + message.slice(0, 400));
    });
    cdp.on("Network.responseReceived", ({ response }, id) => {
      if (id !== sessionId || response.status < 400) return;
      const url = new URL(response.url);
      log("HTTP " + response.status + " " + url.origin + url.pathname);
    });
    cdp.on("Network.loadingFailed", (event, id) => {
      if (id === sessionId && event.type === "Fetch" && !event.canceled) {
        log("Fetch failed: " + (event.corsErrorStatus?.corsError ?? event.errorText));
      }
    });
    cdp.on("Page.screencastFrame", (event, id) => {
      cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }, id).catch(() => {});
      if (!recording || id !== sessionId) return;
      const timestamp = event.metadata.timestamp;
      if (!Number.isFinite(timestamp) || timestamp <= (frames.at(-1)?.timestamp ?? -Infinity)) return;
      const file = "frame_" + String(frames.length).padStart(5, "0") + ".jpg";
      frames.push({ file, timestamp });
      const write = writeFile(join(scratch, file), Buffer.from(event.data, "base64"))
        .catch(error => { fatal ??= error; }).finally(() => writes.delete(write));
      writes.add(write);
    });
    for (const [index, step] of board.steps.entries()) {
      const label = slug + " step " + (index + 1) + " (" + step.kind + ")";
      log(label + " " + (step.label ?? step.id ?? step.text ?? step.path ?? step.selector ?? ""));
      try {
        if (index === 0) {
          await openProfile("main", step, board.fixtures);
          for (const ready of board.ready ?? []) await waitFor(ready);
          await sleep(450);
          await primeFrame();
          recording = true;
          await screencast();
          await until(() => frames.length > 0, 6000, "first screencast frame");
        } else await action(step);
        if (step.still) await still(step.still);
      } catch (error) {
        if (sessionId && !chrome.signalCode) {
          await still("failed").catch(() => {});
          const controls = await evaluate('return [...document.querySelectorAll("button,input,textarea,[role=button]")].filter(e=>e.getClientRects().length).map(e=>[e.innerText,e.getAttribute("aria-label"),e.placeholder].filter(Boolean).join(" | ")).slice(-120);').catch(() => []);
          log("Visible controls: " + JSON.stringify(controls));
        }
        throw new Error(label + ": " + error.message + (chrome.signalCode ? " (Chrome " + chrome.signalCode + ")" : ""), { cause: error });
      }
    }
    await send("Page.stopScreencast");
    const duration = Math.max(at(), frames.at(-1).timestamp - frames[0].timestamp + 0.034);
    if (fatal) throw fatal;
    if (duration < 1) throw new Error("Capture is shorter than one second.");
    for (const [index, cue] of captions.entries()) {
      cue.end = Math.min(cue.end ?? Infinity, captions[index + 1]?.start ?? duration, duration);
      if (cue.end - cue.start < 0.001) throw new Error("Caption has no display time: " + cue.text);
    }
    for (const chapter of chapters) {
      if (!stills.has(chapter.still)) throw new Error("Chapter " + chapter.id + " has no still named " + chapter.still);
    }
    return { scratch, slug, frames, duration, captions, chapters, stills, provenance: {
      title: board.title, viewport, width, height, theme, fixtures: board.fixtures ?? [],
      transcript: board.transcript ?? null, capturedAt: new Date(started).toISOString(), viewerNote: board.viewerNote,
    } };
  } finally {
    recording = false;
    clearTimeout(watchdog);
    cdp.socket?.close();
    try { await stop(chrome); } finally {
      await Promise.all(writes);
      await rm(profile, { recursive: true, force: true });
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, abort);
      if (frames.length) await writeFile(join(scratch, "capture-state.json"), JSON.stringify({ frames, chapters, captions }, null, 2));
    }
  }
}

async function main() {
  const [storyboard, ...args] = process.argv.slice(2);
  if (!storyboard || args.some(arg => !/^--(?:base|out)=.+$/.test(arg) && arg !== "--no-webm")) {
    throw new Error("Usage: bun scripts/walkthroughs/record.mjs STORYBOARD.json [--base=http://localhost:3420] [--out=PATH] [--no-webm]");
  }
  const option = (name, fallback) => args.find(arg => arg.startsWith("--" + name + "="))?.slice(name.length + 3) ?? fallback;
  const base = option("base", "http://localhost:3420");
  if (!isLoopback(base) || !/^https?:\/\//.test(base)) throw new Error("--base must be an HTTP(S) loopback URL.");
  const board = await json(resolve(storyboard));
  validate(board);
  if (!board.steps[0].mockup) {
    const response = await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(4000) });
    if (response.status >= 500) throw new Error("Existing app returned " + response.status + " at " + base);
  }
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, board.slug + "-"));
  const messages = [];
  const log = message => { messages.push(message); if (!message.startsWith("Blocked")) console.log(message); };
  let provider;
  try {
    if (board.transcript) {
      if (!slugPattern.test(board.transcript)) throw new Error("Invalid transcript name.");
      provider = startProvider(await json(join(here, "fixtures", board.transcript + ".json")), log);
    }
    const result = await capture(board, base, scratch, log, provider ? new URL(provider.url).origin : undefined);
    provider?.stop(true);
    provider = undefined;
    await assemble({ ...result, out: resolve(option("out", media)), webm: !args.includes("--no-webm") });
  } finally {
    provider?.stop(true);
    await writeFile(join(scratch, "capture.log"), messages.join("\n") + "\n");
    console.log("Capture diagnostics: " + scratch);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
