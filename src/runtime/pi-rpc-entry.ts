#!/usr/bin/env node
import { main } from "@earendil-works/pi-coding-agent";
import { writeSync } from "node:fs";

async function runPiRpc(): Promise<void> {
  // The upstream 0.80.2 CLI invokes async main() without awaiting it. Keating
  // awaits it and announces readiness only after runRpcMode binds JSONL input.
  process.env.PI_CODING_AGENT = "true";
  process.stdin.setRawMode?.(true);
  const keepAlive = setInterval(() => undefined, 60_000);
  const readyProbe = setInterval(() => {
    if (process.stdin.listenerCount("data") === 0) return;
    clearInterval(readyProbe);
    writeSync(1, `${JSON.stringify({ type: "keating_rpc_ready" })}\n`);
  }, 10);
  try {
    await main(process.argv.slice(2));
  } finally {
    process.stdin.setRawMode?.(false);
    clearInterval(readyProbe);
    clearInterval(keepAlive);
  }
}

await runPiRpc();
