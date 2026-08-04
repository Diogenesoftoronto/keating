import { defineNitroConfig } from "nitro/config";

const crossOriginIsolationHeaders: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

const noFallthroughStaticAsset = (headers = crossOriginIsolationHeaders) =>
  ({ fallthrough: false, headers }) as unknown as { static: false; headers: Record<string, string> };

export default defineNitroConfig({
  features: {
    websocket: true,
  },
  // Courses are account state, not ephemeral share payloads. Deployments should
  // point this at a persistent volume (for example /data/keating-courses).
  storage: {
    "keating:courses": {
      driver: "fs",
      base: process.env.KEATING_COURSES_STORAGE_DIR ?? ".data/keating-courses",
    },
  },
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
      ...noFallthroughStaticAsset({
        ...crossOriginIsolationHeaders,
        "Cache-Control": "public, max-age=31536000, immutable",
      }),
    },
    "/**/*.js": noFallthroughStaticAsset(),
    "/**/*.css": noFallthroughStaticAsset(),
    "/**/*.svg": noFallthroughStaticAsset(),
    "/**/*.png": noFallthroughStaticAsset(),
    "/**/*.ico": noFallthroughStaticAsset(),
    "/**/*.wasm": noFallthroughStaticAsset(),
    "/**/*.onnx": noFallthroughStaticAsset(),
    "/**/*.pdf": noFallthroughStaticAsset(),
    "/**/*.mp4": noFallthroughStaticAsset(),
    "/**/*.webp": noFallthroughStaticAsset(),
    "/**/*.gif": noFallthroughStaticAsset(),
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
	  route: "/api/blog",
	  handler: "server/api/blog/index.ts",
	},
	{
	  route: "/.well-known/site.standard.publication",
	  handler: "server/routes/well-known/site-standard-publication.ts",
	},
	{
	  route: "/blog",
	  handler: "server/routes/blog/[...path].ts",
	},
	{
	  route: "/blog/**",
	  handler: "server/routes/blog/[...path].ts",
	},
	{
	  route: "/api/courses/realtime",
	  handler: "server/api/courses/realtime.ts",
	},
	{
	  route: "/api/agent-runtime/host/execute",
	  handler: "server/api/agent-runtime/host/execute.ts",
	},
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
      // Host project file access for the browser agent's list_project_files /
      // read_project_file tools. Must be registered explicitly: routes in this
      // config are hand-declared, and without this entry requests fall through
      // to the `/**` static SPA rule and return index.html instead of JSON.
      route: "/api/project-files/**",
      handler: "server/api/project-files/[...path].ts",
    },
    {
      // Opt-in trusted-localhost command execution, enabled only when
      // `keating web --allow-local-exec` sets KEATING_WEB_LOCAL_EXEC=1.
      route: "/api/local-exec/exec",
      handler: "server/api/local-exec/exec.ts",
    },
    {
      // Opt-in project-root-scoped file writes for local tinkering.
      route: "/api/local-exec/write",
      handler: "server/api/local-exec/write.ts",
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
      route: "/api/courses",
      handler: "server/api/courses/[...path].ts",
    },
    {
      route: "/api/courses/**",
      handler: "server/api/courses/[...path].ts",
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
      route: "/api/oauth/github-copilot/device",
      handler: "server/api/oauth/github-copilot-device.ts",
    },
    {
      route: "/api/oauth/github-copilot/poll",
      handler: "server/api/oauth/github-copilot-poll.ts",
    },
    {
      route: "/api/notorganic/openai/**",
      handler: "server/api/notorganic/openai/[...path].ts",
    },
    {
      route: "/api/notorganic/provider/**",
      handler: "server/api/notorganic/provider/[resource].ts",
    },
    {
      // Static middleware serves valid built files first. If an old service
      // worker or cached shell asks for a stale content-hash, this handler
      // catches the miss and returns a real 404 instead of the SPA shell.
      route: "/assets/**",
      handler: "server/routes/assets/[...path].ts",
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
