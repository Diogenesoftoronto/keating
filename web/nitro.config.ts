import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  // Ensure that /assets/* requests return 404 if not found, 
  // rather than falling back to index.html (SPA fallback).
  routeRules: {
    "/assets/**": { fallthrough: false },
    "/**/*.js": { fallthrough: false },
    "/**/*.css": { fallthrough: false },
    "/**/*.svg": { fallthrough: false },
    "/**/*.png": { fallthrough: false },
    "/**/*.ico": { fallthrough: false },
    "/**/*.wasm": { fallthrough: false },
    "/**/*.onnx": { fallthrough: false },
    "/**/*.pdf": {
      fallthrough: false,
    },
    "/**/*.mp4": { fallthrough: false },
    "/**/*.webp": { fallthrough: false },
    "/**/*.gif": { fallthrough: false },
    "/**": { static: true },
  },
  publicAssets: [
    {
      dir: "dist",
      maxAge: 60 * 60 * 24 * 365, // 1 year for hashed assets
    },
  ],
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
  ],
});
