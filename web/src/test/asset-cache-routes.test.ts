import { describe, expect, test } from "bun:test";
import { addRoute, createRouter, findAllRoutes } from "rou3";
import config from "../../nitro.config";

// Exercise Nitro's actual route matcher: file globs such as /**/*.png are
// catch-alls in the installed router and silently made /chat publicly cacheable.
const router = createRouter<{ headers?: Record<string, string> }>();
for (const [path, rule] of Object.entries(config.routeRules ?? {})) {
  addRoute(router, "GET", path, rule);
}
const headersFor = (path: string) => Object.assign({}, ...findAllRoutes(router, "GET", path).map(({ data }) => data.headers));

describe("production cache boundaries", () => {
  test.each(["/", "/chat", "/pricing", "/notorganic/callback", "/oauth/callback", "/api/oauth/token", "/api/courses"])("keeps %s out of shared caches", (path) => {
    expect(headersFor(path)["Cache-Control"]).toContain("no-store");
  });
  test.each(["/brand/logo.webp", "/brand/logo.avif", "/tutorial/chat.webp", "/tapes/demo.jpg", "/favicon.svg"])("caches replaceable public asset %s for a day", (path) => {
    expect(headersFor(path)["Cache-Control"]).toContain("public, max-age=86400");
    expect(headersFor(path)["Cache-Control"]).not.toContain("immutable");
  });
  test("only content-hashed build assets are immutable", () => {
    expect(headersFor("/assets/app-abcd.js")["Cache-Control"]).toContain("max-age=31536000, immutable");
  });
  test.each(["/sw.js", "/__sw__.js"])("revalidates worker %s", (path) => {
    expect(headersFor(path)["Cache-Control"]).toBe("no-cache, no-transform");
  });
});
