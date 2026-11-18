// Run from the repository with `rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-holdout/preview/build.mjs`.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseOpenUIMessageSegments } from "../../../../../web/src/keating/openui/segments.ts";
import { tryCompileOpenUISourceToSharedDocument } from "../../../../../packages/learner-contracts/src/openui-source.ts";

const here = import.meta.dir;
const study = resolve(here, "..");
const web = resolve(here, "../../../../../web");
const requireWeb = createRequire(join(web, "package.json"));
const read = path => readFileSync(path, "utf8");
const json = path => JSON.parse(read(path));
function originalSamples() {
  const adjudication = json(join(study, "adjudication.json"));
  const cohort = json(join(study, "cohort.json"));
  return [
    { key: "spinner", label: "Spinner prediction", file: "MiniMax-M2.7-highspeed--spinner.json", kind: "question-group",
      note: "The tutor changes the learner’s observation from the same wedge to the colour blue. The prompt leaves the blue share unspecified, so the four fractions lack a single justified answer. The write-in field accepts a learner’s explanation. Finishing the check records a prediction in this tab without grading it." },
    { key: "bus", label: "Bus frequency", file: "segment-two--MiniMax-M2.7-highspeed--bus.json", kind: "simulation",
      note: "At 40 seats per bus, increasing frequency from 8 to 16 doubles offered capacity from 320 to 640 seats per hour. Spare seats move from a 44-seat shortfall to a 212-seat surplus. The chart initially varies extra demand. Choose “Buses per hour” under Vary to graph the requested relationship. The brief invites a prediction. The sliders work immediately, and the simulation collects no prediction to assess." },
  ].map(({ file, kind, ...sample }) => {
    const receipt = json(join(study, file));
    const text = receipt.public.text;
    const digest = createHash("sha256").update(text, "utf8").digest("hex");
    if (receipt.status !== "complete" || receipt.phase !== "released" || receipt.public.stop !== "stop"
      || digest !== adjudication[receipt.id]?.publicTextSha256) throw Error(`Unverified released reply in ${file}`);
    const segments = parseOpenUIMessageSegments(text).map(part => {
      if (part.type === "text") return part;
      if (!part.complete || part.format !== "source") throw Error(`Unexpected format in ${file}`);
      const result = tryCompileOpenUISourceToSharedDocument(part.rawProgram, { documentId: part.metadata.id,
        revision: part.metadata.revision, retention: part.metadata.lifecycle, createdAt: receipt.finishedAt });
      if (!result.ok || result.document.nodes.length !== 1 || result.document.nodes[0].type !== kind) throw Error(`Unexpected node in ${file}`);
      return { type: "document", document: result.document };
    });
    if (segments.filter(s => s.type === "document").length !== 1) throw Error(`Expected one document in ${file}`);
    return { ...sample, text, digest, prompt: cohort.cases.find(c => c.id === sample.key).prompt, segments };
  });
}

// Select the original QuestionGroup and its transitive local declarations. Other
// activities in this source file pull in independent inference, media and coding clients.
const ts = requireWeb("typescript");
function questionModule(path) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) declarations.set(d.name.text, node);
  }
  const required = new Set(), names = new Set();
  function include(node) {
    if (!node || required.has(node)) return;
    required.add(node);
    function visit(child) {
      if (ts.isIdentifier(child)) { names.add(child.text); include(declarations.get(child.text)); }
      ts.forEachChild(child, visit);
    }
    visit(node);
  }
  include(declarations.get("QuestionGroup"));
  return source.statements.filter(node => {
    if (required.has(node)) return true;
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) return false;
    const clause = node.importClause;
    return names.has(clause.name?.text) || clause.namedBindings && (ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.some(el => names.has(el.name.text)) : names.has(clause.namedBindings.name.text));
  }).map(node => node.getText(source)).join("\n") + "\nexport {QuestionGroup};";
}

