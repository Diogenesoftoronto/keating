import { describe, expect, test } from "bun:test";
import { isApplicationPublicAsset, webBuildTarget } from "../../scripts/web-build-target";

describe("application build assets", () => {
  test("keeps assets required by chat, activities, status and local runtimes", () => {
    for (const path of ["brand/logo-lockup-compact.avif", "brand/mascot-full.avif", "brand/stop-motion-v1/keatingbot-body-thinking.avif", "brand/bot-status-v1/loading.avif", "brand/keatingbot-insufficient-funds-v3.png", "textures/recall-felt-v1.webp", "vendor/strudel-web-1.3.0/index.js", "needle-wasm/needle.wasm", "pwa-192x192.png", "favicon.svg", "sw-update-reload.js"]) {
      expect(isApplicationPublicAsset(path)).toBe(true);
    }
  });
  test("excludes video, reports, tutorials, downloads and source artwork", () => {
    for (const path of ["tapes/launch.mp4", "posters/launch.jpg", "reports/evaluation.json", "tutorial/chat.webp", "downloads/installer.deb", "landing/hero.png", "brand/masters/source.png", "brand/mascot-full.png", "keating-metaharness.pdf", "sitemap.xml"]) {
      expect(isApplicationPublicAsset(path)).toBe(false);
    }
  });
  test("rejects accidental unsupported build targets", () => {
    const previous = process.env.KEATING_WEB_BUILD_TARGET;
    try {
      process.env.KEATING_WEB_BUILD_TARGET = "invalid";
      expect(webBuildTarget).toThrow("Unknown KEATING_WEB_BUILD_TARGET");
      process.env.KEATING_WEB_BUILD_TARGET = "app";
      expect(webBuildTarget()).toBe("app");
      delete process.env.KEATING_WEB_BUILD_TARGET;
      expect(webBuildTarget()).toBe("site");
    } finally {
      if (previous === undefined) delete process.env.KEATING_WEB_BUILD_TARGET;
      else process.env.KEATING_WEB_BUILD_TARGET = previous;
    }
  });
});
