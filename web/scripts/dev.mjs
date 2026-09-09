import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { emptyApiProbe, isApiValidationResponse } from "./dev-readiness.mjs";

const requestedApiPort = Number(process.env.KEATING_WEB_DEV_API_PORT ?? 4318);
if (
  !Number.isInteger(requestedApiPort) ||
  requestedApiPort < 1 ||
  requestedApiPort > 65535
) {
  throw new Error(
    "KEATING_WEB_DEV_API_PORT must be an integer from 1 to 65535.",
  );
}

const viteArgs = process.argv.slice(2);
const inlinePort = viteArgs
  .find((arg) => arg.startsWith("--port="))
  ?.slice("--port=".length);
const portFlagIndex = viteArgs.indexOf("--port");
const requestedClientPort = Number(
  inlinePort ??
    (portFlagIndex >= 0 ? viteArgs[portFlagIndex + 1] : undefined) ??
    process.env.KEATING_WEB_DEV_PORT ??
    3000,
);
if (
  !Number.isInteger(requestedClientPort) ||
  requestedClientPort < 1 ||
  requestedClientPort > 65535
) {
  throw new Error("The Vite dev port must be an integer from 1 to 65535.");
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function availablePort(preferred) {
  if (process.env.KEATING_WEB_DEV_API_PORT) {
    if (await canListen(preferred)) return preferred;
    throw new Error(`KEATING_WEB_DEV_API_PORT ${preferred} is already in use.`);
  }
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(
    `Could not find a free Courses API port from ${preferred} to ${preferred + 19}.`,
  );
}

function start(command, args, env = process.env) {
  return spawn(command, args, {
    env,
    stdio: "inherit",
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForServer(url, child, accept, requestInit) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error("A Keating dev server exited during startup.");
    try {
      const response = await fetch(url, requestInit);
      if (await accept(response)) return response;
    } catch {
      // The Nitro listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The Keating dev server did not become ready at ${url}.`);
}

if (!(await canListen(requestedClientPort))) {
  throw new Error(
    `Vite port ${requestedClientPort} is already in use. Stop the existing Keating dev server, then retry.`,
  );
}

const apiPort = await availablePort(requestedApiPort);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
// Let Nitro watch handlers and its config alongside Vite. A one-shot build
// left the API stale when HMR introduced new OAuth routes in the renderer.
const api = start("bun", ["x", "nitro", "dev", "--host", "127.0.0.1", "--port", String(apiPort)], {
  ...process.env,
  PORT: String(apiPort),
  NITRO_PORT: String(apiPort),
});

let client;
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  client?.kill("SIGTERM");
  api.kill("SIGTERM");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await waitForServer(`${apiOrigin}/api/oauth/token`, api, isApiValidationResponse, emptyApiProbe);
  console.log(`Nitro API ready at ${apiOrigin}`);
  const forwardedViteArgs = viteArgs.filter((arg, index) => {
    if (arg.startsWith("--port=")) return false;
    if (arg === "--port") return false;
    return portFlagIndex < 0 || index !== portFlagIndex + 1;
  });
  client = start(
    "bun",
    [
      "x",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(requestedClientPort),
      "--strictPort",
      ...forwardedViteArgs,
    ],
    {
      ...process.env,
      KEATING_WEB_DEV_API_ORIGIN: apiOrigin,
    },
  );
  const clientOrigin = `http://127.0.0.1:${requestedClientPort}`;
  // Readiness must include OAuth, not just the Courses subset. An empty token
  // request must reach Nitro's validation without contacting any provider.
  await waitForServer(
    `${clientOrigin}/api/oauth/token`,
    client,
    isApiValidationResponse,
    emptyApiProbe,
  );
  // Check the newly added device routes too: stale Nitro output can expose
  // token exchange while the device endpoint still resolves to the SPA shell.
  await waitForServer(
    `${clientOrigin}/api/oauth/openai-codex/device`,
    client,
    (response) => isApiValidationResponse(response, 405),
    { headers: { accept: "application/json" } },
  );
  await waitForServer(
    `${clientOrigin}/api/oauth/openai-codex/poll`,
    client,
    isApiValidationResponse,
    emptyApiProbe,
  );
  // Missing target validation exercises the chat route without provider traffic.
  await waitForServer(
    `${clientOrigin}/api/chat-proxy/chat/completions`,
    client,
    isApiValidationResponse,
    emptyApiProbe,
  );
  console.log(`Keating web ready at ${clientOrigin}/chat`);

  const result = await Promise.race([
    waitForExit(client).then((exit) => ({ source: "Vite", ...exit })),
    waitForExit(api).then((exit) => ({ source: "Nitro API", ...exit })),
  ]);
  const failed = !stopping && result.code !== 0;
  stop();
  if (failed) {
    throw new Error(
      `${result.source} exited with ${result.signal ?? result.code}.`,
    );
  }
} finally {
  stop();
}
