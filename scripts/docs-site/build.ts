import { cp, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";

type Screenshot = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};
type Section = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  code?: string;
  language?: string;
  links?: { label: string; href: string }[];
  screenshots?: Screenshot[];
};
type Page = { slug: string; title: string; description: string; group: string; sections: Section[] };
type Article = Omit<Page, "sections"> & { sections: (Section & { id: string })[] };

const root = import.meta.dir;
const origin = "https://docs.keating.help";
const app = "https://keating.help/chat";
const developerDocs = "https://dev.keating.help";
const contentFiles = ["getting-started.json", "learning.json"];
const reserved = new Set(["assets", "index", "404", "search", "robots", "sitemap", "favicon"]);
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const route = (slug: string) => slug ? `/${slug}/` : "/";

function requireRecord(value: unknown, location: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${location}: expected an object`);
}
function requireText(value: unknown, location: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw Error(`${location}: expected nonempty plain text`);
  }
}
function validateScreenshot(value: unknown, location: string): asserts value is Screenshot {
  requireRecord(value, location);
  for (const key of ["src", "alt", "caption"]) requireText(value[key], `${location}.${key}`);
  if (!/^\/assets\/screenshots\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(value.src as string)) {
    throw Error(`${location}.src: expected /assets/screenshots/lowercase-name.png`);
  }
  for (const key of ["width", "height"]) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) <= 0) {
      throw Error(`${location}.${key}: expected a positive integer pixel dimension`);
    }
  }
}
function validatePage(value: unknown, location: string): asserts value is Page {
  requireRecord(value, location);
  for (const key of ["slug", "title", "description", "group"]) requireText(value[key], `${location}.${key}`);
  const slug = value.slug as string;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || reserved.has(slug)) throw Error(`${location}: unsafe or reserved slug ${slug}`);
  if (!Array.isArray(value.sections) || !value.sections.length) throw Error(`${location}: sections must be a nonempty array`);
  value.sections.forEach((section: unknown, index: number) => {
    const at = `${location}.sections[${index}]`;
    requireRecord(section, at);
    requireText(section.heading, `${at}.heading`);
    for (const key of ["paragraphs", "bullets"]) {
      if (section[key] !== undefined) {
        if (!Array.isArray(section[key])) throw Error(`${at}.${key}: expected an array`);
        (section[key] as unknown[]).forEach((text, i) => requireText(text, `${at}.${key}[${i}]`));
      }
    }
    for (const key of ["code", "language"]) if (section[key] !== undefined) requireText(section[key], `${at}.${key}`);
    if (section.language !== undefined && section.code === undefined) throw Error(`${at}: language requires code`);
    if (section.screenshots !== undefined) {
      if (!Array.isArray(section.screenshots) || !section.screenshots.length) {
        throw Error(`${at}.screenshots: expected a nonempty array`);
      }
      section.screenshots.forEach((shot: unknown, i: number) => validateScreenshot(shot, `${at}.screenshots[${i}]`));
    }
    if (section.links !== undefined) {
      if (!Array.isArray(section.links)) throw Error(`${at}.links: expected an array`);
      section.links.forEach((link: unknown, i: number) => {
        requireRecord(link, `${at}.links[${i}]`);
        requireText(link.label, `${at}.links[${i}].label`);
        requireText(link.href, `${at}.links[${i}].href`);
      });
    }
  });
}

function sectionIds(sections: Section[]): Article["sections"] {
  const used = new Set<string>();
  return sections.map(section => {
    const base = section.heading.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    let id = `section-${base}`;
    for (let n = 2; used.has(id); n++) id = `section-${base}-${n}`;
    used.add(id);
    return { ...section, id };
  });
}

const pages: Article[] = [];
const slugs = new Set<string>();
for (const filename of contentFiles) {
  const content: unknown = await Bun.file(join(root, "content", filename)).json();
  if (!Array.isArray(content) || !content.length) throw Error(`${filename}: expected a nonempty Page array`);
  content.forEach((value: unknown, index: number) => {
    validatePage(value, `${filename}[${index}]`);
    if (slugs.has(value.slug)) throw Error(`Duplicate slug: ${value.slug}`);
    slugs.add(value.slug);
    pages.push({ ...value, sections: sectionIds(value.sections) });
  });
}
const groups = [...new Set(pages.map(page => page.group))];
// Group order and article order within each group follow the content files.
const ordered = groups.flatMap(group => pages.filter(page => page.group === group));
const homeAnchors = ["find-a-guide", ...groups.map((_, i) => `guide-group-${i + 1}`), "more-help"];
const targets = new Map<string, Set<string>>([
  ["/", new Set(["main", ...homeAnchors])],
  ...pages.map(page => [route(page.slug), new Set(["main", ...page.sections.map(section => section.id)])] as const),
]);

function validateLink(href: string, from: string): void {
  if (href !== href.trim() || /[\s\\\u0000-\u001f]/.test(href) || href.startsWith("//")) {
    throw Error(`Invalid link in ${from}: ${href}`);
  }
  const internal = href.startsWith("/") || href.startsWith("#");
  let url: URL;
  try { url = new URL(href, origin + from); } catch { throw Error(`Invalid URL in ${from}: ${href}`); }
  if (!internal && (!href.startsWith("https://") || url.username || url.password)) {
    throw Error(`Links must use HTTPS or /slug/ paths in ${from}: ${href}`);
  }
  if (url.origin === origin) {
    const anchors = targets.get(url.pathname);
    if (!anchors || url.search) throw Error(`Unknown internal page or noncanonical link in ${from}: ${href}`);
    if (url.hash && !anchors.has(decodeURIComponent(url.hash.slice(1)))) throw Error(`Unknown heading in ${from}: ${href}`);
  }
}
for (const page of pages) for (const section of page.sections) {
  for (const link of section.links ?? []) validateLink(link.href, route(page.slug));
}

function navigation(slug: string, prefix: string): string {
  return `<a class="nav-home" href="/"${slug === "" ? ' aria-current="page"' : ""}>Documentation home</a>${groups.map((group, index) =>
    `<section class="nav-group" aria-labelledby="${prefix}-group-${index}"><h2 id="${prefix}-group-${index}">${escape(group)}</h2><ul>${ordered.filter(page => page.group === group).map(page =>
      `<li><a href="${route(page.slug)}"${slug === page.slug ? ' aria-current="page"' : ""}>${escape(page.title)}</a></li>`).join("")}</ul></section>`).join("")}`;
}
function toc(items: { id: string; heading: string }[]): string {
  return `<ul>${items.map(item => `<li><a href="#${item.id}">${escape(item.heading)}</a></li>`).join("")}</ul>`;
}
function shell(title: string, description: string, body: string, slug: string, headings: { id: string; heading: string }[], notFound = false): string {
  const url = origin + route(slug);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Keating docs</title><meta name="description" content="${escape(description)}">
${notFound ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}">`}
<meta property="og:title" content="${escape(title)} · Keating docs"><meta property="og:description" content="${escape(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Keating docs">
<meta property="og:image" content="${origin}/assets/keatingbot.png"><meta property="og:image:alt" content="Keatingbot, Keating’s green-screen robot mascot">
<meta name="theme-color" content="#f1ece0"><link rel="icon" href="/assets/keatingbot.png">
<link rel="preload" href="/assets/space-mono-regular.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/assets/site.css"><script defer src="/assets/site.js"></script>
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><a class="brand" href="/" aria-label="Keating documentation home"><img src="/assets/keatingbot.png" alt="" width="48" height="48"><span>keating<span class="brand-sub">/ docs</span></span></a>
<nav class="header-links" aria-label="Keating websites"><a class="developer-link" href="${developerDocs}">Developer docs <span aria-hidden="true">↗</span></a><a class="open-app" href="${app}">Open Keating <span aria-hidden="true">↗</span></a></nav></header>
<div class="layout"><aside class="sidebar"><nav class="desktop-nav" aria-label="Documentation">${navigation(slug, "desktop")}</nav>
<details class="mobile-nav"><summary>Browse documentation<span aria-hidden="true">＋</span></summary><nav aria-label="Documentation">${navigation(slug, "mobile")}</nav></details></aside>
<main id="main" tabindex="-1">
<search class="search" aria-label="Documentation search"><label for="docs-search">Search the docs</label><div class="search-control"><span aria-hidden="true" class="search-symbol">⌕</span><input id="docs-search" type="search" placeholder="Find a guide or ask a keyword…" autocomplete="off" maxlength="200" aria-controls="search-results" aria-describedby="search-status" disabled><kbd aria-hidden="true">/</kbd></div>
<p id="search-status" class="search-status" role="status">Search needs JavaScript. Browse the guides below.</p>
<div id="search-results" class="search-results" hidden><ol></ol></div></search>
${body}
<footer class="site-footer"><p>Keating documentation</p><nav aria-label="More from Keating"><a href="${app}">Open Keating</a><a href="${developerDocs}">Developer docs</a><a href="https://github.com/Diogenesoftoronto/keating/issues">Report a docs issue <span aria-hidden="true">↗</span></a></nav></footer>
</main><aside class="page-contents"><nav aria-label="On this page"><p>On this page</p>${toc(headings)}</nav><a class="back-top" href="#main">Back to top <span aria-hidden="true">↑</span></a></aside></div>
</body></html>`;
}

function renderSection(section: Article["sections"][number]): string {
  return `<section class="article-section" id="${section.id}"><h2><a class="heading-anchor" href="#${section.id}">${escape(section.heading)}<span aria-hidden="true">#</span></a></h2>
