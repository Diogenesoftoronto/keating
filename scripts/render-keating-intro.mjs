import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";

const cwd = process.cwd();
const outDir = join(cwd, ".keating", "outputs", "video", "keating-intro");
const narrationPath = join(cwd, "video", "keating-intro", "narration.txt");
const propsPath = join(outDir, "props.json");
const audioPath = join(outDir, "narration.wav");
const videoPath = join(outDir, "keating-intro.mp4");
const entryPoint = join(cwd, "video", "keating-intro", "src", "index.ts");
const configPath = join(cwd, "video", "keating-intro", "remotion.config.ts");
const publicDir = join(cwd, "video", "keating-intro", "public", "generated");

const model = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
const voice = process.env.GEMINI_TTS_VOICE || "Kore";
const sampleRate = 24000;

const scenes = [
  ["docs/assets/intro.mp4", "Keating", "The hyperteacher", "A Socratic AI scaffold for people who still want to own their understanding.", 1.05],
  ["docs/assets/learning-flow.mp4", "Artifacts you can inspect", "Plans, maps, animations", "Keating turns a topic into visible learning material instead of a disposable answer.", 1.1],
  ["docs/assets/teacher-flow.mp4", "Teach, then verify", "Grounded pedagogy", "Lesson plans and verification checklists keep the teaching loop accountable.", 0.95],
  ["docs/assets/session-flow.mp4", "A live shell", "Policy, outputs, feedback", "The learner can inspect the teacher, browse artifacts, and record signals as the session unfolds.", 1],
  ["docs/assets/improve-flow.mp4", "It studies itself", "Benchmarks and evolution", "Policy search and prompt evolution make improvement visible instead of mysterious.", 1.15],
  ["docs/assets/tests.mp4", "Grounded by tests", "Diagnostics and checks", "Keating keeps its teaching machinery tied to reproducible local workflows.", 0.85],
  ["docs/assets/feedback-flow.mp4", "Own the voice", "Why it exists", "The goal is not passive agreement. The goal is a learner who can reconstruct, transfer, and speak.", 1.05],
];

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

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

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  const dataLength = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, pcm]);
}

async function generateNarration() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    if (existsSync(audioPath)) {
      return;
    }
    throw new Error("Set GEMINI_API_KEY to generate narration with Gemini TTS.");
  }

  const transcript = await readFile(narrationPath, "utf8");
  const body = {
    contents: [
      {
        parts: [
          {
            text: `Read this exact narration in a calm, warm, documentary voice. Keep the pacing deliberate and confident:\n\n${transcript}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
    },
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Gemini TTS failed (${response.status}): ${await response.text()}`);
  }

  const json = await response.json();
  const part = json.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
  const data = part?.inlineData?.data;
  if (!data) {
    throw new Error(`Gemini TTS returned no inline audio: ${JSON.stringify(json).slice(0, 500)}`);
  }
  await writeFile(audioPath, wavFromPcm(Buffer.from(data, "base64")));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  const skipTts = process.argv.includes("--skip-tts");
  if (!skipTts) {
    await generateNarration();
  }

  if (existsSync(audioPath)) {
    await copyFile(audioPath, join(publicDir, "narration.wav"));
  }

  const audioDuration = existsSync(audioPath) ? ffprobeDuration(audioPath) : Number(arg("duration", "96"));
  const durationSeconds = Math.max(30, Math.ceil(audioDuration + 1));
  const props = {
    audioSrc: existsSync(audioPath) ? "narration.wav" : null,
    durationSeconds,
    scenes: await Promise.all(
      scenes.map(async ([clipSrc, title, kicker, body, weight]) => {
        const sourcePath = join(cwd, clipSrc);
        const publicName = basename(clipSrc);
        await copyFile(sourcePath, join(publicDir, publicName));
        return {
          clipSrc: publicName,
          title,
          kicker,
          body,
          weight,
          clipDurationSeconds: ffprobeDuration(sourcePath),
        };
      }),
    ),
  };
  await writeFile(propsPath, `${JSON.stringify(props, null, 2)}\n`, "utf8");

  run("bunx", [
    "remotion",
    "render",
    entryPoint,
    "KeatingIntro",
    videoPath,
    "--config",
    configPath,
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
