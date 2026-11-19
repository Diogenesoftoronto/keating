import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { GLYPHS, GROUPS, LABELS, svg, standalone } from "./glyphs.mjs";
import { botsBody, botsGalleryBody } from "./bots-page.mjs";
import { buildPublicBoard } from "./public-pages.mjs";
const out = process.argv[2] ?? "./out";
mkdirSync(`${out}/glyphs`, { recursive: true });
const read = (f) => readFileSync(f, "utf8");
const css = read("shared.css"), js = read("shared.js"), glyphJs = read("glyph-motion.js"), uiJs = read("ui-motion.js"), fxJs = read("shaders.js"), motion = read("motion.min.js");
const LEAN = { bots: "play", "bots-gallery": "gallery" };
// The companion pages carry large sprite sheets and must stay under the 512,000-byte inline limit, so they get the
// stylesheet without the blocks that only other pages use. A block runs from its "/* ── Name" comment to the next.
const LEAN_DROPS = ["Review: index", "Onboarding", "Dashboards (benchmark, activity)", "Profile", "Settings", "Rooms", "Courses", "Training data, exports", "Settings, second pass", "Chart sheet", "Live, self-paced, course builder", "Landing page"];
function leanCss(sheet) {
  const marks = [...sheet.matchAll(/\/\* ── ([^─*]+?) (?:─+|── \*\/)/g)].map((m) => [m.index, m[1].trim()]);
  let out = sheet.slice(0, marks[0][0]);
  marks.forEach(([start, name], k) => { if (!LEAN_DROPS.includes(name)) out += sheet.slice(start, marks[k + 1]?.[0] ?? sheet.length); });
  const kept = marks.map(([, name]) => name);
  const unknown = LEAN_DROPS.filter((name) => !kept.includes(name));
  if (unknown.length) throw new Error("lean stylesheet: no such block: " + unknown.join(", "));
  return out;
}
const TEXTURES = { glyphs: ["paper", "marble", "doodles"], review: ["paper", "marble"], chat: ["paper", "doodles"], surfaces: ["paper", "doodles"], more: ["paper"], system: ["paper"], lessons: ["paper", "doodles"], flows: ["paper"], landing: ["paper", "doodles"] };
const mime = { png: "image/png", webp: "image/webp" };
const companionJs = read("companion.js"), botsMeta = JSON.parse(read("assets/bots.json"));
const asset = (name) => `data:${mime[name.split(".").pop()]};base64,${readFileSync(`assets/${name}`).toString("base64")}`;
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;0,7..72,700;1,7..72,400&family=Space+Mono:wght@400;700&display=swap">`;
const spec = Object.fromEntries(Object.entries(GLYPHS).map(([k, v]) => [k, { d: v.d, play: v.play, hold: v.hold, loop: v.loop, press: v.press }]));
const I = (id, cls) => { if (!GLYPHS[id]) throw new Error(`no glyph "${id}"`); return svg(id, cls ?? ""); };