${(section.paragraphs ?? []).map(text => `<p>${escape(text)}</p>`).join("")}
${section.bullets?.length ? `<ul>${section.bullets.map(text => `<li>${escape(text)}</li>`).join("")}</ul>` : ""}
${section.code ? `<figure class="code-block"><figcaption>${escape(section.language || "Example")}</figcaption><pre tabindex="0" aria-label="${escape(section.heading)} code example"><code>${escape(section.code)}</code></pre></figure>` : ""}
${(section.screenshots ?? []).map(shot => `<figure class="app-screenshot"><img src="${escape(shot.src)}" alt="${escape(shot.alt)}" width="${shot.width}" height="${shot.height}" loading="lazy" decoding="async"><figcaption>${escape(shot.caption)} <a href="${escape(shot.src)}" aria-label="${escape(`View full-size screenshot: ${shot.alt}`)}">View full-size screenshot <span aria-hidden="true">↗</span></a></figcaption></figure>`).join("")}
${section.links?.length ? `<ul class="section-links">${section.links.map(link => `<li><a href="${escape(link.href)}">${escape(link.label)}<span aria-hidden="true"> ${link.href.startsWith("https://") ? "↗" : "→"}</span></a></li>`).join("")}</ul>` : ""}</section>`;
}
function adjacent(page: Article | undefined, direction: "Previous" | "Next"): string {
  if (!page) return `<a href="/"><span>${direction === "Previous" ? "Start here" : "Keep exploring"}</span><strong>All guides ${direction === "Previous" ? "↑" : "→"}</strong></a>`;
  return `<a href="${route(page.slug)}" rel="${direction === "Previous" ? "prev" : "next"}"><span>${direction}</span><strong>${direction === "Previous" ? "← " : ""}${escape(page.title)}${direction === "Next" ? " →" : ""}</strong></a>`;
}
const first = ordered.find(page => page.slug === "start-here");
if (!first) throw Error("The homepage requires a start-here guide");
const homeHeadings = [{ id: "find-a-guide", heading: "Find a guide" }, ...groups.map((heading, index) => ({ id: `guide-group-${index + 1}`, heading })), { id: "more-help", heading: "Looking for developer docs?" }];
const home = `<section class="home-intro"><div><p class="eyebrow">The Keating learner’s guide</p><h1>Make room for<br><em>understanding.</em></h1><p class="lead">Get started with Keating, find your way around, and make the most of your next learning session.</p><div class="intro-actions"><a class="button" href="${route(first.slug)}">${escape(first.title)} <span aria-hidden="true">→</span></a><a href="${app}">Open Keating <span aria-hidden="true">↗</span></a></div></div><img class="hero-mascot" src="/assets/keatingbot.png" alt="Keatingbot, a friendly green-screen robot" width="240" height="240"></section>
<section class="guide-directory" id="find-a-guide"><div class="directory-title"><h2>Find a guide.</h2><p>Start at the beginning, or go straight to what you need.</p></div>${groups.map((group, index) => `<section class="directory-group" id="guide-group-${index + 1}"><h3>${escape(group)}</h3><ul>${ordered.filter(page => page.group === group).map(page => `<li><a href="${route(page.slug)}"><span><strong>${escape(page.title)}</strong><span class="guide-description">${escape(page.description)}</span></span><span class="guide-arrow" aria-hidden="true">↗</span></a></li>`).join("")}</ul></section>`).join("")}</section>
<section class="developer-note" id="more-help"><h2>Looking for developer docs?</h2><p>For the CLI, architecture, and building with Keating, visit the developer handbook.</p><a href="${developerDocs}">Read the developer handbook <span aria-hidden="true">↗</span></a></section>`;

const outputs = new Map<string, string>();
outputs.set("index.html", shell("Your guide to learning with Keating", "Get started with Keating. Guides to your account, learning sessions, and the tools you use along the way.", home, "", homeHeadings));
ordered.forEach((page, index) => {
  const body = `<article><header class="article-header"><p class="breadcrumb"><a href="/">Docs</a><span aria-hidden="true">/</span>${escape(page.group)}</p><h1>${escape(page.title)}</h1><p class="lead">${escape(page.description)}</p></header><details class="inline-contents"><summary>On this page</summary><nav aria-label="Article sections">${toc(page.sections)}</nav></details>${page.sections.map(renderSection).join("")}</article><nav class="adjacent-pages" aria-label="Previous and next guides">${adjacent(ordered[index - 1], "Previous")}${adjacent(ordered[index + 1], "Next")}</nav>`;
  outputs.set(`${page.slug}/index.html`, shell(page.title, page.description, body, page.slug, page.sections));
});
outputs.set("404.html", shell("Page not found", "Find a guide in the Keating documentation.", `<section class="not-found"><p class="eyebrow">404 · Page not found</p><h1>Let’s find your way.</h1><p class="lead">This address doesn’t point to a guide. Search the documentation above, or browse all guides from the home page.</p><a class="button" href="/">Browse all guides <span aria-hidden="true">→</span></a></section>`, "404", [], true));

// Check the generated shell as well as authored links, including fragment targets.
const referencedAssets = new Set<string>();
for (const [file, html] of outputs) {
  for (const [, asset] of html.matchAll(/\s(?:src|href)="(\/assets\/[^\"]+)"/g)) {
    if (!/^\/assets\/(?:[a-z0-9-]+\/)*[a-z0-9][a-z0-9.-]*$/.test(asset!)) throw Error(`Unsafe asset path in ${file}: ${asset}`);
    referencedAssets.add(asset!);
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]!);
  if (ids.length !== new Set(ids).size) throw Error(`Duplicate HTML id in ${file}`);
  const from = file === "index.html" || file === "404.html" ? "/" : `/${file.split("/")[0]}/`;
  for (const [, href] of html.matchAll(/\shref="([/#][^"]*)"/g)) {
    if (href!.startsWith("/assets/")) continue;
    if (href!.startsWith("#")) {
      if (!ids.includes(href!.slice(1))) throw Error(`Broken generated anchor in ${file}: ${href}`);
    } else validateLink(href!, from);
  }
}
outputs.set("search.json", JSON.stringify(ordered.map(page => ({
  title: page.title, description: page.description, group: page.group, url: route(page.slug),
  sections: page.sections.map(section => ({ heading: section.heading, url: `${route(page.slug)}#${section.id}`, text: [
    ...(section.paragraphs ?? []), ...(section.bullets ?? []), section.code ?? "", ...(section.links ?? []).map(link => link.label),
    ...(section.screenshots ?? []).flatMap(shot => [shot.alt, shot.caption]),
  ].join(" ") })),
}))));
outputs.set("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
outputs.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["", ...ordered.map(page => page.slug)].map(slug => `<url><loc>${origin}${route(slug)}</loc></url>`).join("")}</urlset>\n`);

// Stage the complete build first. Invalid content leaves the last good output intact.
const stage = await mkdtemp(join(root, ".public-build-"));
try {
  await cp(join(root, "assets"), join(stage, "assets"), { recursive: true });
  for (const asset of ["site.css", "site.js", "keatingbot.png", "space-mono-regular.ttf", "jetbrains-mono-regular.ttf"]) {
    if (!await Bun.file(join(stage, "assets", asset)).exists()) throw Error(`Missing asset: ${asset}`);
  }
  for (const asset of referencedAssets) {
    const info = await lstat(join(stage, asset.slice(1))).catch(() => null);
    if (!info?.isFile() || !info.size) throw Error(`Missing or invalid asset: ${asset}`);
  }
  // Check the actual PNG dimensions before publishing the reserved image space.
  for (const page of pages) for (const section of page.sections) for (const shot of section.screenshots ?? []) {
    const header = Buffer.from(await Bun.file(join(stage, shot.src.slice(1))).slice(0, 24).arrayBuffer());
    if (header.length !== 24 || header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || header.readUInt32BE(8) !== 13 || header.toString("ascii", 12, 16) !== "IHDR") {
      throw Error(`Invalid PNG screenshot in ${page.slug}: ${shot.src}`);
    }
    if (header.readUInt32BE(16) !== shot.width || header.readUInt32BE(20) !== shot.height) {
      throw Error(`Screenshot dimensions do not match PNG in ${page.slug}: ${shot.src}`);
    }
  }
  for (const [file, html] of outputs) {
    await mkdir(join(stage, file, ".."), { recursive: true });
    await Bun.write(join(stage, file), html);
  }
  await rm(join(root, "public"), { recursive: true, force: true });
  await rename(stage, join(root, "public"));
} finally {
  await rm(stage, { recursive: true, force: true });
}
const screenshotCount = pages.flatMap(page => page.sections.flatMap(section => section.screenshots ?? [])).length;
console.log(`Built ${ordered.length + 1} pages, a 404 page, ${screenshotCount} inline screenshots, search index, sitemap, and robots.txt for ${origin}.`);
