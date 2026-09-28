import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(desktopRoot, "../web/.output");
const destination = join(desktopRoot, "dist/nitro");
const entry = join(source, "server/index.mjs");
const appDestination = join(desktopRoot, "dist/app");
const p2pSource = resolve(desktopRoot, "../packages/p2p-core");

try {
	await access(entry);
} catch {
	throw new Error(`Nitro output is missing at ${entry}. Run the web production build before staging desktop resources.`);
}

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, force: true });

// electron-builder cannot safely follow Bun's workspace symlink out of the
// desktop package. Build a self-contained app directory instead, retaining
// only the compiled Electron files and the P2P production dependency closure.
await rm(appDestination, { recursive: true, force: true });
await mkdir(appDestination, { recursive: true });
for (const entry of await readdir(join(desktopRoot, "dist"), { withFileTypes: true })) {
	if (!entry.isFile() || !(entry.name.endsWith(".js") || entry.name.endsWith(".cjs"))) continue;
	if (entry.name === "preload.js") continue;
	await cp(join(desktopRoot, "dist", entry.name), join(appDestination, entry.name));
}

const desktopPackage = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));
await writeFile(
	join(appDestination, "package.json"),
	JSON.stringify(
		{
			name: desktopPackage.name,
			version: desktopPackage.version,
			description: desktopPackage.description,
			author: desktopPackage.author,
			homepage: desktopPackage.homepage,
			license: desktopPackage.license,
			private: true,
			type: "module",
			main: "main.js",
			dependencies: {
				"@keating/p2p-core": "file:node_modules/@keating/p2p-core",
				"onnxruntime-node": "1.29.0",
			},
		},
		null,
		2,
	) + "\n",
);

const stagedP2P = join(appDestination, "node_modules/@keating/p2p-core");
await mkdir(stagedP2P, { recursive: true });
await Promise.all([
	cp(join(p2pSource, "dist"), join(stagedP2P, "dist"), { recursive: true, dereference: true }),
	cp(join(p2pSource, "package.json"), join(stagedP2P, "package.json"), { dereference: true }),
	cp(join(p2pSource, "node_modules"), join(appDestination, "node_modules"), {
		recursive: true,
		dereference: true,
	}),
]);


// ONNX Runtime uses a stable Node-API binding; keep its external data and shared libraries beside the addon.
const desktopRequire = createRequire(join(desktopRoot, "package.json"));
for (const name of ["onnxruntime-node", "onnxruntime-common"]) {
  // Bun may hoist workspace dependencies to the repository root. Resolve the
  // installed entry and find its package instead of assuming a local folder.
  let from = dirname(desktopRequire.resolve(name));
  while (true) {
    let manifest;
    try { manifest = JSON.parse(await readFile(join(from, "package.json"), "utf8")); } catch {}
    if (manifest?.name === name) break;
    const parent = dirname(from);
    if (parent === from) throw new Error(`Cannot locate installed package ${name}`);
    from = parent;
  }
  await cp(from, join(appDestination, "node_modules", name), { recursive: true, dereference: true });
}
await cp(resolve(desktopRoot, "../node_modules/@huggingface/tokenizers/LICENSE"), join(appDestination, "JULIA-TOKENIZER-LICENSE.txt"));

console.log(`Staged packaged Nitro runtime: ${destination}`);
console.log(`Staged self-contained Electron app: ${appDestination}`);
