/** Read-only dependency inventory for sealing a new benchmark release. */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const result = await Bun.build({
  entrypoints: [resolve(root, 'scripts/training/benchmark_check.ts')],
  target: 'bun', packages: 'bundle', metafile: true, throw: true,
  plugins: [{ name: 'benchmark-raw-markdown', setup(build) {
    build.onResolve({ filter: /\.md\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')) }));
    build.onLoad({ filter: /\.md$/ }, async args => ({ contents: await Bun.file(args.path).text(), loader: 'text' }));
    // Vite `?url` asset imports (onnxruntime WASM loaded lazily by web stores) yield a URL string, not checker code;
    // their package version is already pinned through the hashed bun.lock.
    build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'vite-asset-url' }));
    build.onLoad({ filter: /.*/, namespace: 'vite-asset-url' }, () => ({ contents: 'export default "";', loader: 'js' }));
  } }],
});
const metadata = typeof result.metafile === 'string' ? JSON.parse(result.metafile) : result.metafile;
if (!result.success || !metadata) throw Error('Could not resolve the complete checker dependency graph');
for (const output of Object.values(metadata.outputs)) {
  if (output.imports.length) throw Error('The dependency inventory has unresolved external imports');
}
const files = new Set([...Object.keys(metadata.inputs).filter(path => !path.startsWith('vite-asset-url:')).map(path => relative(root, realpathSync(resolve(path)))),
  'package.json', 'web/package.json', 'packages/learner-contracts/package.json',
  'tsconfig.json', 'web/tsconfig.json', 'bun.lock', 'web/bun.lock', 'bunfig.toml', 'web/bunfig.toml']);
const contract_sources: Record<string, string> = {};
// npm code reached by the checker (e.g. the Julia judgement runtime's tokenizer) is not in git. It is identified
// by package name and installed version; bun.lock, hashed above, pins the exact resolution.
const contract_packages: Record<string, string> = {};
for (const name of [...files].sort()) {
  if (name.startsWith('../')) throw Error('Unversioned checker dependency: ' + name);
  const packagePath = /^(?:.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(name);
  if (packagePath?.[1].startsWith('@keating/')) {
    // Workspace packages may be installed as copies (web's file: dependencies); hash their in-repo source.
    const source = `packages/${packagePath[1].slice('@keating/'.length)}/${name.slice(packagePath.index + packagePath[0].length)}`;
    const [copy, original] = await Promise.all([Bun.file(resolve(root, name)).bytes(), Bun.file(resolve(root, source)).bytes()]);
    if (Buffer.compare(Buffer.from(copy), Buffer.from(original)) !== 0) throw Error('Installed workspace copy differs from source: ' + name);
    contract_sources[source] = createHash('sha256').update(original).digest('hex');
    continue;
  }
  if (packagePath) {
    const manifest = await Bun.file(resolve(root, name.slice(0, packagePath.index + packagePath[0].length), 'package.json')).json();
    if (manifest.name !== packagePath[1] || typeof manifest.version !== 'string') throw Error('Unidentified checker package: ' + name);
    contract_packages[manifest.name] = manifest.version;
    continue;
  }
  if (name.includes('node_modules')) throw Error('Unversioned checker dependency: ' + name);
  contract_sources[name] = createHash('sha256').update(await Bun.file(resolve(root, name)).bytes()).digest('hex');
}
console.log(JSON.stringify({ contract_sources, contract_packages, contract_runtime: { name: 'bun', version: Bun.version, revision: Bun.revision } }, null, 2));
