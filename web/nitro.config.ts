import { defineNitroConfig } from "nitro/config";

const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

const crossOriginScriptHeaders = {
  ...crossOriginIsolationHeaders,
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Access-Control-Allow-Origin": "*",
};

export default defineNitroConfig({
  renderer: {
    // Nitro was inlining the source web/index.html template into the server
    // bundle, which still references /src/main-react.tsx. In production that
    // path falls through to HTML and blanks the app. Force the renderer to use
    // the Vite-built shell instead.
    template: "./dist/index.html",
    static: true,
  },
  // Ensure that /assets/* requests return 404 if not found, 
  // rather than falling back to index.html (SPA fallback).
  routeRules: {
    // PostHog reverse proxy. The browser SDK is configured with
    // `api_host: '/ingest'` so analytics traffic is same-origin (avoids ad
    // blockers / third-party cookie issues). In dev this is handled by
    // web/vite.config.ts `server.proxy`; in production Nitro must proxy it.
    // These rules are more specific than the `/**/*.js` static rule below, so
    // PostHog's `array.js` / `static` asset requests reach the proxy instead
    // of hitting the `fallthrough: false` 404.
    "/ingest/static": { proxy: { to: "https://us-assets.i.posthog.com/static" } },
    "/ingest/static/**": { proxy: { to: "https://us-assets.i.posthog.com/static/**" } },
    "/ingest/array": { proxy: { to: "https://us-assets.i.posthog.com/array" } },
    "/ingest/array/**": { proxy: { to: "https://us-assets.i.posthog.com/array/**" } },
    "/ingest": { proxy: { to: "https://us.i.posthog.com" } },
    "/ingest/**": { proxy: { to: "https://us.i.posthog.com/**" } },
    // Assets under /assets/** are content-hashed, so they can be cached
    // immutably for a year — a new build emits new filenames.
    "/assets/**": {
      fallthrough: false,
      headers: {
        ...crossOriginIsolationHeaders,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
    "/manim-web/**": { fallthrough: false, headers: crossOriginScriptHeaders },
    "/**/*.js": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.css": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.svg": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.png": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.ico": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.wasm": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.onnx": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.pdf": {
      fallthrough: false,
      headers: crossOriginIsolationHeaders,
    },
    "/**/*.mp4": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.webp": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**/*.gif": { fallthrough: false, headers: crossOriginIsolationHeaders },
    "/**": { static: true, headers: crossOriginIsolationHeaders },
  },
  publicAssets: [
    {
      dir: "dist",
      maxAge: 60 * 60 * 24 * 365, // 1 year for hashed assets
    },
  ],
  // Bundle the OG renderer's font + resvg wasm so they are readable at runtime
  // via useStorage("assets:server") (see server/utils/og-render.ts).
  serverAssets: [{ baseName: "server", dir: "server/assets" }],
  handlers: [
    {
      route: "/api/chat-proxy/**",
      handler: "server/api/chat-proxy/[...slug].ts",
    },
    {
      route: "/api/agent-runtime/config",
      handler: "server/api/agent-runtime/config.ts",
    },
    {
      route: "/api/agent-runtime/remote/**",
      handler: "server/api/agent-runtime/remote/[...path].ts",
    },
    {
      route: "/api/share",
      handler: "server/api/share/index.ts",
    },
    {
      route: "/api/share/**",
      handler: "server/api/share/[id].ts",
    },
    {
      route: "/api/oauth/token",
      handler: "server/api/oauth/token.ts",
    },
    {
      route: "/api/oauth/refresh",
      handler: "server/api/oauth/refresh.ts",
    },
    {
      route: "/api/dio/checkout",
      handler: "server/api/dio/checkout.ts",
    },
    {
      route: "/api/dio/webhook",
      handler: "server/api/dio/webhook.ts",
    },
    {
      route: "/api/dio/claim",
      handler: "server/api/dio/claim.ts",
    },
    {
      route: "/api/dio/recover",
      handler: "server/api/dio/recover.ts",
    },
    {
      route: "/api/dio/openai/**",
      handler: "server/api/dio/openai/[...path].ts",
    },
    {
      // Per-share OpenGraph image (no .png suffix — a `.png` route would be
      // shadowed by the fallthrough:false static rule above).
      route: "/api/og/**",
      handler: "server/api/og/[...id].ts",
    },
    {
      // Share pages: serve the SPA shell with per-share OG/Twitter meta.
      route: "/s/**",
      handler: "server/routes/s/[...path].ts",
    },
  ],
});