// ── gallery page, generated from the glyph data ──
const names = GROUPS.flatMap(([, n]) => n);
const missing = Object.keys(GLYPHS).filter((n) => !names.includes(n));
if (missing.length) throw new Error("ungrouped glyphs: " + missing);
const grid = GROUPS.map(([title, list]) => `<div class="ggrp"><span class="eb mu">${title}</span><div class="ggrid">${list.map((n) => `<button class="gl" title="${n}">${I(n, "xl")}<b>${LABELS[n]}</b><small>${GLYPHS[n].note}</small></button>`).join("")}</div></div>`).join("");
const sizes = `<div class="gsize">${names.map((n) => I(n)).join("")}</div><div class="gsize">${names.map((n) => I(n, "s")).join("")}</div>`;
const glyphsBody = `<div class="wrap">
<p class="lede"><b>Keating glyphs.</b> ${names.length} icons drawn for Keating on one grammar, each with its own motion, driven by Motion 14 (motion.dev). Every glyph plays once as the set arrives; hover or tap one to play it again. The review and chat boards below use this set.</p>
<div class="controls">
  <label>Theme <span class="tog" data-tog="theme"><button data-v="paper" aria-pressed="true">Paper</button><button data-v="dark" aria-pressed="false">Terminal</button></span></label>
  <label>Motion <span class="tog" data-tog="motion"><button data-v="full" aria-pressed="true">Full</button><button data-v="reduced" aria-pressed="false">Reduced</button></span></label>
  <label>Shaders <span class="tog" data-tog="fx"><button data-v="on" aria-pressed="true">On</button><button data-v="off" aria-pressed="false">Off</button></span></label>
</div>
<section class="board">
  <div class="board-h"><span class="n">G1</span><h2>The set</h2><p>Shown at 40px with what each one does, then at 15px and 13px as they sit in the interface.</p></div>
  <div class="kt gbox" data-enter="glyphs">${grid}${sizes}</div>
  <ol class="pts">
    <li><b>Straight lines only.</b> Every segment runs at 0, 45 or 90 degrees, with butt caps and mitre joins. Corners are cut, never rounded, so the lens, the bulb and the warning badge are all octagons. It echoes the slanted cut of the K and the hard shadows.</li>
    <li><b>One accent per glyph.</b> A part of each drawing is marked as its accent: the cursor pixel, the nib's ink line, the new branch. It is the text colour at rest and turns phosphor green on hover, focus and press, and stays lit while its control is selected.</li>
    <li><b>Sized for the interface.</b> A 24-unit grid with 3 units clear. Stroke is 1.9 units, 2.1 at 13px and 1.8 at 17px, so the weight stays near 1.2px on screen.</li>
    <li><b>What it replaces.</b> The app draws from Reicon and Lucide today, and its icons change weight on hover without moving. This set covers the ${names.length - 1} roles the two screens use, plus the K mark.</li>
  </ol>
</section>
<section class="board">
  <div class="board-h"><span class="n">G2</span><h2>In controls</h2><p>The same glyphs inside real controls. Hover, focus with the keyboard, press, and click Copy.</p></div>
  <div class="kt gbox" data-enter="demo"><div class="gdemo">
    <div class="comp"><div class="cbar" style="padding:6px;flex:1"><button class="ib" title="Attach files">${I("clip")}</button><button class="ib" title="Record an audio message">${I("mic")}</button><button class="b sm gh">${I("wave", "s")}Live</button><span class="sp"></span><button class="b sm gh">${I("bulb", "s")}Medium ${I("chev", "s")}</button><button class="send" title="Send message">${I("send")}</button></div></div>
    <div><button class="ib" title="Copy message" data-copy>${I("copy")}</button><button class="ib" title="Quote in your message">${I("quote")}</button><button class="ib" title="Helpful">${I("up")}</button><button class="ib" title="Not helpful">${I("dn")}</button><button class="ib" title="Fork session from here">${I("fork")}</button></div>
    <div><button class="b sm gh">${I("left", "s")}Reviews</button><button class="b ln">${I("export", "s")}Export</button><button class="b pri">${I("save", "s")}Save review</button></div>
    <div class="tabs"><span class="on">${I("pen", "s")}Notes <span class="cnt">3</span></span><span>${I("ruler", "s")}Rubric <span class="cnt">2/6</span></span><span>${I("refresh", "s")}Rewrites <span class="cnt">3</span></span></div>
    <div><button class="b sm pri">${I("check", "s")}Accept</button><button class="b sm ln">${I("x", "s")}Dismiss</button><button class="ib sm bd" title="Edit">${I("edit", "s")}</button><button class="ib sm bd" title="Delete">${I("trash", "s")}</button></div>
    <div><button class="b ln">${I("feather")}Socratic pass ${I("chev", "s")}</button><button class="b sm pri">${I("refresh", "s")}Retry response</button><button class="b sm pri">${I("plus", "s")}New</button><button class="b gh">${I("layers")}Materials</button><button class="b gh">${I("pen")}Review</button></div>
  </div></div>
  <ol class="pts">
    <li><b>Four kinds of motion.</b> A one-shot that plays when the pointer arrives (the nib rules its line). A pose held while you hover (the trash lid stays open). A loop while you hover (the live bars). A press (send launches).</li>
    <li><b>Three timings.</b> A quick spring, stiffness 480 and damping 20, for arrivals and presses. A softer one, 260 and 24, for releases and panels. One-shots run 0.3 to 0.7s on cubic-bezier(.2, .8, .2, 1), the curve keating-interaction-motion.css already uses.</li>
    <li><b>Colour and movement are separate.</b> Switch Motion to Reduced: the accent still lights and states still change, and nothing moves. The same switch follows the system's reduced-motion setting.</li>
    <li><b>Drawings and motion live in one file.</b> keating-glyphs.mjs holds each glyph's parts and its motion as data, so the same entries can drive motion/react components in the app.</li>
  </ol>
</section>
<section class="board">
  <div class="board-h"><span class="n">G3</span><h2>Shaders</h2><p>Six fragment shaders share one WebGL context. Move the pointer over the tiles, then switch Theme to Terminal and back.</p></div>
  <div class="kt gbox" data-enter="demo"><div class="fxgrid">
    <div class="fxt"><span class="eb mu">Marbled ink</span><div class="pass run" style="margin:0">${I("feather", "l")}<div><b>Reading the session&hellip;</b><span>Click to stop.</span></div><span class="eb" style="color:var(--red)">Stop</span></div><div class="track" style="width:100%;height:10px"><i class="fin" style="width:62%"></i><i class="dr" style="width:14%"></i></div><small class="faint" style="font-size:11px;line-height:1.45">A scan of combed marbling, pushed through a flow field so the ink keeps moving while Keating reads, and filling the finished part of the review bar.</small></div>
    <div class="fxt"><span class="eb mu">The pattern under the pointer</span><div class="hero"><h1>Move the pointer here</h1></div><small class="faint" style="font-size:11px;line-height:1.45">A dither drifts at the edges of an empty state. The study objects stay almost invisible until the pointer passes over them.</small></div>
    <div class="fxt"><span class="eb mu">The mascot's screen</span><div style="display:flex;align-items:center;gap:14px;flex:1"><i class="bot" style="width:84px;height:84px"></i><i class="bot" style="width:40px;height:40px"></i><i class="bot"></i></div><small class="faint" style="font-size:11px;line-height:1.45">The face leans toward the pointer and blinks on an irregular beat. The large one gets scanlines.</small></div>
    <div class="fxt"><span class="eb mu">Paper and glass</span><div style="flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center"><div class="prose" style="font-size:14px">Paper has tooth. Glass has scanlines.</div><div class="row" style="flex-wrap:wrap"><span class="chip">Paper: drawn once</span><span class="chip">Terminal: 30 fps</span></div></div><small class="faint" style="font-size:11px;line-height:1.45">Every frame gets one overlay: laid-paper grain in the light theme, a CRT in the dark one. Switching theme powers the picture down and back up.</small></div>
  </div></div>
  <ol class="pts">
    <li><b>Decoration only.</b> Nothing depends on a shader. With WebGL missing, Shaders off, or Motion reduced, the same interface renders with a still frame or none.</li>
    <li><b>One context, many surfaces.</b> A single offscreen WebGL canvas draws each effect and copies it into small 2D canvases, so a page of mascots and progress bars never hits the browser's context limit. Surfaces that are off screen stop drawing.</li>
    <li><b>Paper costs nothing after the first frame.</b> The grain is drawn once per frame size and multiplied over the page. Only the Terminal theme, the ink, the empty state and the mascot animate.</li>
    <li><b>Textures are scans, not noise.</b> Three generated tiles (laid paper, combed marbling, a line pattern of study objects) are sampled twice at different offsets and mixed, so the repeat never lines up.</li>
  </ol>
</section>
</div>`;

