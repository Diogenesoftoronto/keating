import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const docs = join(root, "docs/walkthroughs");
const glyphPath = join(root, "docs/design/2026-11-19-review-chat-mockups/keating-glyphs.svg");
const fontPath = join(root, "video/shared/fonts/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff2");
const licensePath = join(root, "scripts/docs-site/assets/space-mono-LICENSE.txt");
const safeName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const catalog = [
  ["Start learning", [
    ["first-run", "target"], ["lesson-in-chat", "message"], ["companion", "bot"], ["phone-tour", "screen"],
  ]],
  ["Continue your work", [
    ["sessions-and-materials", "layers"], ["review-a-session", "note"], ["activity-and-benchmark", "trend"],
  ]],
  ["Study together", [
    ["courses", "book"], ["study-rooms", "people"], ["profile", "person"],
  ]],
  ["App settings and design", [
    ["settings", "gear"], ["your-data", "export"], ["design-system", "shapes"],
  ]],
];
const next = {
  "first-run": ["lesson-in-chat", "settings"],
  "lesson-in-chat": ["sessions-and-materials", "review-a-session"],
  "companion": ["lesson-in-chat", "settings"],
  "sessions-and-materials": ["review-a-session", "activity-and-benchmark"],
  "review-a-session": ["activity-and-benchmark", "your-data"],
  "activity-and-benchmark": ["review-a-session", "courses"],
  "courses": ["study-rooms", "profile"],
  "study-rooms": ["courses", "lesson-in-chat"],
  "profile": ["settings", "your-data"],
  "settings": ["profile", "your-data"],
  "your-data": ["review-a-session", "settings"],
  "phone-tour": ["lesson-in-chat", "sessions-and-materials"],
  "design-system": ["settings", "phone-tour"],
};

const esc = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

// PLAN.md intentionally uses only inline strong, code and italic in these fields.
function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>")
    .replace(/(^|\s)\*([^*]+)\*(?=\s|[.,!?]|$)/g, "$1<em>$2</em>");
}

function parsePlan(plan) {
  const guides = new Map();
  let current;
  for (const line of plan.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const match = /^## \d+\. (.+?) · \x60([a-z0-9-]+)\x60 · (\d+) s · (.+)$/.exec(line);
      current = undefined;
      if (!match) continue;
      const [, title, slug, seconds, viewport] = match;
      if (!safeName.test(slug) || guides.has(slug)) throw new Error("Invalid or duplicate guide slug: " + slug);
      current = { title, slug, seconds: Number(seconds), viewport, steps: [] };
      guides.set(slug, current);
    } else if (current) {
      const field = /^\*\*(Purpose|Audience)\*\* (.+?)\s*$/.exec(line);
      if (field) current[field[1].toLowerCase()] = field[2];
      const row = /^\| (\d+) \| (.*?) \| (.*?) \|$/.exec(line);
      if (row) current.steps.push({ number: Number(row[1]), result: row[2], caption: row[3] });
    }
  }
  if (!guides.size) throw new Error("No walkthrough headings found in PLAN.md.");
  for (const guide of guides.values()) {
    if (!guide.purpose || !guide.audience || !guide.steps.length) throw new Error("Incomplete guide " + guide.slug);
    for (const [index, step] of guide.steps.entries()) {
      if (step.number !== index + 1) throw new Error("Out-of-order steps in " + guide.slug);
    }
  }
  return guides;
}

function time(seconds) {
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}
const asset = (slug, suffix) => "media/" + slug + suffix;

