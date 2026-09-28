import { spawn } from "node:child_process";
import { resolve } from "node:path";

const port = (value, fallback, name) => {
  const configured = value ?? fallback;
  if (!/^\d+$/.test(String(configured))) {
    throw new Error(`${name} must be an integer port`);
  }
  const parsed = Number(configured);
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return parsed;
};

const sitePort = port(process.env.PORT, 3000, "PORT");
const chatPort = port(process.env.KEATING_CHAT_PORT, 8081, "KEATING_CHAT_PORT");
if (sitePort === chatPort) {
  throw new Error("PORT and KEATING_CHAT_PORT must be different");
}

const children = new Set();
let stopping = false;
let exitCode = 1;
let shutdownTimer;

const finish = () => {
  if (!stopping || children.size !== 0) return;
  clearTimeout(shutdownTimer);
  process.exit(exitCode);
};

const shutdown = (code) => {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  shutdownTimer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 10_000);
  shutdownTimer.unref();
  finish();
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal === "SIGINT" ? 130 : 143));
}

for (const [target, listenPort] of [["site", sitePort], ["app", chatPort]]) {
  const child = spawn(process.execPath, [resolve(`.output-${target}/server/index.mjs`)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(listenPort),
      NITRO_PORT: String(listenPort),
      HOST: process.env.HOST ?? "0.0.0.0",
      NITRO_HOST: process.env.HOST ?? "0.0.0.0",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`Keating ${target} server failed to start:`, error);
    shutdown(1);
  });
  child.on("close", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`Keating ${target} server exited (${signal ?? code}); stopping both servers.`);
      shutdown(code && code > 0 ? code : 1);
    }
    finish();
  });
}
