import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Package the Settings explorer and its content-free recordings for a file:// browser.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--embed")) {
  throw new Error("Usage: bun build-diagnostics.ts [--embed /path/to/preview.html]");
}
const embedded = args.length > 0;
const output = embedded ? resolve(args[1]!) : join(import.meta.dir, "diagnostics.html");
const web = resolve(import.meta.dir, "../../../web");
const temp = await mkdtemp(join(tmpdir(), "keating-diagnostics-build-"));
try {
  const entry = join(temp, "inspector.js");
  await Bun.write(entry, [
    'import React from ' + JSON.stringify(join(web, "node_modules/react/index.js")) + ';',
    'import { createRoot } from ' + JSON.stringify(join(web, "node_modules/react-dom/client.js")) + ';',
    'import { OpenUiDiagnosticsExplorer, loadOpenUiRecordingLink } from ' + JSON.stringify(join(web, "src/components/settings/OpenUiDiagnosticsPanel.tsx")) + ';',
    'const root = createRoot(document.getElementById("root"));',
    'loadOpenUiRecordingLink(new URLSearchParams(location.search), ' + JSON.stringify(embedded ? "episodes" : "audit") + ').then(',
    '  recording => root.render(React.createElement(OpenUiDiagnosticsExplorer, {recording})),',
    '  () => root.render(React.createElement("p", {role:"alert"}, "The recording could not be loaded.")));',
  ].join("\n"));
  const result = await Bun.build({
    entrypoints: [entry], target: "browser", format: "iife", splitting: false, minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new AggregateError(result.logs, "Could not bundle the interface diagnostics explorer.");
  const js = await result.outputs.find(file => file.path.endsWith(".js"))?.text();
  const css = await result.outputs.find(file => file.path.endsWith(".css"))?.text();
  if (!js || !css) throw new Error("Missing JavaScript or styles.");
  const layout = embedded
    ? 'body{margin:0;color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif)}.openui-diagnostics>header{display:none}.ou-tools{margin-top:0}'
    : ':root{color-scheme:light dark;--background:light-dark(#fbfaf7,#1a1c1c);--foreground:light-dark(#252c2a,#e4ebe7);--muted:light-dark(#e8ebe7,#2d3532);--muted-foreground:light-dark(#4d5c54,#b4bfb7);--primary:light-dark(#277356,#83cbab);--border:light-dark(#cbd4cc,#47534d);--ring:var(--primary)}body{max-width:56rem;margin:0 auto;padding:clamp(1rem,4vw,3rem);color:var(--foreground);background:var(--background);font-family:system-ui,sans-serif}';
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Interface use · Keating</title><style>*{box-sizing:border-box}' + css + layout + '</style></head>',
    '<body><main id="root"></main><noscript>Enable JavaScript to explore the recorded teaching turns.</noscript>',
    '<script>' + js.replace(/<\/script/gi, "<\\/script") + '</script></body></html>',
  ].join("\n");
  await Bun.write(output, html);
  console.log(output);
} finally {
  await rm(temp, { recursive: true, force: true });
}