async function loadMedia(slug) {
  const manifestFile = join(docs, asset(slug, "-chapters.json"));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!["desktop", "phone"].includes(manifest.viewport) ||
      !Number.isFinite(manifest.duration) || manifest.duration <= 0 ||
      !Number.isInteger(manifest.width) || manifest.width <= 0 ||
      !Number.isInteger(manifest.height) || manifest.height <= 0 ||
      !Array.isArray(manifest.chapters) || !manifest.chapters.length) {
    throw new Error("Malformed capture manifest for " + slug);
  }
  const files = [".mp4", ".vtt", "-poster.jpg"];
  if (manifest.webmBytes) files.push(".webm");
  let previous = -1;
  const names = new Set();
  for (const chapter of manifest.chapters) {
    if (typeof chapter.id !== "string" || !safeName.test(chapter.id) ||
        typeof chapter.still !== "string" || !safeName.test(chapter.still) ||
        !chapter.title || !chapter.explanation || !chapter.alt ||
        !Number.isFinite(chapter.start) || chapter.start <= previous ||
        chapter.start < 0 || chapter.start >= manifest.duration || names.has(chapter.id)) {
      throw new Error("Invalid chapter in " + manifestFile + " (" + chapter.id + ")");
    }
    names.add(chapter.id);
    previous = chapter.start;
    files.push("-" + chapter.still + ".jpg");
  }
  await Promise.all(files.map(suffix => access(join(docs, asset(slug, suffix)))));
  const vtt = await readFile(join(docs, asset(slug, ".vtt")));
  if (!/^WEBVTT(?:[ \t\r\n]|$)/.test(vtt.toString("utf8"))) throw new Error("Invalid WebVTT for " + slug);
  return { ...manifest, slug, vtt: vtt.toString("base64") };
}

const glyphIds = new Set(["kmark", "right", "play", "left", "quote", ...catalog.flatMap(([, entries]) => entries.map(([, glyph]) => glyph))]);
const glyph = name => '<svg class="glyph" aria-hidden="true" focusable="false"><use href="#k-' + name + '"></use></svg>';
const panel = (title, body) => '<section><h2>' + esc(title) + '</h2>' + body + '</section>';

function htmlTemplate({ title, head, content, css, symbols, license, script = "" }) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    "<title>" + esc(title) + "</title>",
    "<!-- Generated by scripts/walkthroughs/render-viewer.mjs. Edit the sources there or the plan. -->",
    "<!-- Space Mono font license:\n" + license + "\n-->",
    "<style>\n" + css.trimEnd() + "\n</style>",
    "</head>",
    "<body>",
    '<svg class="symbols" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><defs>\n' +
      symbols.join("\n") + "\n</defs></svg>",
    '<a class="skip" href="#main">Skip to content</a>',
    '<header class="masthead"><div class="shell"><a class="wordmark" href="index.html">' +
      glyph("kmark") + "Keating walkthroughs</a>" + head + "</div></header>",
    '<main id="main" class="shell" tabindex="-1">',
    content,
    "</main>",
    script ? "<script>\n" + script.trimEnd() + "\n</script>" : "",
    "</body>",
    "</html>",
    "",
  ].filter((line, index, lines) => line || index === lines.length - 1).join("\n");
}

function directoryItem(guide, name) {
  const { slug, title, purpose, seconds, captures } = guide;
  const [capture] = captures;
  const status = capture ? time(Math.ceil(capture.duration)) : "Plan · " + time(seconds);
  return '<li><a href="' + slug + '.html">' + glyph(name) +
    '<span><span class="catalog-title">' + esc(title) + '</span><span class="catalog-text">' +
    inline(purpose) + '</span></span><span class="directory-status">' + status + "</span></a></li>";
}

function indexPage(guides, shared) {
  const guide = guides.get("lesson-in-chat");
  const capture = guide?.captures[0];
  const seen = new Set();
  const groups = catalog.map(([name, entries]) => {
    const items = entries.flatMap(([slug, icon]) => {
      const entry = guides.get(slug);
      if (!entry) return [];
      seen.add(slug);
      return [directoryItem(entry, icon)];
    });
    return items.length ? panel(name, '<ul role="list">' + items.join("\n") + "</ul>") : "";
  });
  const other = [...guides.values()].filter(entry => !seen.has(entry.slug));
  if (other.length) groups.push(panel("More walkthroughs", '<ul role="list">' + other.map(entry => directoryItem(entry, "right")).join("\n") + "</ul>"));

  const feature = capture ? [
    '<section class="feature" aria-labelledby="featured">',
    '<a href="' + guide.slug + '.html" aria-label="' + esc("Open " + guide.title) + '">',
    '<img src="' + asset(capture.slug, "-poster.jpg") + '" alt="" width="' +
      capture.width + '" height="' + capture.height + '"></a>',
    '<div class="feature-body"><h2 id="featured">' + esc(capture.title ?? guide.title) + "</h2>",
    '<p>Follow a sample recursion lesson in Chat with a scripted tutor.</p>',
    '<a class="action" href="' + guide.slug + '.html">' + glyph("play") + "Watch the walkthrough</a></div>",
    "</section>",
  ].join("\n") : "";
  return htmlTemplate({
    ...shared, title: "Keating walkthroughs", head: '<a class="meta" href="PLAN.md">Recording plan</a>',
    content: [
      '<header class="page-heading"><h1>Walkthroughs</h1>',
      "<p>Learn to use Keating with step-by-step guides. Follow chapters, captions and stills where a recording is available.</p></header>",
      feature,
      '<div class="catalog" aria-label="Walkthrough directory">',
      groups.join("\n"),
      "</div>",
    ].join("\n"),
  });
}

