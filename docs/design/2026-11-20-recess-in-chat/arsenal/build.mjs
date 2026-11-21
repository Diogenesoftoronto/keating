// bun docs/design/2026-11-20-recess-in-chat/arsenal/build.mjs [output.html]
import { spawnSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { bossRoster } from "../../../../web/src/components/recess/engine/boss-roster.js";
import { minibossRoster } from "../../../../web/src/components/recess/engine/miniboss-roster.js";
import { packs as authoredPacks } from "../../../../web/src/components/recess/engine/packs.js";
import { practiceLessons, shortChatFixture } from "./practice-content.mjs";

// The web install's Sharp binary uses the C++ runtime linked by Node on Nix.
if (process.versions.bun) {
  const child = spawnSync("node", process.argv.slice(1), { stdio: "inherit" });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const here = new URL("./", import.meta.url);
const web = new URL("../../../../web/", here);
const requireWeb = createRequire(new URL("package.json", web));
const esbuild = requireWeb("esbuild");
const sharp = requireWeb("sharp");
const recess = new URL("src/components/recess/", web);
const corePath = await realpath(new URL("engine/core.js", recess));
const patternsPath = await realpath(new URL("engine/patterns.js", recess));
const feedbackPath = await realpath(new URL("engine/feedback.js", recess));
const art = new URL("art/", recess);
const kit = new URL("../habits/art/", recess);
const manifest = JSON.parse(await readFile(new URL("art-manifest.json", recess), "utf8"));
const shell = await readFile(new URL("shell.html", here), "utf8");
const inlineLimit = 500_000;

const jiti = requireWeb("jiti").createJiti(import.meta.url);
const habits = new URL("src/keating/habits/", web);
const [{ recessQuestionCandidates }, { recessReadinessRules, recessContinuePrompt }] = await Promise.all([
  jiti.import(fileURLToPath(new URL("recess-lesson.ts", habits))),
  jiti.import(fileURLToPath(new URL("recess-readiness.ts", habits))),
]);
const lessons = practiceLessons(authoredPacks, recessQuestionCandidates);
const shortChat = shortChatFixture(lessons, recessReadinessRules, recessContinuePrompt);

// Use the Recess Markdown plugins at build time. Native MathML remains
// accessible in the offline file and needs neither KaTeX fonts nor browser JS.
const { createElement } = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
const [ReactMarkdown, remarkGfm, remarkMath, rehypeKatex] = await Promise.all(
  ["react-markdown", "remark-gfm", "remark-math", "rehype-katex"]
    .map(async name => (await import(pathToFileURL(requireWeb.resolve(name)).href)).default),
);
const markdown = {
  skipHtml: true,
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [[rehypeKatex, { output: "mathml", trust: false }]],
  components: {
    p: ({ children }) => children,
    a: ({ children }) => children,
    img: ({ alt }) => alt ?? null,
  },
};
const lessonStrings = new Set();
for (const pack of Object.values(lessons)) {
  for (const item of [...pack.gates, ...pack.examples, ...pack.revive]) {
    for (const text of [item.q, ...item.a, item.source.quote]) lessonStrings.add(text);
  }
  for (const myth of pack.myths) {
    for (const text of [myth.wrong, myth.right, myth.source.quote]) lessonStrings.add(text);
  }
  for (const text of [pack.explain.prompt, pack.explain.reference, pack.explain.source.quote]) lessonStrings.add(text);
}
const rich = Object.fromEntries([...lessonStrings].map(text => [
  text, renderToStaticMarkup(createElement(ReactMarkdown, markdown, text)),
]));

function replaceOnce(input, token, replacement) {
  if (input.split(token).length !== 2) throw new Error(`Expected exactly one ${token}`);
  return input.replace(token, () => replacement);
}

// Only this build lends the clock to the mockup so it can freeze a precise frame,
// pre-roll the encounter without rasterizing hidden frames, and resume on takeover.
const flightClock = {
  name: "mockup-flight-clock",
  setup(build) {
    build.onLoad({ filter: /[/\\]recess[/\\]engine[/\\]feedback\.js$/ }, async ({ path }) => {
      if (path !== feedbackPath) return;
      // The practice picker already identifies the opponent, its pattern and the kit.
      // Keep the actual joins and phases, and all feedback from earned mid-flight upgrades.
      const helperJoin = 'G.on("helperJoin", (d) => {';
      const phaseLabel = "pop(d.x, d.y + 18, d.name, G.pal.ink, 13, 1.5);";
      let contents = replaceOnce(await readFile(path, "utf8"), helperJoin, helperJoin + " if (G.o.settingPracticeKit?.()) return;");
      contents = replaceOnce(contents, phaseLabel, "if (!d.first || !G.o.practiceFinale) " + phaseLabel);
      return { contents, loader: "js", resolveDir: dirname(path) };
    });
    build.onLoad({ filter: /[/\\]recess[/\\]engine[/\\]patterns\.js$/ }, async ({ path }) => {
      if (path !== patternsPath) return;
      const source = await readFile(path, "utf8");
      const marker = 's[0] === "mark" && s[1] === scene';
      const contents = replaceOnce(source, marker, '(' + marker + ') || (typeof scene === "string" && scene.startsWith("op/") && s[0] === scene.slice(3))');
      return { contents, loader: "js", resolveDir: dirname(path) };
    });
    build.onLoad({ filter: /[/\\]recess[/\\]engine[/\\]core\.js$/ }, async ({ path }) => {
      if (path !== corePath) return;
      let source = await readFile(path, "utf8");
      source = replaceOnce(source, "function step(rdt) {", "function step(rdt, paint = true) {");
      source = replaceOnce(source, "      draw(); present();", "      if (!paint) return;\n      draw(); present();");
      source = replaceOnce(source, "      start, stop, bomb: G.bomb,", `      preview: {
        world: G,
        step,
        govern,
        get usesShader() { return Boolean(post && !post.lost && !G.calm && !postOff); },
        cueScript() { script.step(0); },
        resize: size,
        ownClock() { cancelAnimationFrame(raf); raf = 0; }
      },
      start, stop, bomb: G.bomb,`);
      return { contents: source, loader: "js", resolveDir: dirname(path) };
    });
  },
};

const browserBuild = {
  nodePaths: [fileURLToPath(new URL("node_modules/", web))],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  write: false,
};
async function bundle(entry, plugins = []) {
  const { outputFiles } = await esbuild.build({
    ...browserBuild, entryPoints: [fileURLToPath(new URL(entry, here))], plugins,
  });
  if (outputFiles.length !== 1) throw new Error("Expected one self-contained browser bundle");
  return outputFiles[0].text;
}
const [flightProgram, unpack] = await Promise.all([bundle("main.js", [flightClock]), bundle("unpack-practice.js")]);
const bossStyle = await readFile(new URL("boss-scene.css", recess), "utf8");
const styledShell = replaceOnce(shell, "<!--BOSS_STYLE-->", bossStyle);
const style = styledShell.match(/<style>([\s\S]*?)<\/style>/);
if (!style) throw new Error("Missing standalone stylesheet");
const css = await esbuild.transform(style[1], { loader: "css", minify: true, legalComments: "none" });
// Pack the trusted build output with the lesson copy and style so the portrait
// sheets can retain their resolution in a single offline file.
const practice = deflateRawSync(Buffer.from(JSON.stringify({ lessons, rich, shortChat, stylesheet: css.code, flightProgram })), { level: 9 }).toString("base64");
const template = replaceOnce(
  replaceOnce(styledShell, style[0], '<style id="flight-style">[hidden]{display:none!important}</style>'),
  "<!--FLIGHT_JS-->", `<script>${unpack.replace(/<\/script/gi, "<\\/script")}</script>`,
);

const atlases = new Map();
function atlas(dir, filename, width, quality) {
  const path = fileURLToPath(new URL(filename, dir));
  const key = JSON.stringify([path, width, quality]);
  if (!atlases.has(key)) {
    const image = sharp(path).resize({ width, withoutEnlargement: true })
      .avif({ quality, effort: 6, chromaSubsampling: "4:2:0" })
      .toBuffer().then(buffer => `data:image/avif;base64,${buffer.toString("base64")}`);
    atlases.set(key, image);
  }
  return atlases.get(key);
}

async function packToy(subject, geometry) {
  const source = manifest.toys[subject];
  const scale = geometry.cast / source.cell;
  const poses = {};
  for (const [role, file] of Object.entries(manifest.poses[subject])) {
    const cell = role === "wall" ? geometry.wall : role === "wall-fall" ? geometry.fall : geometry.pose;
    poses[role] = await atlas(art, file, cell * 4, 37);
  }
  return {
    src: await atlas(art, source.src, geometry.cast * 4, 42),
    cell: geometry.cast,
    box: source.box.map(box => box.map(n => n * scale)),
    axis: source.axis,
    poses,
  };
}

async function flightData(geometry) {
  const gear = name => atlas(kit, `kit-${name}.webp`, geometry.gear * 4, 45);
  const rivals = Promise.all([...Object.keys(bossRoster).filter(id => id !== "wall"), ...Object.keys(minibossRoster)].map(async id => {
    if (!manifest.rivals[id]) throw new Error(`Missing sprite sheet for ${id}`);
    const cell = Object.hasOwn(minibossRoster, id) ? geometry.mini : geometry.rival;
    return [id, await atlas(art, manifest.rivals[id], cell * 2, 40)];
  }));
  const [sheet, sit, fx, maths, biology, blasters, packs, toppers, rivalSheets] = await Promise.all([
    atlas(art, manifest.sheet, geometry.pilot * 8, 46),
    atlas(art, manifest.sit, 56, 42),
    atlas(art, manifest.fx.src, geometry.fx * 8, 36),
    packToy("maths", geometry),
    packToy("biology", geometry),
    gear("blasters"), gear("packs"), gear("toppers"), rivals,
  ]);
  return {
    rows: manifest.rows,
    hasJetpack: manifest.hasJetpack,
    sheet, sit,
    fx: { src: fx, rows: manifest.fx.rows, cell: geometry.fx },
    toys: { maths, biology },
    rivalSheets: Object.fromEntries(rivalSheets),
    practice,
    blasters, packs, toppers,
  };
}

// Spend the embed budget on the main opponents first. Every profile keeps
// the entire flight, the four poses of each rival and both subjects' cast art.
const compact = { pilot: 52, fx: 32, cast: 56, pose: 32, fall: 70, gear: 60, mini: 136 };
const sizes = [
  { ...compact, pilot: 56, rival: 224, mini: 160, wall: 152 },
  { ...compact, rival: 224, mini: 160, wall: 144 },
  { ...compact, rival: 160, wall: 144 },
  { ...compact, rival: 144, wall: 128 },
  { ...compact, pilot: 48, rival: 144, wall: 112 },
  { ...compact, pilot: 48, rival: 128, wall: 96, pose: 28, gear: 52 },
  { ...compact, pilot: 44, rival: 118, mini: 112, wall: 88, pose: 26, gear: 48 },
];
let html, chosen;
for (const size of sizes) {
  const data = JSON.stringify(await flightData(size)).replace(/</g, "\\u003c");
  html = replaceOnce(template, "<!--FLIGHT_DATA-->", `<script type="application/json" id="flight-data">${data}</script>`);
  if (Buffer.byteLength(html) <= inlineLimit) { chosen = size; break; }
}
const bytes = Buffer.byteLength(html);
if (bytes > inlineLimit) throw new Error(`Mockup exceeds the inline budget at ${bytes} bytes`);
const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../recess-arsenal.html", here));
await writeFile(output, html);
console.log(`${output} (${bytes.toLocaleString("en-US")} bytes; pose cells ${chosen.rival}px rival, ${chosen.mini}px miniboss, ${chosen.wall}px Wall)`);