export async function writeActivityPreview(samples, { directory = here, title = "Try the MiniMax replies · Keating" } = {}) {
  const build = await Bun.build({ entrypoints: [join(directory, "app.tsx")], target: "browser", format: "iife", minify: true,
    define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "two-offline-activities", setup(builder) {
      builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, args => ({ path: requireWeb.resolve(args.path) }));
      builder.onLoad({ filter: /\/openui\/shared-renderer\.tsx$/ }, args => ({ contents: questionModule(args.path), loader: "tsx" }));
      builder.onResolve({ filter: /\/MarkdownBlock$/ }, () => ({ path: join(directory, "text.tsx") }));
      builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: "build-time-styles" }));
      builder.onLoad({ filter: /.*/, namespace: "build-time-styles" }, () => ({ contents: "", loader: "js" }));
    } }] });
  if (!build.success) throw Error(build.logs.map(String).join("\n"));
  const javascript = await build.outputs.find(o => o.kind === "entry-point").text();

  // Narrow the product's generated CSS to selectors actually emitted by the real
  // renderer for these documents. Keep ordinary theme tokens, focus and responsive rules.
  const { createElement } = requireWeb("react");
  const { renderToStaticMarkup } = requireWeb("react-dom/server");
  const { SharedUiDocumentRenderer } = await import(join(web, "src/keating/openui/shared-renderer.tsx"));
  const classes = new Set();
  for (const s of samples) {
    const document = s.segments.find(p => p.type === "document").document;
    const html = renderToStaticMarkup(createElement(SharedUiDocumentRenderer, { document }));
    for (const match of html.matchAll(/\bclass="([^"]+)"/g)) for (const name of match[1].split(/\s+/)) classes.add(name);
  }
  const postcss = requireWeb("postcss"), selectors = requireWeb("postcss-selector-parser");
  const sheet = postcss.parse(read(join(web, "styled-system/styles.css")));
  sheet.walkRules(rule => {
    const cssClasses = [];
    selectors(root => root.walkClasses(node => cssClasses.push(node.value))).processSync(rule.selector);
    if (cssClasses.length && !cssClasses.some(c => classes.has(c))) rule.remove();
  });
  sheet.walkAtRules(rule => { if (rule.nodes && !rule.nodes.length) rule.remove(); });
  const activity = postcss.parse(read(join(web, "src/keating/openui/activity.css")));
  activity.walkRules(rule => { if (rule.selector.includes("__card-") || rule.selector.includes("__rating") || rule.selector.includes("shared-quiz-result")) rule.remove(); });
  const styles = [sheet.toString(), activity.toString(), ...["src/components/select.css", "src/components/quiz/activity-game.css", "src/components/simulation/simulation.css"].map(p => read(join(web, p))), read(join(here, "preview.css"))].join("\n");
  const compressed = str => Buffer.from(Bun.gzipSync(str, { level: 9 })).toString("base64");
  const data = JSON.stringify(samples).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title></head><body><div id="preview" role="status">Opening the offline examples…</div><noscript>Enable JavaScript to use the examples.</noscript><script id="replies" type="application/json">${data}</script><script>
async function unpack(encoded) {const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}
(async()=>{const [css,js]=await Promise.all([unpack('${compressed(styles)}'),unpack('${compressed(javascript)}')]);const style=document.createElement('style');style.textContent=css;document.head.append(style);const script=document.createElement('script');script.src=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));script.onload=()=>URL.revokeObjectURL(script.src);document.getElementById('preview').removeAttribute('role');document.body.append(script)})().catch(()=>{document.getElementById('preview').textContent='Open this file in a current browser that supports gzip decompression.'});</script></body></html>`;
  writeFileSync(join(directory, "minimax-interfaces.html"), html);
  console.log(`Wrote ${Buffer.byteLength(html).toLocaleString()} bytes. ${samples.map(s => `${s.key} ${s.digest}`).join(", ")}`);
}

if (import.meta.main) await writeActivityPreview(originalSamples());
