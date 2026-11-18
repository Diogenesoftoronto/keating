/** Check that an ordinary browser-origin request can reach the BYOK key check. */
export async function probeDecisionRelay(base: string, send: (url: URL, init: RequestInit) => Promise<Response> = fetch) {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Supply an HTTP or HTTPS classroom URL without credentials.");
  }
  const response = await send(new URL("/api/judgement/typesafe", url.origin), {
    method: "POST",
    headers: { "content-type": "application/json", origin: url.origin },
    body: "{}",
    credentials: "omit",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  return { origin: url.origin, status: response.status, reachedKeyCheck: response.status === 401 };
}

if (import.meta.main) {
  const base = process.argv[2];
  if (!base) throw new Error("Usage: bun scripts/openui-diagnostics/probe-decision-relay.ts <classroom-url>");
  const result = await probeDecisionRelay(base);
  console.log(JSON.stringify(result));
  if (!result.reachedKeyCheck) process.exitCode = 1;
}
