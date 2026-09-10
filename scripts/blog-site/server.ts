import { resolve, sep } from "node:path";
import { AtprotoBlogError, loadAtprotoBlogFeed, readAtprotoBlogConfig } from "../../web/server/utils/atproto-blog";
import type { AtprotoBlogFeed } from "../../web/src/keating/standard-site";
import { documentUrl, indexUrl, renderError, renderIndex, renderPost } from "./render";

interface BlogHandlerOptions {
  loadFeed?: () => Promise<AtprotoBlogFeed>;
  assetsDirectory?: string;
}

export function createBlogHandler(options: BlogHandlerOptions = {}): (request: Request) => Promise<Response> {
  const loadFeed = options.loadFeed ?? (async () => {
    const config = readAtprotoBlogConfig();
    const loaded = await loadAtprotoBlogFeed(config);
    if (config.publicationUri && loaded.publication.uri !== config.publicationUri) {
      throw new AtprotoBlogError("The configured publication was not found", "not_found");
    }
    return loaded;
  });
  const assetsDirectory = resolve(options.assetsDirectory ?? `${import.meta.dir}/assets`);
  let pendingFeed: Promise<AtprotoBlogFeed> | undefined;
  const feed = () => pendingFeed ??= loadFeed().finally(() => { pendingFeed = undefined; });

  return async request => {
    const url = new URL(request.url);
    const headers = new Headers({ "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });
    const respond = (body: BodyInit | null, status = 200, type = "text/html; charset=utf-8") => {
      headers.set("content-type", type);
      headers.set("cache-control", status >= 400 ? "no-store" : "public, max-age=60");
      return new Response(request.method === "HEAD" ? null : body, { status, headers });
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("allow", "GET, HEAD");
      return respond("Method not allowed", 405, "text/plain; charset=utf-8");
    }
    if (url.pathname === "/healthz") return respond('{"status":"ok"}', 200, "application/json");
    if (url.pathname.startsWith("/assets/")) {
      let relative: string;
      try { relative = decodeURIComponent(url.pathname.slice("/assets/".length)); }
      catch { return respond("Not found", 404, "text/plain"); }
      const path = resolve(assetsDirectory, relative);
      if (!path.startsWith(`${assetsDirectory}${sep}`) || relative.includes("\0")) return respond("Not found", 404, "text/plain");
      const file = Bun.file(path);
      if (!await file.exists()) return respond("Not found", 404, "text/plain");
      return respond(file, 200, file.type);
    }
    if (url.pathname === "/blog" || url.pathname === "/blog/") {
      headers.set("location", `/${url.search}`);
      return respond(null, 308);
    }
    const match = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/?)$/.exec(url.pathname);
    if (match?.[2]) {
      headers.set("location", `/blog/${match[1]}${url.search}`);
      return respond(null, 308);
    }
    if (!["/", "/api/blog", "/.well-known/site.standard.publication", "/sitemap.xml", "/robots.txt"].includes(url.pathname) && !match) {
      return respond(renderError(404), 404);
    }
    try {
      const current = await feed();
      if (url.pathname === "/api/blog") return respond(JSON.stringify(current), 200, "application/json; charset=utf-8");
      if (url.pathname === "/.well-known/site.standard.publication") return respond(current.publication.uri, 200, "text/plain; charset=utf-8");
      if (url.pathname === "/robots.txt") return respond("User-agent: *\nAllow: /\nSitemap: https://blog.keating.help/sitemap.xml\n", 200, "text/plain; charset=utf-8");
      if (url.pathname === "/sitemap.xml") {
        const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
        // Only advertise canonical URLs on this host. Before the publication
        // record moves, the authoritative URLs still belong to the old site.
        const entries = [indexUrl(current), ...current.posts.map(post => documentUrl(current, post))]
          .filter(value => new URL(value).origin === "https://blog.keating.help");
        return respond(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(value => `<url><loc>${escape(value)}</loc></url>`).join("")}</urlset>`, 200, "application/xml; charset=utf-8");
      }
      if (match) {
        const post = current.posts.find(post => post.slug === match[1]);
        return post ? respond(renderPost(current, post)) : respond(renderError(404), 404);
      }
      return respond(renderIndex(current, url.searchParams.get("q") ?? "", url.searchParams.get("tag") ?? ""));
    } catch (error) {
      const status = error instanceof AtprotoBlogError && error.code === "not_found" ? 404 : 503;
      headers.set("retry-after", "60");
      if (url.pathname === "/api/blog") return respond(JSON.stringify({ statusMessage: "The AT Protocol blog is unavailable." }), status, "application/json; charset=utf-8");
      if (["/.well-known/site.standard.publication", "/sitemap.xml", "/robots.txt"].includes(url.pathname)) return respond("The Standard.site publication is unavailable", status, "text/plain; charset=utf-8");
      return respond(renderError(status), status);
    }
  };
}

if (import.meta.main) {
  const server = Bun.serve({ hostname: "0.0.0.0", port: Number(process.env.PORT || 4192), fetch: createBlogHandler(), idleTimeout: 60 });
  console.log(`Keating blog listening on port ${server.port}`);
}
