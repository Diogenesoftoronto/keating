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
      handler: "server/api/chat-proxy/[...slug].post.ts",
    },
  ],
});