function recordedSteps(capture) {
  return capture.chapters.map((chapter, index) => {
    const { id, start, title, explanation, alt, still } = chapter;
    const source = asset(capture.slug, "-" + still + ".jpg");
    return [
      '<li class="step" id="' + capture.slug + "-step-" + id + '">',
      '<h3><a href="' + asset(capture.slug, ".mp4#t=" + start.toFixed(3)) + '" data-seek="' + start + '">',
      '<span><span class="count">' + (index + 1) + ".</span>" + esc(title) + "</span>",
      '<span class="time" aria-label="At ' + time(start) + '">' + time(start) + "</span></a></h3>",
      "<p>" + esc(explanation) + "</p>",
      '<a class="still" href="' + source + '" aria-label="' + esc("View full-size still for " + title) + '">',
      '<img src="' + source + '" alt="' + esc(alt) + '" width="' + capture.width + '" height="' +
        capture.height + '" loading="lazy" decoding="async"></a>',
      "</li>",
    ].join("\n");
  }).join("\n");
}

function recordedPlayer(guide, capture) {
  const { slug } = capture;
  const sample = capture.transcript ? "Recorded in the local app with a scripted tutor and sample data." :
    guide.slug === "design-system" ? "Recorded on Keating’s design boards with sample data." :
      "Recorded with sample data.";
  return [
    '<figure class="player">',
    '<div class="screen' + (capture.width < capture.height ? " phone" : "") + '">',
    '<video controls preload="metadata" playsinline width="' + capture.width +
      '" height="' + capture.height + '" poster="' + asset(slug, "-poster.jpg") + '" aria-label="' + esc(guide.title) + '">',
    capture.webmBytes ? '<source src="' + asset(slug, ".webm") + '" type="video/webm">' : "",
    '<source src="' + asset(slug, ".mp4") + '" type="video/mp4">',
    '<track kind="captions" srclang="en" label="English" src="data:text/vtt;base64,' + capture.vtt + '">',
    "</video></div>",
    '<figcaption><div class="video-actions">',
    '<button type="button" hidden data-captions aria-pressed="false">Captions</button>',
    '<a href="' + asset(slug, ".mp4") + '" download>Download video</a>',
    '<a href="' + asset(slug, ".vtt") + '" download>Download captions</a>',
    "</div>",
    '<p class="sample">' + sample + "</p>",
    capture.viewerNote ? '<p class="sample">' + esc(capture.viewerNote) + "</p>" : "",
    "</figcaption></figure>",
  ].join("\n");
}

