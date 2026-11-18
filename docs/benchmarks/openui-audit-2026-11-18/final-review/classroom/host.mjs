import { mkdtemp, copyFile, readFile, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const here = import.meta.dirname;
export const repo = resolve(here, "../../../../../");
export const study = resolve(here, "../study");
export const cohort = JSON.parse(await readFile(join(study, "cohort.json"), "utf8"));

// A release-only replay gets one authentic public message. Full transport
// integration is reserved for a single predeclared classroom turn.
export async function startHost({ product, sample, bridge, exhibit, useGateDefaults = false }) {
  const fixture = await mkdtemp(join(tmpdir(), "keating-classroom-"));
  const cookie = randomBytes(24).toString("hex");
  const source = await realpath(product);
  const dependencyRoot = await realpath(join(repo, "web/node_modules"));
  const {createServer} = await import(pathToFileURL(join(source,"spikes/flue-host/node_modules/vite/dist/node/index.js")).href);
  const {flueBrowserRuntime} = await import(pathToFileURL(join(source, "web/scripts/flue/vite-plugin.ts")).href);
  const {chromium} = await import(pathToFileURL(join(source,"spikes/flue-host/node_modules/playwright-core/index.mjs")).href);
  await symlink(join(source, "web/node_modules"), join(fixture, "node_modules"));
  await copyFile(join(here, "entry.tsx"), join(fixture, "entry.tsx"));
  await writeFile(join(fixture,"index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keating classroom</title><style>html,body,#app{margin:0;height:100%;min-height:0}body{background:var(--background);color:var(--foreground)}[data-inspector]{max-width:70rem;margin:auto;padding:1rem}</style></head><body><main id="app"></main><script type="module" src="/entry.tsx"></script></body></html>');
  let replaySent = false;
  const traffic = [];
  const config = {live:!!bridge, followup:!!sample.followup, readOnly:!!exhibit, gradeDemo:!!sample.gradeDemo, provider:sample.provider, model:sample.model, useGateDefaults};
  const handlers = {
    name:"isolated-classroom-transport",
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path === "/case.json") {
          res.setHeader("Content-Type","application/json");
          res.end(JSON.stringify(config)); return;
        }
        if (exhibit) {
          if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode=405; res.end(); return; }
          if (path === "/observation.json") {
            res.setHeader("Content-Type","application/json");
            res.end(JSON.stringify(exhibit)); return;
          }
          if (path?.startsWith("/classroom/")) { res.statusCode=404; res.end(); return; }
        }
        if (path?.startsWith("/api/")) { res.statusCode=404; res.end(); return; }
        if (!path?.startsWith("/classroom/")) return next();
        let status = 400;
        try {
          if (req.method !== "POST" || req.headers["x-classroom-lease"] !== cookie
            || req.headers.origin !== "http://"+req.headers.host) throw Error();
          const chunks = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 2_000_000) throw Error();
            chunks.push(chunk);
          }
          const wireBody = Buffer.concat(chunks);
          const body = JSON.parse(wireBody);
          if (path === "/classroom/replay" && (!bridge || sample.followup) && !replaySent) {
            const users = body.context?.messages.filter(m => m.role === "user");
            const content = users?.[0]?.content;
            const text = typeof content === "string" ? content : content?.at(-1)?.text;
            if (users?.length !== 1 || text !== sample.learner || !sample.message) throw Error();
            replaySent = true;
            traffic.push({kind:"recorded-public-message", status:200});
            res.setHeader("Content-Type","application/json");
            res.end(JSON.stringify(sample.message)); return;
          }
          if (!bridge || !["/classroom/tutor", "/classroom/decision"].includes(path)) throw Error();
          const route = path.slice("/classroom".length);
          const url = new URL(route, bridge.url);
          if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw Error();
          // Only a loopback process with the lease can authorize provider traffic.
          status=502;
          const response = await fetch(url, {method:"POST", redirect:"error",
            headers:{"Content-Type":"application/json", Authorization:"Bearer "+bridge.token}, body:wireBody,
            signal:AbortSignal.timeout(185_000)});
          traffic.push({kind:route.slice(1),status:response.status});
          if (!response.ok) throw Error();
          const returned = await response.json();
          res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(returned));
        } catch {
          res.statusCode=status; res.end('{"error":"classroom-transport-unavailable"}');
        }
      });
    },
  };
  const server = await createServer({root:fixture,configFile:false,cacheDir:join(fixture,"vite-cache"),
    publicDir:false, logLevel:"error", resolve:{dedupe:["react","react-dom"],
      alias:{"classroom-src":join(source,"web/src"),"classroom-styles":join(source,"web/styled-system"),"@":join(source,"web/src"),
        ...(useGateDefaults ? {"@keating/learner-contracts":join(source,"packages/learner-contracts/src/index.ts")} : {})}},
    optimizeDeps:{entries:[join(fixture,"entry.tsx")]},
    server:{host:"127.0.0.1",port:0,hmr:false,watch:null,fs:{allow:[fixture,source,repo,dependencyRoot]},
      headers:{"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"credentialless",
        ...(exhibit?{"Content-Security-Policy":"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'"}:{})}},
    plugins:[handlers,flueBrowserRuntime()]});
  await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  if (exhibit) return {origin,close:async()=>{await server.close();await rm(fixture,{recursive:true,force:true})}};
  const browser = await chromium.launch({headless:true,args:["--no-sandbox","--disable-background-networking",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"]});
  const external = new Set();
  const context = await browser.newContext({viewport:{width:1240,height:860}, deviceScaleFactor:1,
    serviceWorkers:"block", colorScheme:"light", reducedMotion:"reduce", acceptDownloads:true});
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["blob:","data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) { external.add(url.origin); return route.abort(); }
    if (url.pathname.startsWith("/classroom/")) return route.continue({headers:{...route.request().headers(),
      "x-classroom-lease":cookie}});
    return route.continue();
  });
  return {origin,context,traffic,external,close:async () => {
    await browser.close(); await server.close(); await rm(fixture,{recursive:true,force:true});
  }};
}
