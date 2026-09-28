import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

export function webBuildTarget(): "app" | "site" {
  const target = process.env.KEATING_WEB_BUILD_TARGET;
  if (target && target !== "app" && target !== "site") {
    throw new Error(`Unknown KEATING_WEB_BUILD_TARGET: ${target}`);
  }
  return target === "app" ? "app" : "site";
}

/** Runtime assets are deliberately allowlisted; new marketing media cannot
 * silently expand the npm package or desktop installer. */
export function isApplicationPublicAsset(path: string): boolean {
  const name = path.replaceAll("\\", "/");
  if (/^(avatars|audio|textures|vendor|needle-wasm)\//.test(name)) return true;
  if (/^brand\/(stop-motion-v1|bot-status-v1|bot-frames-v1)\//.test(name)) return true;
  if (/^brand\/(logo-lockup-compact\.avif|mascot-(full|head-v2|lotus)\.avif|keatingbot-(credits-ready|insufficient-funds|wallet-refresh)-v\d+\.png)$/.test(name)) return true;
  return /^(favicon[^/]*\.(png|svg)|apple-touch-icon[^/]*\.(png|svg)|pwa-[^/]*\.(png|svg)|sw-update-reload\.js)$/.test(name);
}

export function applicationPublicAssetsPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "keating-application-public-assets",
    apply: "build",
    configResolved(resolved) { config = resolved; },
    // Public files must exist before PWA generates its precache manifest.
    writeBundle() {
      if (webBuildTarget() !== "app") return;
      const source = resolve(config.root, "public");
      const destination = resolve(config.root, config.build.outDir);
      for (const entry of readdirSync(source, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const fullPath = resolve(entry.parentPath, entry.name);
        const relative = fullPath.slice(source.length + 1).replaceAll("\\", "/");
        if (!isApplicationPublicAsset(relative)) continue;
        const output = resolve(destination, relative);
        mkdirSync(resolve(output, ".."), { recursive: true });
        cpSync(fullPath, output);
      }
    },
  };
}
