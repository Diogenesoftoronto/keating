/** Read-only inventory: v2 final checks AND isolated native-tool execution are sealed together. */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const result = await Bun.build({
  entrypoints: ['scripts/training/benchmark_check_v2.ts', 'scripts/training/benchmark_tool_step.ts'].map(path => resolve(root, path)),
  target: 'bun', packages: 'bundle', metafile: true, throw: true,
  plugins: [{ name: 'benchmark-raw-markdown', setup(build) {
    build.onResolve({ filter: /\.md\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')) }));
    build.onLoad({ filter: /\.md$/ }, async args => ({ contents: await Bun.file(args.path).text(), loader: 'text' }));
  } }],
});
const metadata = typeof result.metafile === 'string' ? JSON.parse(result.metafile) : result.metafile;
if (!result.success || !metadata) throw Error('Could not resolve the complete v2 checker and tool-loop dependency graph');
for (const output of Object.values(metadata.outputs)) {
  if (output.imports.length) throw Error('The v2 dependency inventory has unresolved external imports');
}
const files = new Set([...Object.keys(metadata.inputs).map(path => relative(root, resolve(path))),
  'scripts/training/benchmark_dependencies_v2.ts',
  'package.json', 'web/package.json', 'packages/learner-contracts/package.json',
  'tsconfig.json', 'web/tsconfig.json', 'bun.lock', 'web/bun.lock', 'bunfig.toml', 'web/bunfig.toml']);
const contract_sources: Record<string, string> = {};
for (const name of [...files].sort()) {
  if (name.startsWith('../') || name.includes('node_modules')) throw Error('Unversioned v2 checker dependency: ' + name);
  contract_sources[name] = createHash('sha256').update(await Bun.file(resolve(root, name)).bytes()).digest('hex');
}
console.log(JSON.stringify({ contract_sources, contract_runtime: { name: 'bun', version: Bun.version, revision: Bun.revision } }, null, 2));
