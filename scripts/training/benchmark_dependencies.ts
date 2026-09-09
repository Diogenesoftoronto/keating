/** Read-only dependency inventory for sealing a new benchmark release. */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const result = await Bun.build({
  entrypoints: [resolve(root, 'scripts/training/benchmark_check.ts')],
  target: 'bun', packages: 'bundle', metafile: true, throw: true,
  plugins: [{ name: 'benchmark-raw-markdown', setup(build) {
    build.onResolve({ filter: /\.md\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')) }));
    build.onLoad({ filter: /\.md$/ }, async args => ({ contents: await Bun.file(args.path).text(), loader: 'text' }));
  } }],
});
const metadata = typeof result.metafile === 'string' ? JSON.parse(result.metafile) : result.metafile;
if (!result.success || !metadata) throw Error('Could not resolve the complete checker dependency graph');
for (const output of Object.values(metadata.outputs)) {
  if (output.imports.length) throw Error('The dependency inventory has unresolved external imports');
}
const files = new Set([...Object.keys(metadata.inputs).map(path => relative(root, resolve(path))),
  'package.json', 'web/package.json', 'packages/learner-contracts/package.json',
  'tsconfig.json', 'web/tsconfig.json', 'bun.lock', 'web/bun.lock', 'bunfig.toml', 'web/bunfig.toml']);
const contract_sources: Record<string, string> = {};
for (const name of [...files].sort()) {
  if (name.startsWith('../') || name.includes('node_modules')) throw Error('Unversioned checker dependency: ' + name);
  contract_sources[name] = createHash('sha256').update(await Bun.file(resolve(root, name)).bytes()).digest('hex');
}
console.log(JSON.stringify({ contract_sources, contract_runtime: { name: 'bun', version: Bun.version, revision: Bun.revision } }, null, 2));
