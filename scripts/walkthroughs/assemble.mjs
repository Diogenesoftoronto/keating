import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { frameTimeline, start } from "../capture-web-clips.mjs";

async function ffmpeg(args) {
  const child = start("ffmpeg", ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-threads", "2", "-filter_threads", "1", ...args]);
  const { code, signal } = await child.done;
  if (code !== 0) throw new Error("ffmpeg (" + (signal ?? code) + "): " + child.output);
}

export function clock(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return pad(Math.floor(ms / 3600000)) + ":" + pad(Math.floor(ms / 60000) % 60) + ":" + pad(Math.floor(ms / 1000) % 60) + "." + pad(ms % 1000, 3);
}

export async function assemble({ scratch, out, slug, frames, duration, captions, chapters, stills, provenance, webm }) {
  // Preserve the CDP timestamps. Duplicate the last sampled image at the real end
  // so a motionless closing hold survives frameTimeline's nominal last frame.
  const end = frames[0].timestamp + duration;
  const timeline = frameTimeline(end > frames.at(-1).timestamp
    ? [...frames, { ...frames.at(-1), timestamp: end }] : frames);
  const concat = join(scratch, "frames.ffconcat");
  await writeFile(concat, timeline.concat);
  await writeFile(join(scratch, "timestamps.json"), JSON.stringify({ duration, frames, chapters }, null, 2));
  const input = ["-f", "concat", "-safe", "0", "-i", concat, "-vf", "fps=30,scale=in_range=pc:out_range=tv,format=yuv420p", "-t", duration.toFixed(6), "-an"];
  const mp4 = join(scratch, slug + ".mp4");
  const maxBytes = 4_000_000;
  await ffmpeg([...input, "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "21", "-movflags", "+faststart", mp4]);
  if ((await stat(mp4)).size > maxBytes) {
    const budget = Math.floor(maxBytes * 7.4 / duration);
    await ffmpeg([...input, "-c:v", "libx264", "-threads", "2", "-preset", "fast",
      "-b:v", String(budget), "-maxrate", String(budget), "-bufsize", String(budget * 2), "-movflags", "+faststart", mp4]);
  }
  const bytes = (await stat(mp4)).size;
  if (bytes > maxBytes) throw new Error("MP4 exceeds 4 MB. Shorten the recording or reduce motion.");
  let webmBytes = 0;
  if (webm) {
    const path = join(scratch, slug + ".webm");
    await ffmpeg([...input, "-c:v", "libvpx-vp9", "-threads", "2", "-deadline", "realtime", "-cpu-used", "6", "-row-mt", "1", "-crf", "33", "-b:v", "0", path]);
    const size = (await stat(path)).size;
    if (size < bytes) webmBytes = size;
  }
  if (!stills.has("poster")) {
    const path = join(scratch, slug + "-poster.jpg");
    await ffmpeg(["-ss", String(Math.min(1, duration / 2)), "-i", mp4, "-frames:v", "1", "-update", "1", path]);
    stills.set("poster", path);
  }
  const escaped = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const vtt = "WEBVTT\n\n" + captions.map((cue, index) =>
    clock(cue.start) + " --> " + clock(cue.end ?? captions[index + 1]?.start ?? duration) + "\n" + escaped(cue.text) + "\n\n").join("");
  const manifest = { ...provenance, duration, bytes, webmBytes, chapters };
  const assets = [[slug + ".mp4", mp4], ...[...stills.values()].map(path => [path.split("/").at(-1), path])];
  if (webmBytes) assets.push([slug + ".webm", join(scratch, slug + ".webm")]);
  await mkdir(out, { recursive: true });
  if (!webmBytes) await rm(join(out, slug + ".webm"), { force: true });
  for (const [name, path] of assets) await writeFile(join(out, name), await readFile(path));
  await writeFile(join(out, slug + ".vtt"), vtt);
  await writeFile(join(out, slug + "-chapters.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(slug + ": " + duration.toFixed(2) + "s, " + bytes + " bytes MP4"
    + (webmBytes ? ", " + webmBytes + " bytes WebM" : "") + " → " + out);
}
