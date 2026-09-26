// Recuts a 16:9 film for social feeds: the film sits in a framed window on
// Keating paper, with captions burned in underneath (feeds autoplay muted).
//
//   node video/shared/social.mjs <in.mp4> <out.mp4> [--captions=in.vtt] [--aspect=9:16|1:1|4:5]
//     [--from=0] [--to=end] [--label="KEATING // 4.0"] [--url=keating.help] [--title="One short line"]
//
// Caption cues are clipped to the --from/--to window and shifted with it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const [input, output] = argv.filter((arg) => !arg.startsWith("--"));
if (!input || !output) {
  console.error("usage: social.mjs <in.mp4> <out.mp4> [--captions=in.vtt] [--aspect=9:16|1:1|4:5] [--from=s] [--to=s] [--label=text] [--url=text] [--title=text]");
  process.exit(2);
}

const FONTS = resolve(import.meta.dirname, "fonts");
const MONO_BOLD = join(FONTS, "i7dMIFZifjKcF5UAWdDRaPpZUFWaHg.woff2");
const palette = { paper: "f1ece0", ink: "1c211b", green: "1e9b50" };
const sizes = { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
const [W, H] = sizes[flag("aspect", "9:16")] ?? (() => { throw new Error("aspect must be 9:16, 1:1 or 4:5"); })();

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", input], { encoding: "utf8" });
const info = JSON.parse(probe.stdout);
const from = Number(flag("from", 0));
const to = Math.min(Number(flag("to", info.format.duration)), Number(info.format.duration));
const hasAudio = info.streams.some((stream) => stream.codec_type === "audio");

// Window: full width minus margins, 16:9, raised a little above centre so the
// caption band below it gets the larger share.
const margin = 60;
const winW = W - margin * 2;
const winH = Math.round((winW * 9) / 16 / 2) * 2;
const headerH = H >= 1350 ? 200 : 150;
const winY = Math.round(headerH + (H - headerH - winH) * (H > W ? 0.22 : 0.08));
const border = 6;
const shadow = 14;

const escapeText = (text) => text.replace(/[':\\%]/gu, "\\$&");
const title = flag("title");
const seconds = (stamp) => stamp.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
const assTime = (value) => {
  const cs = Math.max(0, Math.round(value * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

const work = mkdtempSync(join(tmpdir(), "keating-social-"));
try {
  const filters = [
    `color=c=0x${palette.paper}:s=${W}x${H}:r=30:d=${(to - from).toFixed(3)}[bg]`,
    `[0:v]scale=${winW}:${winH}:flags=lanczos,setsar=1[film]`,
    `[bg]drawbox=x=${margin + shadow}:y=${winY + shadow}:w=${winW}:h=${winH}:color=0x${palette.green}:t=fill,` +
      `drawbox=x=${margin - border}:y=${winY - border}:w=${winW + border * 2}:h=${winH + border * 2}:color=0x${palette.ink}:t=fill,` +
      `drawtext=fontfile=${MONO_BOLD}:text='${escapeText(flag("label", "KEATING // 4.0"))}':fontsize=${Math.round(W / 26)}:fontcolor=0x${palette.ink}:x=${margin}:y=${Math.round(headerH / 2 - W / 52)},` +
      `drawbox=x=${margin}:y=${headerH - 18}:w=${winW}:h=4:color=0x${palette.ink}:t=fill,` +
      `drawtext=fontfile=${MONO_BOLD}:text='${escapeText(flag("url", "keating.help"))}':fontsize=${Math.round(W / 30)}:fontcolor=0x${palette.green}:x=(w-tw)/2:y=h-${Math.round(H / 14)}` +
      (title ? `,drawtext=fontfile=${MONO_BOLD}:text='${escapeText(title)}':fontsize=${Math.round(W / 17)}:fontcolor=0x${palette.ink}:x=(w-tw)/2:y=${Math.round((headerH + winY) / 2)}-th/2` : "") +
      "[stage]",
    `[stage][film]overlay=x=${margin}:y=${winY}:shortest=1[framed]`,
  ];
  let last = "framed";

  const vtt = flag("captions");
  if (vtt) {
    const cues = readFileSync(vtt, "utf8").split(/\r?\n\r?\n/u)
      .map((block) => block.match(/([\d:.]+) --> ([\d:.]+)[^\n]*\n([\s\S]+)/u))
      .filter(Boolean)
      .map(([, start, end, text]) => ({ start: seconds(start) - from, end: Math.min(seconds(end), to) - from, text: text.trim().replace(/\n/gu, " ") }))
      .filter((cue) => cue.end > 0 && cue.start < to - from);
    const top = winY + winH + shadow + Math.round(H / 24);
    const size = Math.round(W / 17);
    const ass = [
      "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      // ASS colours are &HAABBGGRR; alignment 8 is top-centre, so MarginV is the band's top.
      `Style: Cap,Space Mono,${size},&H00${palette.ink.match(/../gu).reverse().join("")},&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,-1,0,1,0,0,8,${margin + 10},${margin + 10},${top},1`,
      "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      ...cues.map((cue) => `Dialogue: 0,${assTime(Math.max(0, cue.start))},${assTime(cue.end)},Cap,,0,0,0,,${cue.text.replace(/[{}]/gu, "")}`),
    ].join("\n");
    writeFileSync(join(work, "captions.ass"), `${ass}\n`);
    filters.push(`[framed]subtitles=filename=${join(work, "captions.ass")}:fontsdir=${FONTS}[captioned]`);
    last = "captioned";
  }
  // A short fade in and out so a loop in the feed doesn't pop.
  filters.push(`[${last}]fade=t=in:d=0.25,fade=t=out:st=${Math.max(0, to - from - 0.35).toFixed(3)}:d=0.35,format=yuv420p[out]`);

  const args = ["-v", "error", "-y", "-ss", String(from), "-to", String(to), "-i", input, "-filter_complex", filters.join(";"), "-map", "[out]"];
  if (hasAudio) args.push("-map", "0:a", "-af", `afade=t=in:d=0.2,afade=t=out:st=${Math.max(0, to - from - 0.35).toFixed(3)}:d=0.35`, "-c:a", "aac", "-b:a", "128k");
  args.push("-c:v", "libx264", "-preset", "slow", "-crf", "23", "-r", "30", "-movflags", "+faststart", output);
  const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`${output}: ${W}x${H}, ${(to - from).toFixed(1)}s${vtt ? ", captions burned in" : ""}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
