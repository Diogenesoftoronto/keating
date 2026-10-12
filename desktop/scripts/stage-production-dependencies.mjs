import { cp, mkdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

async function installedPackage(name, from) {
  const require = createRequire(join(from, "package.json"));
  let directory;
  try { directory = dirname(require.resolve(`${name}/package.json`)); }
  catch { directory = dirname(require.resolve(name)); }
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === name) return { source: await realpath(directory), manifest };
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate installed production dependency ${name} from ${from}`);
    directory = parent;
  }
}

/** Resolve the installed closure, including hoisted workspaces, without shipping development dependencies. */
export async function stageProductionDependencies({ packageDirectory, appDirectory }) {
  const root = join(appDirectory, "node_modules");
  const hoisted = new Map();
  async function stage(name, from, destinationParent, ancestors) {
    const { source, manifest } = await installedPackage(name, from);
    if (ancestors.get(name) === source || (!ancestors.has(name) && hoisted.get(name) === source)) return;
    const parent = hoisted.has(name) ? destinationParent : root;
    const destination = join(parent, name);
    if (parent === root) hoisted.set(name, source);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: true,
      filter: path => relative(source, path).split(sep)[0] !== "node_modules" });
    const next = new Map(ancestors).set(name, source);
    await dependencies(source, manifest, join(destination, "node_modules"), next);
  }
  async function dependencies(source, manifest, destinationParent, ancestors) {
    const optional = manifest.optionalDependencies ?? {};
    for (const name of Object.keys({ ...manifest.dependencies, ...optional })) {
      if (name in optional) {
        // Optional platform dependencies may be absent, but copy failures must remain fatal.
        try { await installedPackage(name, source); } catch (error) {
          if (error.code === "MODULE_NOT_FOUND" || error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") continue;
          throw error;
        }
      }
      await stage(name, source, destinationParent, ancestors);
    }
  }
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  await dependencies(packageDirectory, manifest, root, new Map());
}
