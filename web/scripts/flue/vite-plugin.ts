import type { Plugin } from "vite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Build the Node-only harness separately; never import Flue into the DOM bundle. */
export function flueBrowserRuntime(): Plugin {
  let source: Buffer | undefined;
  let development = false;
  const id = "virtual:keating-flue-runtime";
  const route = "/_keating/flue-runtime.cjs";
  const host = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../spikes/flue-host",
  );
  const build = () => {
    if (source) return source;
    const directory = mkdtempSync(join(tmpdir(), "keating-flue-bundle-"));
    try {
      const output = join(directory, "runtime.cjs");
      execFileSync(
        "bun",
        [
          "build",
          "src/browser/runtime.ts",
          "--target=node",
          "--format=cjs",
          "--minify",
          "--outfile",
          output,
        ],
        { cwd: host, stdio: "pipe" },
      );
      return (source = readFileSync(output));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  return {
    name: "keating-flue-runtime",
    configResolved(config) {
      development = config.command === "serve";
    },
    resolveId(request) {
      if (request === id) return "\0" + id;
    },
    load(request) {
      if (request !== "\0" + id) return;
      if (development) return `export default ${JSON.stringify(route)};`;
      const reference = this.emitFile({
        type: "asset",
        name: "keating-flue-runtime.cjs",
        source: build(),
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
    configureServer(server) {
      server.watcher.add(resolve(host, "src"));
      server.watcher.on("change", (path) => {
        if (path.startsWith(resolve(host, "src") + "/")) source = undefined;
      });
      server.middlewares.use(route, (_request, response) => {
        try {
          response.setHeader("Content-Type", "application/javascript");
          response.end(build());
        } catch (error) {
          response.statusCode = 500;
          response.end(
            "Unable to build the Flue runtime. Install spikes/flue-host dependencies.",
          );
          server.config.logger.error(String(error));
        }
      });
    },
  };
}