function guidePage(guide, guides, shared) {
  const { slug, captures } = guide;
  const [capture] = captures;
  const title = capture?.title ?? guide.title;
  const planned = "Planned recording · " + time(guide.seconds) + " · " + guide.viewport;
  const platform = take => slug === "design-system" ? "Design boards" : (take.viewport === "phone" ? "Phone web" : "Desktop web");
  const recorded = capture ? time(Math.ceil(capture.duration)) + " · " + platform(capture) : null;
  const related = (next[slug] ?? [...guides.keys()].filter(other => other !== slug).slice(0, 2))
    .map(other => guides.get(other)).filter(Boolean);
  const relatedMarkup = related.length ? [
    '<nav class="related" aria-labelledby="next">',
    '<h2 id="next">What to try next</h2><ul role="list">',
    ...related.map(entry => '<li><a href="' + entry.slug + '.html">' + glyph("right") + esc(entry.title) + "</a></li>"),
    "</ul></nav>",
  ].join("\n") : "";
  const actions = capture ? captures.map(take => [
    '<section class="walkthrough-take" id="' + take.viewport + '-recording">',
    captures.length > 1 ? '<h2 class="take-label">' + platform(take) + '</h2>' : "",
    '<div class="player-layout">',
    recordedPlayer(guide, take),
    '<section class="chapters" aria-labelledby="' + take.viewport + '-steps">',
    '<h2 id="' + take.viewport + '-steps">Steps</h2><ol class="step-list" role="list">',
    recordedSteps(take),
    "</ol></section></div></section>",
  ].join("\n")).join("\n") : [
    '<section class="chapters planned" aria-labelledby="steps">',
    '<h2 id="steps">Planned steps</h2><ol class="step-list" role="list">',
    ...guide.steps.map(step => '<li class="step"><h3><span class="count">' + step.number + ".</span>" +
      inline(step.caption) + "</h3><p>" + inline(step.result) + "</p></li>"),
    "</ol></section>",
  ].join("\n");
  return htmlTemplate({
    ...shared,
    title: title + " · Keating walkthroughs",
    head: '<a class="meta" href="index.html">' + glyph("left") + " All walkthroughs</a>",
    script: capture ? shared.script : "",
    content: [
      '<header class="page-heading"><h1>' + esc(title) + "</h1>",
      "<p>" + inline(guide.purpose) + "</p>",
      captures.length > 1
        ? '<p class="take-links">' + captures.map(take => '<a href="#' + take.viewport + '-recording">' + platform(take) + ' · ' + time(Math.ceil(take.duration)) + '</a>').join(" ") + '</p>'
        : '<p class="meta">' + esc(recorded ?? planned) + "</p>",
      "</header>",
      actions,
      relatedMarkup,
    ].join("\n"),
  });
}

const args = process.argv.slice(2);
if (args.length > 1 || args.some(value => value !== "--check")) {
  throw new Error("Usage: node scripts/walkthroughs/render-viewer.mjs [--check]");
}
const check = args.includes("--check");
const [style, glyphs, script, plan, font, license] = await Promise.all([
  readFile(join(here, "viewer.css"), "utf8"),
  readFile(glyphPath, "utf8"),
  readFile(join(here, "viewer.js"), "utf8"),
  readFile(join(docs, "PLAN.md"), "utf8"),
  readFile(fontPath),
  readFile(licensePath, "utf8"),
]);
const embeddedFont = '@font-face { font-family: "Space Mono"; src: url(data:font/woff2;base64,' +
  font.toString("base64") + ') format("woff2"); font-style: normal; font-weight: 400; font-display: swap; }\n';
const symbols = [...glyphs.matchAll(/<symbol id="k-([a-z]+)"[\s\S]*?<\/symbol>/g)].filter(([, id]) => glyphIds.has(id)).map(([value]) => value);
if (symbols.length !== glyphIds.size) throw new Error("Viewer glyph missing from " + glyphPath);
const shared = { css: embeddedFont + style, symbols, script, license: license.trim() };
const guides = parsePlan(plan);
await Promise.all([...guides.values()].map(async guide => {
  const slugs = guide.viewport === "desktop and phone"
    ? [guide.slug, guide.slug + "-desktop", guide.slug + "-phone"] : [guide.slug];
  const candidates = (await Promise.all(slugs.map(loadMedia))).filter(Boolean);
  guide.captures = ["desktop", "phone"].map(viewport => candidates.find(take => take.viewport === viewport)).filter(Boolean);
}));
const pages = new Map([
  ["index.html", indexPage(guides, { ...shared, script: "" })],
  ...[...guides.values()].map(guide => [guide.slug + ".html", guidePage(guide, guides, shared)]),
]);
const stale = [];
for (const [file, html] of pages) {
  const path = join(docs, file);
  if (check) {
    if (await readFile(path, "utf8").catch(() => null) !== html) stale.push(file);
  } else await writeFile(path, html);
}
if (stale.length) throw new Error("Regenerate walkthrough pages: " + stale.join(", "));
console.log((check ? "Verified " : "Wrote ") + pages.size + " walkthrough pages.");
