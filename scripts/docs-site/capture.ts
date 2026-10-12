#!/usr/bin/env bun
// Rebuild authentic documentation captures; keep fixture boundaries in provenance.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const output = join(root, "scripts/docs-site/assets/screenshots");
const storybook = join(root, ".keating/tmp/docs-storybook");
const manifest = JSON.parse(await readFile(join(root, "scripts/docs-site/shots.json"), "utf8")) as {
  viewport: number[];
  shots: { name: string; story: string; viewport?: number[]; trim?: boolean }[];
};

async function run(command: string[], env: Record<string, string> = {}, unset: string[] = []) {
  const captureEnvironment = { ...Bun.env, ...env };
  for (const name of unset) delete captureEnvironment[name];
  const process = Bun.spawn(command, { cwd: root, env: captureEnvironment, stdout: "inherit", stderr: "inherit" });
  if (await process.exited !== 0) throw new Error(`Capture command failed: ${command.join(" ")}`);
}

if (process.argv.slice(2).some(arg => arg !== "--metadata-only")) throw new Error("Usage: bun scripts/docs-site/capture.ts [--metadata-only]");
if (!process.argv.includes("--metadata-only")) {
  for (const command of ["google-chrome", "magick", "vhs"]) {
    if (!Bun.which(command)) throw new Error(`Missing capture dependency: ${command}`);
  }
  await mkdir(join(root, ".keating/tmp"), { recursive: true });
  await run(["bun", "run", "--cwd", "web", "build-storybook", "-o", storybook, "--quiet"]);
  const index = JSON.parse(await readFile(join(storybook, "index.json"), "utf8"));
  for (const shot of manifest.shots) {
    if (!index.entries?.[shot.story]) throw new Error(`Missing documentation story: ${shot.story}`);
  }
  await run(["node", "video/shared/capture.mjs", "scripts/docs-site/shots.json", output], {
    STORYBOOK: storybook, FORCE: "1", CHROME: join(root, "scripts/docs-site/chrome-capture.sh"),
  });
  const healthy = async () => {
    try {
      const response = await fetch("http://127.0.0.1:3000/chat", { signal: AbortSignal.timeout(2000) });
      return response.ok && (await response.text()).includes("/src/main-react.tsx");
    } catch { return false; }
  };
  let web: ReturnType<typeof Bun.spawn> | undefined;
  try {
    if (!await healthy()) {
      console.log("Starting the local web app for classroom captures…");
      web = Bun.spawn(["bun", "run", "dev", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
        cwd: join(root, "web"), stdout: "inherit", stderr: "inherit",
      });
      const deadline = Date.now() + 300_000;
      while (!await healthy()) {
        if (web.exitCode !== null) throw new Error("Capture web app exited before readiness");
        if (Date.now() > deadline) throw new Error("Capture web app did not become ready on port 3000");
        await Bun.sleep(500);
      }
    }
    await run(["bun", "scripts/capture-classroom-shots.mjs"]);
  } finally {
    if (web) { web.kill("SIGTERM"); await web.exited; }
  }
  // System Chrome/ttyd must use their own libraries rather than Devenv's
  // Android/Nix LD_LIBRARY_PATH, which prevents the VHS browser connecting.
  await run(["vhs", "validate", "docs/tui-screenshots.tape"], {}, ["LD_LIBRARY_PATH"]);
  await run(["vhs", "docs/tui-screenshots.tape"], {}, ["LD_LIBRARY_PATH"]);
}

const sources = [
  ...manifest.shots.map(shot => ({
    name: shot.name, source: shot.story, kind: "production-component-story",
    viewport: shot.viewport ?? manifest.viewport,
    fixture: "Authored component fixture; displayed state only, without real payment, download, or course delivery.",
  })),
  ...["desktop", "mobile"].map(size => ({
    name: `current-classroom-${size}`, source: "scripts/capture-classroom-shots.mjs (/chat)",
    kind: "application-route", viewport: size === "desktop" ? [1280, 900] : [390, 844],
    fixture: "Authored lesson restored through production local session storage; no inference request. Mobile is narrow web, not a native client.",
  })),
  ...["conversation", "model-picker", "session-tree"].map(state => ({
    name: `current-tui-${state}`, source: "docs/tui-screenshots.tape (src/cli/main.ts tui)",
    kind: "production-terminal-host", viewport: [1440, 900],
    fixture: "Isolated temporary workspace and loopback demo provider; actual terminal runtime, without hosted inference or operator credentials.",
  })),
];
const screenshots = await Promise.all(sources.map(async source => {
  const png = await readFile(join(output, `${source.name}.png`));
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.subarray(12, 16).toString() !== "IHDR") throw new Error(`Invalid PNG: ${source.name}`);
  return { ...source, file: `${source.name}.png`, width: png.readUInt32BE(16), height: png.readUInt32BE(20), sha256: createHash("sha256").update(png).digest("hex") };
}));
const revision = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe" });
const sourceCommit = (await new Response(revision.stdout).text()).trim();
if (await revision.exited !== 0) throw new Error("Cannot identify source revision");
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const previous = await readFile(join(output, "captures.json"), "utf8").then(text => JSON.parse(text)).catch(() => null);
const captureDate = process.argv.includes("--metadata-only") ? (previous?.captureDate ?? "2026-10-01") : new Date().toISOString().slice(0, 10);
await writeFile(join(output, "captures.json"), JSON.stringify({
  captureDate,
  metadataGeneratedAt: new Date().toISOString(),
  version: process.argv.includes("--metadata-only") ? (previous?.version ?? version) : version,
  sourceCommit: process.argv.includes("--metadata-only") ? (previous?.sourceCommit ?? sourceCommit) : sourceCommit,
  sourceState: "Working tree includes documentation capture fixtures and scripts.",
  regenerate: "rtk devenv tasks run keating:docs-screenshots",
  screenshots,
}, null, 2) + "\n");
console.log(`Recorded provenance for ${screenshots.length} documentation screenshots.`);

type DocsPage = { sections: { screenshots?: { src: string; width: number; height: number; caption: string }[] }[] };
const byFile = new Map(screenshots.map(shot => [`/assets/screenshots/${shot.file}`, shot]));
const referenced = new Set<string>();
for (const name of ["getting-started.json", "learning.json"]) {
  const path = join(root, "scripts/docs-site/content", name);
  const pages = JSON.parse(await readFile(path, "utf8")) as DocsPage[];
  for (const page of pages) for (const section of page.sections) for (const picture of section.screenshots ?? []) {
    const capture = byFile.get(picture.src);
    if (!capture) continue; // Historical images retain their original provenance.
    picture.width = capture.width;
    picture.height = capture.height;
    picture.caption = picture.caption.replace(/\(\d{4}-\d{2}-\d{2}\)/, `(${captureDate})`);
    referenced.add(picture.src);
  }
  await writeFile(path, JSON.stringify(pages, null, 2) + "\n");
}
for (const file of byFile.keys()) if (!referenced.has(file)) throw new Error(`Capture has no documentation placement: ${file}`);
await run(["bun", "scripts/docs-site/build.ts"]);
console.log(`Updated screenshot dimensions and dates in the guides; documentation rebuilt.`);
