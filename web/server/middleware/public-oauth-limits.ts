import { createError, defineMiddleware, getRequestURL } from "h3";
import { consumePublicRateLimit } from "../utils/public-abuse";

const postRoutes = new Set([
  "/api/oauth/token",
  "/api/oauth/refresh",
  "/api/oauth/openai-codex/device",
  "/api/oauth/openai-codex/poll",
]);
// These legacy handlers perform provider work on every method. Preserve that
// routing behavior while protecting every request that can reach that work.
const allMethodRoutes = new Set([
  "/api/oauth/github-copilot/device",
  "/api/oauth/github-copilot/poll",
]);

export default defineMiddleware(async event => {
  const path = getRequestURL(event).pathname.replace(/\/$/, "");
  if (!allMethodRoutes.has(path) && !(event.method === "POST" && postRoutes.has(path))) return;
  const length = event.req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 32 * 1024)) {
    throw createError({ statusCode: 413, statusMessage: "OAuth request body is too large." });
  }
  // Aggregate across exchange, refresh, and device polling rather than allowing
  // callers to multiply the budget by switching endpoints.
  await consumePublicRateLimit(event, { bucket: "oauth-global", key: "global", limit: 1200, windowSeconds: 60 });
  await consumePublicRateLimit(event, { bucket: "oauth-client", limit: 120, windowSeconds: 60 });
});
