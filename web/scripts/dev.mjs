import { spawn } from "node:child_process";
import { createServer } from "node:net";

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

async function run(command, args) {
  const child = start(command, args);
  const result = await waitForExit(child);
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.signal ?? result.code}.`,
    );
  }
}

async function waitForServer(url, child, accept = () => true) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error("The Courses API server exited during startup.");
    try {
      const response = await fetch(url);
      if (accept(response)) return response;
    } catch {
      // The Nitro listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The Courses API server did not become ready at ${url}.`);
}

if (!(await canListen(requestedClientPort))) {
  throw new Error(
    `Vite port ${requestedClientPort} is already in use. Stop the existing Keating dev server, then retry.`,
  );
}

const apiPort = await availablePort(requestedApiPort);
await run("bun", ["x", "nitro", "build"]);

const apiOrigin = `http://127.0.0.1:${apiPort}`;
const api = start("node", [".output/server/index.mjs"], {
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
  await waitForServer(`${apiOrigin}/api/courses/session`, api);
  console.log(`Courses API ready at ${apiOrigin}`);
  const forwardedViteArgs = viteArgs.filter((arg, index) => {
    if (arg.startsWith("--port=")) return false;
    if (arg === "--port") return false;
    return index !== portFlagIndex + 1;
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
  await waitForServer(
    `${clientOrigin}/api/courses/session`,
    client,
    (response) => response.status !== 404,
  );
  console.log(`Keating web ready at ${clientOrigin}/courses`);

  const result = await Promise.race([
    waitForExit(client).then((exit) => ({ source: "Vite", ...exit })),
    waitForExit(api).then((exit) => ({ source: "Courses API", ...exit })),
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