const pages = [["glyphs", "Keating glyphs", glyphsBody], ["review", "Keating review mockups", read("review.body.html")], ["chat", "Keating chat mockups", read("chat.body.html")], ["surfaces", "Keating onboarding, benchmark and activity", read("surfaces.body.html")], ["more", "Keating profile, rooms, courses and export", read("more.body.html")], ["system", "Keating settings and charts", read("system.body.html")], ["lessons", "Keating lesson components", read("lessons.body.html")], ["flows", "Keating Live, self-paced courses and course builder", read("flows.body.html")], ["landing", "Keating landing page", read("landing.body.html")], ["bots", "Keating companion", botsBody(I, botsMeta)], ["bots-gallery", "Keating animations", botsGalleryBody(I, botsMeta)]];
for (const [name, title, src] of pages) {
  let body = src.replace(/\{\{i:([a-z]+)(?::([a-z ]+))?\}\}/g, (_, id, cls) => I(id, cls));
  body = body.replace(/\{\{asset:([^}]+)\}\}/g, (_, f) => asset(f));
  const left = body.match(/\{\{[^}]*\}\}/g);
  if (left) throw new Error(`unresolved macros in ${name}: ${left.slice(0, 5).join(" ")}`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${fonts}<style>:root{--bot-img:url(${asset("bot.png")});--logo-img:url(${asset("logo.png")})${name === "more" ? `;--mini:url(${asset("bots-mini.webp")})` : ""}${name === "chat" ? `;--seat-img:url(${asset("bot-sit.webp")})` : ""}${name === "landing" ? `;--seat-img:url(${asset("bot-sit.webp")});--wave-img:url(${asset("bot-wave.webp")});--clap-img:url(${asset("bot-clap.webp")});--dizzy-img:url(${asset("bot-dizzy.webp")})` : ""}}${LEAN[name] ? leanCss(css) : css}</style></head><body>${body}
${LEAN[name] ? "" : `<script>/* Motion 14.14.0 (motion.dev), MIT licence. Tree-shaken build of animate, hover, press, inView, stagger. */
${motion}</script>`}
${LEAN[name] ? `<script>window.KBOTS={${LEAN[name]}:"${asset(`bots-${LEAN[name]}.webp`)}",meta:${JSON.stringify(botsMeta)}};</script>
<script>${companionJs}</script>` : `<script>window.KGLYPHS=${JSON.stringify(spec)};</script>
<script>${glyphJs}</script>
<script>window.KTEX=${JSON.stringify(Object.fromEntries(TEXTURES[name].map((t) => [t, asset(`tex-${t}.webp`)])))};</script>
<script>${uiJs}</script>
<script>${fxJs}</script>`}
<script>${js}</script></body></html>`;
  writeFileSync(`${out}/${name}-mockups.html`, html);
  console.log(name, (html.length / 1024).toFixed(0) + " KB", (body.match(/<svg class="i/g) || []).length + " glyphs");
}
buildPublicBoard(out);
for (const n of Object.keys(GLYPHS)) writeFileSync(`${out}/glyphs/${n}.svg`, standalone(n));
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${Object.keys(GLYPHS).map((n) => standalone(n).trim().replace(/^<svg[^>]*>/, `<symbol id="k-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="butt" stroke-linejoin="miter">`).replace(/<\/svg>$/, "</symbol>")).join("\n")}\n</svg>\n`;
writeFileSync(`${out}/keating-glyphs.svg`, sprite);
copyFileSync("glyphs.mjs", `${out}/keating-glyphs.mjs`);
console.log("exported", Object.keys(GLYPHS).length, "svg files, sprite, and keating-glyphs.mjs");
