import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const cwd = process.cwd();
const entryPoint = join(cwd, "video", "keating-intro", "src", "index.ts");
const configPath = join(cwd, "video", "keating-intro", "remotion.config.ts");

// --project=<dir> renders another film through the same composition: the dir
// holds scenes.json, shots.json and an optional film.json ({ "label": "KEATING // LIVE" }).
// Its name picks the output folder; the intro keeps its historical paths.
const projectDir = join(cwd, arg("project", join("video", "keating-intro")));
const name = basename(projectDir);
const film = existsSync(join(projectDir, "film.json")) ? JSON.parse(readFileSync(join(projectDir, "film.json"), "utf8")) : {};
const outDir = join(cwd, ".keating", "outputs", "video", name);
const scenesPath = join(projectDir, "scenes.json");
const propsPath = join(outDir, "props.json");
const audioPath = join(outDir, "narration.wav");
const hashPath = join(outDir, "narration.sha");
const videoPath = join(outDir, `${name}.mp4`);
const publicDir = name === "keating-intro" ? join(cwd, "video", "keating-intro", "public", "generated") : join(outDir, "public");

const model = process.env.FAL_TTS_MODEL || "google/gemini-3.8-flash-tts";
const voice = process.env.FAL_TTS_VOICE || "Kore";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
  });
  if (result.status !== 0) {
    const message = options.capture ? result.stderr || result.stdout : `${command} ${args.join(" ")}`;
    throw new Error(message.trim());
  }
  return result.stdout?.trim() ?? "";
}

