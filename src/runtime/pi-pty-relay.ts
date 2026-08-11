#!/usr/bin/env node
import { spawn as spawnPty } from "node-pty";
import { createConnection } from "node:net";

const [socketPath, entryPath, ...entryArgs] = process.argv.slice(2);
if (!socketPath || !entryPath) throw new Error("The Pi PTY relay requires socket and RPC entry paths.");

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const socket = createConnection(socketPath);
await new Promise<void>((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("error", reject);
});
const pty = spawnPty(process.env.KEATING_NODE_BINARY ?? "node", [entryPath, ...entryArgs], {
  name: "xterm-256color",
  cols: 160,
  rows: 50,
  cwd: process.cwd(),
  env,
});
const dataSubscription = pty.onData((data) => socket.write(data));
const onInput = (chunk: Buffer | string) => pty.write(chunk.toString());
const terminate = () => {
  try { pty.kill(); } catch { /* already exited */ }
};
socket.on("data", onInput);
socket.once("close", terminate);
process.once("SIGTERM", terminate);
process.once("SIGHUP", terminate);

const { exitCode } = await new Promise<{ exitCode: number }>((resolve) => {
  pty.onExit(resolve);
});
dataSubscription.dispose();
socket.off("data", onInput);
socket.off("close", terminate);
socket.destroy();
process.off("SIGTERM", terminate);
process.off("SIGHUP", terminate);
process.exitCode = exitCode;
