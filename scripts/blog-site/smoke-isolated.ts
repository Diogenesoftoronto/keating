import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Execute the actual upload outside the checkout, with neither node_modules nor
// inherited account configuration. This proves packaging and truthful startup;
// the source's HTTP behavior with records is covered by site.test.ts.
const isolated = await mkdtemp(join(tmpdir(), "keating-blog-isolated-"));
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  await cp(join(import.meta.dir, "dist"), isolated, { recursive: true });
  child = Bun.spawn([process.execPath, "server.js"], {
    cwd: isolated, env: { PORT: "0", NODE_ENV: "production" }, stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => child?.kill(), 15_000);
  const stdout = child.stdout as ReadableStream<Uint8Array>;
  const reader = stdout.getReader();
  let message = "";
  let port: string | undefined;
  while (!port) {
    const next = await reader.read();
    if (next.done) throw new Error("Standalone process exited before startup");
    message += new TextDecoder().decode(next.value);
    port = /listening on port (\d+)/.exec(message)?.[1];
  }
  try {
    for (const [path, status, type] of [
      ["/healthz", 200, "application/json"],
      ["/assets/site.css", 200, "text/css"],
      ["/assets/site.js", 200, "javascript"],
      ["/assets/jetbrains-mono-regular.ttf", 200, "font"],
      ["/assets/vt323-regular.ttf", 200, "font"],
      ["/assets/logo-lockup-compact.avif", 200, "image"],
      ["/assets/mascot-head-v2.png", 200, "image"],
      ["/assets/katex/katex.min.css", 200, "text/css"],
      ["/", 503, "text/html"],
      ["/api/blog", 503, "application/json"],
      ["/.well-known/site.standard.publication", 503, "text/plain"],
      ["/missing", 404, "text/html"],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.status !== status || !response.headers.get("content-type")?.includes(type)) {
        throw new Error(`${path}: got ${response.status} ${response.headers.get("content-type")}`);
      }
      await response.arrayBuffer();
    }
    console.log("Isolated bundle smoke passed: 12 HTTP checks, no repository or runtime dependencies.");
  } finally { clearTimeout(timeout); }
} finally {
  child?.kill();
  if (child) await child.exited;
  await rm(isolated, { recursive: true, force: true });
}
