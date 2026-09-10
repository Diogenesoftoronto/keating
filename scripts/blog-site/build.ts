import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Run within the repository. The resulting dist/ is the isolated service root;
// its bundled imports have no dependency on the rest of this checkout.
const root = import.meta.dir;
const out = join(root, "dist");
await mkdir(out, { recursive: true });
const result = await Bun.build({
  entrypoints: [join(root, "server.ts")], outdir: out, target: "bun", format: "esm",
  packages: "bundle", minify: true, define: { "process.env.NODE_ENV": '"production"' },
});
if (!result.success) throw new AggregateError(result.logs, "Blog bundle failed");
await cp(join(root, "assets"), join(out, "assets"), { recursive: true });
for (const name of ["logo-lockup-compact.avif", "mascot-head-v2.png"]) {
  await cp(join(root, "../../web/public/brand", name), join(out, "assets", name));
}
const katex = dirname(Bun.resolveSync("katex/package.json", root));
await cp(join(katex, "dist"), join(out, "assets/katex"), { recursive: true, filter: source => !source.endsWith(".js") && !source.endsWith(".mjs") });
for (const name of ["railpack.json", "railway.toml"]) await cp(join(root, name), join(out, name));
await writeFile(join(out, "package.json"), JSON.stringify({ name: "keating-blog", private: true, type: "module", packageManager: "bun@1.3.13", scripts: { start: "bun server.js" } }, null, 2) + "\n");
// Railway otherwise inherits the repository's dist/ ignore when uploading.
await writeFile(join(out, ".railwayignore"), "!**\nnode_modules/\n**/node_modules/\n");
await readFile(join(out, "server.js"));
console.log(`Standalone blog upload ready: ${out}`);
