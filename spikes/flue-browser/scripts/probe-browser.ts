import { builtinModules } from "node:module";
import { readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build, type Plugin } from "vite";

const root = resolve(import.meta.dirname, "..");
const builtinNames = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);

interface ProbeResult {
  entry: string;
  builtins: string[];
  browserExternals: string[];
  emittedBytes: number;
  outcome: "browser-compatible" | "remote-only";
}

function builtinProbe(seen: Set<string>): Plugin {
  return {
    name: "keating-builtin-probe",
    enforce: "pre",
    resolveId(source) {
      if (builtinNames.has(source) || source.startsWith("node:")) {
        seen.add(source);
        // Stop at the first hard browser boundary. Letting Vite externalize
        // every server dependency makes the negative probe needlessly bundle
        // the entire Flue harness and can hide the decisive evidence in noise.
        throw new Error(`[keating-browser-builtin] ${source}`);
      }
      return null;
    },
  };
}

async function emittedJavaScript(outDir: string): Promise<string> {
  const files = await readdir(outDir, { recursive: true });
  const javascript = files.filter((file) => /\.(?:m?js)$/.test(file));
  return (
    await Promise.all(
      javascript.map((file) => readFile(resolve(outDir, file), "utf8")),
    )
  ).join("\n");
}

async function probe(entry: string, expected: ProbeResult["outcome"]) {
  const label = entry.replace(/\.ts$/, "").replaceAll("/", "-");
  const outDir = resolve(root, "dist/probes", label);
  const builtins = new Set<string>();

  await rm(outDir, { recursive: true, force: true });
  try {
    await build({
      root,
      logLevel: "silent",
      plugins: [builtinProbe(builtins)],
      build: {
        target: "es2022",
        outDir,
        emptyOutDir: true,
        lib: {
          entry: resolve(root, entry),
          formats: ["es"],
          fileName: label,
        },
        rollupOptions: {
          onwarn(warning, warn) {
            if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
          },
        },
      },
    });
  } catch (error) {
    if (builtins.size === 0) throw error;
  }

  const output = builtins.size === 0 ? await emittedJavaScript(outDir) : "";
  const browserExternals = [
    "__vite-browser-external",
    "browser-external:",
    "Module externalized for browser compatibility",
  ].filter((marker) => output.includes(marker));

  const result: ProbeResult = {
    entry,
    builtins: [...builtins].sort(),
    browserExternals,
    emittedBytes: new TextEncoder().encode(output).byteLength,
    outcome:
      builtins.size === 0 && browserExternals.length === 0
        ? "browser-compatible"
        : "remote-only",
  };

  if (result.outcome !== expected) {
    throw new Error(
      `${entry}: expected ${expected}, observed ${result.outcome}: ${JSON.stringify(result)}`,
    );
  }

  return result;
}

const results = [];
results.push(await probe("src/browser-client.ts", "browser-compatible"));
results.push(await probe("src/keating-agent.ts", "remote-only"));
results.push(await probe("src/node-runtime.ts", "remote-only"));

console.log(JSON.stringify({ flueVersion: "2.0.3", results }, null, 2));
