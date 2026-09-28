#!/usr/bin/env bun
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BonsaiRuntime, BONSAI_ENDPOINT, BONSAI_RUNTIME_VERSION } from "../src/bonsai-runtime.ts";

const args = process.argv.slice(2);
const command = args.shift() ?? "download";
const options = { directory: join(homedir(), ".cache", "keating", "bonsai-2-27b") };
let prompt;
while (args.length) {
  const flag = args.shift();
  if (flag === "--directory" && args.length) options.directory = resolve(args.shift());
  else if (flag === "--backend" && args.length) {
    const backend = args.shift();
    if (!["cpu", "metal", "cuda"].includes(backend)) throw new Error("Choose cpu, metal, or cuda.");
    options.backend = backend;
  } else if (flag === "--prompt" && args.length) prompt = args.shift();
  else throw new Error(`Unknown or incomplete option: ${flag}`);
}
if (!["download", "status", "serve", "ask"].includes(command)) throw new Error("Use download, status, serve, or ask.");
const runtime = new BonsaiRuntime(options);
const stop = () => runtime.stop();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  if (command === "status") console.log(JSON.stringify(await runtime.status(), null, 2));
  if (command === "download") {
    console.log(`Installing verified Prism ${BONSAI_RUNTIME_VERSION} and Bonsai 2 27B in ${options.directory}`);
    const progress = setInterval(() => { void runtime.status().then(status => console.log(`${(status.downloadedBytes / 1e9).toFixed(2)} / ${(status.totalBytes / 1e9).toFixed(2)} GB`)); }, 10000);
    try { await runtime.download(); console.log("Bonsai is verified and ready for offline text and images."); }
    finally { clearInterval(progress); }
  }
  if (command === "ask") {
    if (!prompt) throw new Error("Supply --prompt with your question.");
    console.log(await runtime.generate({ prompt, maxTokens: 512, temperature: 0.7 }));
  }
  if (command === "serve") {
    await runtime.start();
    console.log(`Bonsai is running at ${BONSAI_ENDPOINT} (private per-process authentication; Keating's native bridge manages requests).`);
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { await runtime.stop(); }
