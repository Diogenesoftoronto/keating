import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(import.meta.dir, "..");
const contents = readFileSync(resolve(directory, "REPORT.md"), "utf8");
const sections = [];
const article = Bun.markdown.html(contents).replace(/<h2>([^<]+)<\/h2>/g, (_, title) => {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
  sections.push({id, title});
  return '<h2 id="' + id + '">' + title + "</h2>";
}).replace(/<table>[\s\S]*?<\/table>/g, table => {
  const name = table.includes("<th>Tutor</th>") ? "Outcomes by tutor" : "Outcomes by decision model";
  return '<div role="region" class="table-wrap" tabindex="0" aria-label="' + name + '">' + table + "</div>";
});
const menu = sections.map(s => '<li><a href="#' + s.id + '">' + s.title + "</a></li>").join("");
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Does the learner get the interface the tutor wrote? · Keating</title><style>
:root{color-scheme:light dark;--paper:light-dark(#faf9f5,#171b19);--ink:light-dark(#1d3228,#e2eae4);--green:light-dark(#196342,#a4d8b6);--line:light-dark(#cdd7ce,#48574c);--well:light-dark(#f1f2ec,#252c27)}
*{box-sizing:border-box}html{background:var(--paper);color:var(--ink);font:normal 100%/1.62 "DM Sans",system-ui,sans-serif}
body{max-width:54rem;margin:0 auto;padding:1.5rem clamp(1rem,5vw,3rem) 4rem}h1,h2,h3{font-family:"Instrument Serif",Georgia,serif;font-weight:600;line-height:1.12;text-wrap:balance}
h1{font-size:clamp(2.3rem,5vw,3.5rem);max-width:20ch;margin:1.1rem 0}h2{font-size:1.9rem;margin:2.2rem 0 .6rem;padding-top:.8rem;border-top:1px solid var(--line)}
h3{font-size:1.35rem;margin-top:1.8rem}p{margin:.85rem 0}a{color:var(--green);text-underline-offset:.16em}a:hover,summary:hover{text-decoration-thickness:.14em}
nav{display:flex;align-items:baseline;flex-wrap:wrap;gap:.5rem 1.3rem;font-size:.92rem}nav details{max-width:100%}summary{cursor:pointer;color:var(--green)}nav ul{margin:.45rem 0;padding-left:1.2rem}
.table-wrap{max-width:100%;overflow-x:auto;margin:1.3rem 0}table{width:100%;border-collapse:collapse;font-size:.91rem}th,td{min-width:5rem;vertical-align:top;text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line)}thead{background:var(--well)}
pre{padding:.8rem 1rem;background:var(--well);border:1px solid var(--line);border-radius:.35rem;overflow-x:auto;font-size:.83rem}p code{overflow-wrap:anywhere;font-size:.9em}:focus-visible{outline:2px solid var(--green);outline-offset:2px}
</style><body><nav aria-label="Report navigation"><a href="index.html">Interactive showcase</a><details><summary>Jump to a section</summary><ul>${menu}</ul></details><a href="REPORT.md" download>Download Markdown</a></nav><main>${article}</main></body></html>`;
writeFileSync(resolve(directory, "report.html"), page);
