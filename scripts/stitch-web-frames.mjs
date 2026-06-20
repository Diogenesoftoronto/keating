// scripts/stitch-web-frames.mjs
//
// Stitch captured web UI screencast frames into the .mp4 clips used by the
// Keating intro video.
//
// The frames themselves are produced by driving a headed Chrome via the
// playwriter MCP (see AGENTS.md "Web UI capture"). This helper turns the
// captured JPEG frames into polished 60fps mp4 clips suitable for the
// Remotion composition.
//
// Usage:
//   bun scripts/stitch-web-frames.mjs                       # stitch all clips
//   bun scripts/stitch-web-frames.mjs --frame-dir=PATH      # stitch one dir
//   bun scripts/stitch-web-frames.mjs --out=docs/assets     # default
//
// Frame layout produced by the playwriter CDP capture:
//   .keating/outputs/video/frames/web-landing/frame_00000.jpg ...
//   .keating/outputs/video/frames/web-tutorial/frame_00000.jpg ...
//   .keating/outputs/video/frames/web-paper/frame_00000.jpg ...

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const cwd = process.cwd();
const arg = (name, fallback = null) => {
  const prefix = `--${name}=`;
  const v = process.argv.find((a) => a.startsWith(prefix));
  return v ? v.slice(prefix.length) : fallback;
};

const clipRoot = resolve(cwd, ".keating", "outputs", "video", "frames");
const outDir = resolve(cwd, arg("out", "docs/assets"));
const singleFrameDir = arg("frame-dir", null);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return r.stdout?.trim() ?? "";
}

function stitch(name, frameDir, out) {
  const frames = readdirSync(frameDir).filter((f) => /^frame_\d+\.jpg$/.test(f));
  if (frames.length === 0) {
    throw new Error(`No frame_*.jpg files in ${frameDir}`);
  }
  const first = frameDir.endsWith("/") ? frameDir : frameDir + "/";
  spawnSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-framerate", "60",
      "-pattern_type", "glob",
      "-i", `${first}frame_*.jpg`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-crf", "18",
      "-preset", "fast",
      out,
    ],
    { stdio: "inherit" },
  );
  const dur = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    out,
  ]);
  console.log(`  ${name.padEnd(18)} ${frames.length} frames -> ${basename(out)} (${dur}s)`);
}

mkdirSync(outDir, { recursive: true });
const clips = singleFrameDir
  ? [{ name: basename(singleFrameDir), dir: singleFrameDir, out: join(outDir, basename(singleFrameDir) + ".mp4") }]
  : ["web-landing", "web-tutorial", "web-paper"].map((n) => ({
      name: n,
      dir: join(clipRoot, n),
      out: join(outDir, `${n}.mp4`),
    }));

console.log("Stitching web UI clips:");
for (const c of clips) {
  if (!existsSync(c.dir)) {
    console.log(`  ${c.name.padEnd(18)} SKIP (no frames dir at ${c.dir})`);
    continue;
  }
  stitch(c.name, c.dir, c.out);
}
console.log("done.");
