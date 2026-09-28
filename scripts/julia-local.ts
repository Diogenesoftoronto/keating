#!/usr/bin/env bun
/** Explicit installation/read-only decision preview; production review remains calibration-gated. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JuliaNativeRuntime } from "../shared/julia/native.js";
import { JULIA_MODEL_ID } from "../shared/julia/manifest.js";
import type { JuliaDecisionRequest } from "../shared/julia/encoder.js";

const [command, directory, requestFile, extra] = process.argv.slice(2);
if (!directory || extra || !["install", "status", "probe"].includes(command ?? "") || command === "probe" && !requestFile) throw new Error("Usage: bun scripts/julia-local.ts install|status DIRECTORY, or probe DIRECTORY request.json");
const runtime = new JuliaNativeRuntime({ directory: resolve(directory), maxLength: 2048, headLength: 512 });
try {
  if (command === "install") await runtime.download();
  if (command === "probe") {
    const raw = await readFile(resolve(requestFile!), "utf8");
    if (raw.length > 100_000) throw new Error("Julia probe input exceeds size limit.");
    const row = JSON.parse(raw) as JuliaDecisionRequest;
    const encoded = await runtime.encode([row]);
    const probabilities = (await runtime.weights([row]))[0];
    console.log(JSON.stringify({ modelId: JULIA_MODEL_ID, calibration: "unvalidated-preview", inputTokens: encoded[0]!.ids.length, probabilities }));
  } else console.log(JSON.stringify(await runtime.status()));
} finally { await runtime.stop(); }