function ffprobeDuration(path) {
  const output = run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
    { capture: true },
  );
  const duration = Number(output);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not read duration for ${path}`);
  }
  return duration;
}

// Scene cuts land on the pauses between narration lines. Word-count estimates
// drift a second or two by the end, and a line break is not always the longest
// pause, so each estimated cut snaps to the pause that best trades length
// against distance, with cuts kept in order.
function narrationCuts(path, weights, audioSeconds) {
  const log = spawnSync("ffmpeg", ["-v", "info", "-i", path, "-af", "silencedetect=n=-35dB:d=0.3", "-f", "null", "-"], { cwd, encoding: "utf8" }).stderr ?? "";
  const pauses = [...log.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/gu)]
    .map((match) => ({ at: Number(match[1]) - 0.2, length: Number(match[2]) }));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let running = 0;
  const estimates = weights.slice(0, -1).map((weight) => (running += weight) / total * audioSeconds);
  if (pauses.length < estimates.length) return null;

  const score = (pause, estimate) => pause.length * 3 - Math.abs(pause.at - estimate);
  // best[k][j]: best total score with cut k on pause j.
  const best = estimates.map(() => pauses.map(() => ({ score: -Infinity, from: -1 })));
  pauses.forEach((pause, j) => { best[0][j] = { score: score(pause, estimates[0]), from: -1 }; });
  for (let k = 1; k < estimates.length; k += 1) {
    let runningBest = { score: -Infinity, index: -1 };
    pauses.forEach((pause, j) => {
      if (runningBest.index >= 0) {
        best[k][j] = { score: runningBest.score + score(pause, estimates[k]), from: runningBest.index };
      }
      if (best[k - 1][j].score > runningBest.score) runningBest = { score: best[k - 1][j].score, index: j };
    });
  }
  const last = estimates.length - 1;
  let index = best[last].reduce((top, cell, j) => (cell.score > best[last][top].score ? j : top), 0);
  if (!Number.isFinite(best[last][index].score)) return null;
  const cuts = [];
  for (let k = last; k >= 0; k -= 1) {
    cuts.unshift(pauses[index].at);
    index = best[k][index].from;
  }
  return cuts;
}

async function generateNarration(transcript) {
  const hash = createHash("sha256").update(JSON.stringify({ model, voice, transcript })).digest("hex");
  if (existsSync(audioPath) && existsSync(hashPath) && (await readFile(hashPath, "utf8")).trim() === hash) {
    return;
  }
  const apiKey = process.env.FAL_KEY || execFileSync("skate", ["get", "fal_api_key@secrets"], { encoding: "utf8" }).trim();
  if (!apiKey) {
    if (existsSync(audioPath)) {
      return;
    }
    throw new Error("Set FAL_KEY to generate narration with Gemini 3.8 TTS on fal.");
  }

  const headers = { "Content-Type": "application/json", Authorization: `Key ${apiKey}` };
  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: transcript, voice, style_instructions: "Calm, warm documentary narration. Deliberate, confident pacing. Read exactly as written.", speakers: null, turns: null }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new Error(`fal Gemini TTS failed (${response.status}): ${await response.text()}`);
  }

  const queued = await response.json();
  if (!queued.request_id) throw new Error(`fal Gemini TTS returned no request ID: ${JSON.stringify(queued).slice(0, 500)}`);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const statusResponse = await fetch(`https://queue.fal.run/${model}/requests/${queued.request_id}/status`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!statusResponse.ok) throw new Error(`fal status failed (${statusResponse.status}): ${await statusResponse.text()}`);
    const status = await statusResponse.json();
    if (status.status === "COMPLETED") break;
    if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") throw new Error(`fal TTS failed: ${JSON.stringify(status).slice(0, 500)}`);
    if (attempt === 89) throw new Error("fal Gemini TTS timed out while queued");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const resultResponse = await fetch(`https://queue.fal.run/${model}/requests/${queued.request_id}`, { headers, signal: AbortSignal.timeout(180_000) });
  if (!resultResponse.ok) throw new Error(`fal result failed (${resultResponse.status}): ${await resultResponse.text()}`);
  const result = await resultResponse.json();
  if (!result.audio?.url) throw new Error(`fal Gemini TTS returned no audio URL: ${JSON.stringify(result).slice(0, 500)}`);
  const audioResponse = await fetch(result.audio.url, { signal: AbortSignal.timeout(180_000) });
  if (!audioResponse.ok) throw new Error(`fal audio download failed (${audioResponse.status})`);
  await writeFile(audioPath, Buffer.from(await audioResponse.arrayBuffer()));
  await writeFile(hashPath, `${hash}\n`, "utf8");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  const scenes = JSON.parse(await readFile(scenesPath, "utf8"));
  run("node", ["video/shared/capture.mjs", relative(cwd, join(projectDir, "shots.json")), join(publicDir, "shots")]);

  const fontsDir = join(cwd, "video", "shared", "fonts");
  await mkdir(join(publicDir, "fonts"), { recursive: true });
  for (const name of await readdir(fontsDir)) {
    if (name.endsWith(".woff2") || name === "fonts.css") {
      await copyFile(join(fontsDir, name), join(publicDir, "fonts", name));
    }
  }

  const skipTts = process.argv.includes("--skip-tts");
  if (!skipTts) {
    await generateNarration(scenes.map((scene) => scene.line).join("\n\n"));
  }

  if (existsSync(audioPath)) {
    await copyFile(audioPath, join(publicDir, "narration.wav"));
  }

  // Explicit duration is useful for an offline preview with an older cached WAV.
  const durationSeconds = Number(arg("duration") ?? (existsSync(audioPath) ? Math.ceil(ffprobeDuration(audioPath) + 1) : 70));
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Duration must be a positive number of seconds.");
  }
  const props = {
    label: film.label ?? "KEATING // 4.0",
    audioSrc: existsSync(audioPath) ? "narration.wav" : null,
    durationSeconds,
    scenes: await Promise.all(
      scenes.map(async ({ shot, title, kicker, body, line }) => {
        const png = await readFile(join(publicDir, "shots", `${shot}.png`));
        if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.toString("ascii", 12, 16) !== "IHDR") {
          throw new Error(`Invalid PNG header for ${shot}`);
        }
        return {
          shotSrc: `shots/${shot}.png`,
          width: png.readUInt32BE(16),
          height: png.readUInt32BE(20),
          title,
          kicker,
          body,
          weight: line.trim().split(/\s+/u).length + 1.5,
        };
      }),
    ),
  };
  if (props.audioSrc && !arg("duration")) {
    const cuts = narrationCuts(audioPath, props.scenes.map((scene) => scene.weight), ffprobeDuration(audioPath));
    if (cuts) {
      // Weights become seconds, so the composition's proportional split reproduces the cuts.
      const edges = [0, ...cuts, durationSeconds];
      props.scenes.forEach((scene, index) => { scene.weight = edges[index + 1] - edges[index]; });
      console.log(`Scene cuts at ${cuts.map((cut) => cut.toFixed(2)).join(", ")}s`);
    }
  }
  await writeFile(propsPath, `${JSON.stringify(props, null, 2)}\n`, "utf8");

  run("bunx", [
    "remotion",
    "render",
    entryPoint,
    "KeatingIntro",
    videoPath,
    "--config",
    configPath,
    "--public-dir",
    publicDir,
    "--props",
    propsPath,
    "--codec",
    "h264",
    "--audio-codec",
    "aac",
  ]);

  console.log(relative(cwd, videoPath));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
