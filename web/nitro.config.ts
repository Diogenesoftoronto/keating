import { defineNitroConfig } from "nitro/config";
import { readdirSync } from "node:fs";

const crossOriginIsolationHeaders: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

const staticAssetHeaders: Record<string, string> = {
  ...crossOriginIsolationHeaders,
  // Preserve origin encoding while investigating Firefox transmission errors.
  // This does not disable browser or Railway CDN caching.
  "Cache-Control": "public, max-age=86400, no-transform",
};

const staticAssetRule = (headers = staticAssetHeaders) => ({ headers });
const publicAssetDirectories = ["brand", "tutorial", "avatars", "posters", "downloads", "tapes", "textures", "landing", "audio", "vendor", "reports"];
const publicAssetFiles = readdirSync(new URL("./public/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.endsWith(".js"))
  .map((entry) => entry.name);

export default defineNitroConfig({
  features: {
    websocket: true,
  },
  // Courses are account state, not ephemeral share payloads. Deployments should
  // point this at a persistent volume (for example /data/keating-courses).
  storage: {
    "keating:submission-attachments": {
      driver: "fs",
      base: process.env.KEATING_SUBMISSION_STORAGE_DIR ?? ".data/keating-submissions",
    },
    "keating:courses": {
      driver: "fs",
      base: process.env.KEATING_COURSES_STORAGE_DIR ?? ".data/keating-courses",
    },
    // Portable trajectory shares must survive process restarts just like course
    // state. Production deployments should point this at their mounted volume.
    "keating:share": {
      driver: "fs",
      base: process.env.KEATING_SHARE_STORAGE_DIR ?? ".data/keating-shares",
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
    // Worker scripts must revalidate across deployments, including the NodePod
    // script imported by the single production PWA worker.
    "/sw.js": staticAssetRule({ ...crossOriginIsolationHeaders, "Cache-Control": "no-cache, no-transform" }),
    "/__sw__.js": staticAssetRule({ ...crossOriginIsolationHeaders, "Cache-Control": "no-cache, no-transform" }),
    // APIs must never resolve to the SPA shell, including unknown/stale routes.
    "/api/**": { static: false, headers: { "Cache-Control": "no-store" } },
    // PostHog reverse proxy. The browser SDK is configured with
    // `api_host: '/ingest'` so analytics traffic is same-origin (avoids ad
    // blockers / third-party cookie issues). In dev this is handled by
    // web/vite.config.ts `server.proxy`; in production Nitro must proxy it.
    // These rules are separate from the asset directory rules below, so
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
      ...staticAssetRule({
        ...crossOriginIsolationHeaders,
        "Cache-Control": "public, max-age=31536000, immutable, no-transform",
      }),
    },
    // rou3 treats ** as a terminal catch-all: /**/*.png also matches /chat.
    // Use asset directories and exact root filenames instead.
    ...Object.fromEntries(
      publicAssetDirectories.map((directory) => [`/${directory}/**`, staticAssetRule()]),
    ),
    ...Object.fromEntries(
      publicAssetFiles.map((name) => [`/${name}`, staticAssetRule()]),
    ),
    "/**": {
      static: true,
      headers: {
        ...crossOriginIsolationHeaders,
        "Cache-Control": "no-store, no-transform",
      },
    },
  },
  publicAssets: [
    {
      dir: "dist",
      maxAge: 0, // Cache policy comes from explicit routes, never the whole SPA.
    },
  ],
  // Bundle the OG renderer's font + resvg wasm so they are readable at runtime
  // via useStorage("assets:keating-og") (see server/utils/og-render.ts).
  // Nitro reserves "server" for its automatically mounted assets directory.
  serverAssets: [{ baseName: "keating-og", dir: "server/assets" }],
  handlers: [
    // Nitro serves existing static files before these handlers. A missing image
    // or worker must be a real 404, never a cacheable copy of the SPA HTML.
    ...[
      ...publicAssetDirectories.map((directory) => `/${directory}/**`),
      ...publicAssetFiles.map((name) => `/${name}`),
      "/sw.js", "/__sw__.js",
    ].map((route) => ({ route, handler: "server/routes/assets/[...path].ts" })),
    { route: "/api/**", handler: "server/api-not-found.ts" },
    { route: "/api/credit-waitlist", method: "POST", handler: "server/api/credit-waitlist/index.post.ts" },
    {
      route: "/api/training-datasets",
      method: "POST",
      handler: "server/api/training-datasets/index.post.ts",
    },
    {
      route: "/api/tavus/conversations",
      method: "POST",
      handler: "server/api/tavus/conversations/index.post.ts",
    },
    {
      route: "/api/tavus/conversations/:conversationId/end",
      method: "POST",
      handler: "server/api/tavus/conversations/[conversationId]/end.post.ts",
    },
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
      route: "/api/observability/v1/arize/config",
      handler: "server/api/observability/v1/arize/config.ts",
    },
    {
      route: "/api/observability/v1/arize/traces",
      handler: "server/api/observability/v1/arize/traces.ts",
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
      route: "/api/oauth/openai-codex/device",
      handler: "server/api/oauth/openai-codex-device.ts",
    },
    {
      route: "/api/oauth/openai-codex/poll",
      handler: "server/api/oauth/openai-codex-poll.ts",
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
