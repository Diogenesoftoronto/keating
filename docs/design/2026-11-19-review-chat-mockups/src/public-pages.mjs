import { readFileSync, writeFileSync } from "node:fs";
import { buildPublicComparison } from "./public-comparison.mjs";
import { buildPricingPhoneBoard } from "./pricing-phone.mjs";
import { svg } from "./glyphs.mjs";

const pages = [
  ["pricing", "Pricing", "card", "Compare Free and Personal, then choose a prepaid credit amount. The local build shows the waitlist."],
  ["download", "Download", "down", "The alpha installer with Android selected. Switch between the lesson, quiz and flashcard previews."],
  ["blog", "Blog", "folder", "Search the dated archive or browse by tag. The captures use the local 46-post archive."],
  ["post", "Blog post", "note", "“Keating in the Room with You,” with section links derived from the article headings."],
  ["paper", "Paper", "doc", "Read the abstract, open the PDF, or jump directly to a section in the paper."],
  ["privacy", "Privacy", "lock", "Jump to device storage, rights, or any of the 14 policy sections."],
  ["terms", "Terms", "checklist", "Navigate 18 sections from the contents or download a printable copy."],
];

const asset = (path, mime) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;

export function buildPublicBoard(out) {
  const paper = asset("assets/tex-paper.webp", "image/webp");
  const styles = readFileSync("public-pages.css", "utf8");
  const nav = pages.map(([id, title, glyph]) =>
    `<a href="#${id}">${svg(glyph)}${title}</a>`).join("\n");
  const sections = pages.map(([id, title, , description]) => {
    const phoneDetails = id === "pricing" ? ' <a class="compare" href="pricing-phone.html">See all phone pricing sections</a>' : "";
    const capture = (device, width, height) =>
      `<img class="${device}" width="${width}" height="${height}" loading="lazy"
        alt="${title}, ${device} layout" src="${asset(`assets/public-pages/${id}-${device}.avif`, "image/avif")}">`;
    return `<section id="${id}" aria-labelledby="${id}-title">
      <header><div class="heading"><h2 id="${id}-title">${title}</h2><a class="mobile-index" href="#pages">${svg("up")} Pages</a></div><p>${description} <a class="compare" href="public-comparison.html#${id}">Compare with earlier mockups</a>${phoneDetails}</p></header>
      <figure aria-label="${title} page captures">
        ${capture("desktop", 1280, 840)}${capture("phone", 390, 844)}
      </figure>
    </section>`;
  }).join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keating · Public pages</title><style>:root{--paper-tile:url("${paper}")}${styles}</style></head>
<body><div class="layout">
  <aside id="pages"><a class="back" href="landing-mockups.html">${svg("left")} Landing board</a>
    <h1>Public pages</h1>
    <nav aria-label="Pages">${nav}</nav>
    <fieldset><legend>Viewport</legend>
      <label><input type="radio" name="view" value="auto" checked>Auto</label>
      <label><input type="radio" name="view" value="desktop">Desktop</label>
      <label><input type="radio" name="view" value="phone">Phone</label>
    </fieldset>
  </aside>
  <main>${sections}</main>
</div></body></html>`;
  writeFileSync(`${out}/public-mockups.html`, html);
  buildPublicComparison(out, pages);
  buildPricingPhoneBoard(out);
  console.log("public pages", Math.round(Buffer.byteLength(html) / 1024) + " KB");
}
