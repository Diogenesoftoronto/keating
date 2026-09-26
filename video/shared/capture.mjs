#!/usr/bin/env node
// Captures product screenshots for the Keating videos from a shot manifest.
//
//   node video/shared/capture.mjs <shots.json> <out-dir>
//
// A shot is either a Storybook story ({"story": "learning-labs--type-script"}), rendered from a
// fresh static Storybook build, or a live route ({"url": "https://keating.help/bench"}). Each is
// shot in headless Chrome at the given viewport and device scale. Existing PNGs are kept unless
// FORCE=1, so re-runs only capture new or changed shots. Story shots are trimmed to the
// component unless "trim": false. STORYBOOK=<dir> reuses a build.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const [manifestPath, outDir] = process.argv.slice(2);
if (!manifestPath || !outDir) {
  console.error("usage: capture.mjs <shots.json> <out-dir>");
  process.exit(2);
}
const REPO = resolve(import.meta.dirname, "../..");
const FORCE = process.env.FORCE === "1";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
mkdirSync(outDir, { recursive: true });

const todo = manifest.shots.filter((s) => FORCE || !existsSync(join(outDir, `${s.name}.png`)));
if (!todo.length) {
  console.log(`[capture] ${manifest.shots.length} shots cached in ${outDir}`);
  process.exit(0);
}

const chrome = [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium"].find(
  (bin) => bin && spawnSync(bin, ["--version"]).status === 0,
);
if (!chrome) throw new Error("no Chrome found; set CHROME=/path/to/chrome");

// Storybook: build once into .keating/tmp (the checked-in web/storybook-static goes stale).
let base = null;
let server = null;
if (todo.some((s) => s.story)) {
  const dir = resolve(process.env.STORYBOOK || join(REPO, ".keating/tmp/sb-static"));
  if (!process.env.STORYBOOK && (FORCE || !existsSync(join(dir, "iframe.html")))) {
    console.log("[capture] building Storybook…");
    const r = spawnSync("bun", ["run", "build-storybook", "-o", dir, "--quiet"], { cwd: join(REPO, "web"), stdio: "inherit" });
    if (r.status !== 0) throw new Error("storybook build failed");
  }
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".avif": "image/avif", ".webp": "image/webp", ".woff2": "font/woff2", ".wasm": "application/wasm" };
  server = createServer((req, res) => {
    let file = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!file.startsWith(dir) || !existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
}

const run = (bin, args) =>
  new Promise((ok) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), 90_000);
    p.on("close", (status) => (clearTimeout(timer), ok({ status, stderr })));
  });

let failed = 0;
for (const shot of todo) {
  const [w, h] = shot.viewport || manifest.viewport || [1600, 1000];
  const scale = shot.scale || manifest.scale || 1.2;
  const theme = shot.theme || manifest.theme || "light";
  const url = shot.story
    ? `${base}/iframe.html?id=${shot.story}&viewMode=story&globals=theme:${theme}`
    : shot.url;
  const out = resolve(outDir, `${shot.name}.png`);
  // Async: the Storybook server above runs in this process and must keep answering.
  const r = await run(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--mute-audio", "--use-fake-ui-for-media-stream", `--force-device-scale-factor=${scale}`,
    `--window-size=${w},${h}`, `--virtual-time-budget=${shot.wait ?? 9000}`,
    theme === "dark" ? "--force-dark-mode" : "--blink-settings=preferredColorScheme=1",
    `--screenshot=${out}`, url,
  ]);
  if (r.status !== 0 || !existsSync(out)) {
    failed++;
    console.error(`[capture] ${shot.name}: failed\n${(r.stderr || "").slice(-600)}`);
  } else {
    // Stories sit small on an empty canvas: trim to the component, then pad with the page colour.
    if (shot.trim ?? manifest.trim ?? Boolean(shot.story)) {
      const pad = Math.round(32 * scale);
      spawnSync("magick", [out, "-fuzz", "4%", "-trim", "+repage", "-bordercolor", "%[pixel:p{0,0}]", "-border", String(pad), out]);
    }
    console.log(`[capture] ${shot.name} ← ${shot.story || shot.url}`);
  }
}
server?.close();
if (failed) process.exit(1);
