#!/usr/bin/env bun
/** One real Keating SDK request; defaults to payload-only, zero-network preflight. */
import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INPUTS = path.join(ROOT, ".keating/outputs/training");
const ALIAS = "keating-pilot";
const PREFLIGHT_STOP = "keating-pilot-payload-preflight-complete";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function privateToken(filename) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    assert(info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid(), "Invalid token file permissions");
    assert(info.size <= 513, "Invalid token file size");
    const token = (await handle.readFile("utf8")).trim();
    assert(/^[A-Za-z0-9._~-]{32,512}$/.test(token), "Invalid pilot token format");
    return token;
  } finally {
    await handle.close();
  }
}

async function writePrivate(filename, value) {
  const handle = await open(filename, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
  } finally {
    await handle.close();
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    "run-dir": { type: "string" }, "owner-did": { type: "string" },
    "system-prompt": { type: "string", default: path.join(INPUTS, "system-prompt.txt") },
    "tool-schemas": { type: "string", default: path.join(INPUTS, "tool-schemas.json") },
    "token-file": { type: "string", default: path.join(INPUTS, "pilot-token") },
    "message-file": { type: "string" }, "execute": { type: "boolean", default: false },
    "port": { type: "string", default: "8789" },
    "temperature": { type: "string", default: "0.1" },
    "origin": { type: "string", default: "http://localhost:3000" },
  }, strict: true, allowPositionals: false });
  assert(/^[0-9]+$/.test(values.port) && Number(values.port) >= 1024 && Number(values.port) <= 65535,
    "--port must be an integer from 1024 to 65535");
  const temperature = Number(values.temperature);
  assert(Number.isFinite(temperature) && temperature >= 0 && temperature <= 2, "Invalid temperature");
  const endpoint = `http://127.0.0.1:${Number(values.port)}/v1`;
  const origin = new URL(values.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.origin === values.origin, "--origin must be an exact local HTTP origin");
  assert(values["run-dir"] && values["owner-did"], "--run-dir and --owner-did are required");
  const runDir = path.resolve(values["run-dir"]);
  const systemPrompt = await readFile(values["system-prompt"], "utf8");
  const originalTools = JSON.parse(await readFile(values["tool-schemas"], "utf8"));
  assert(systemPrompt.length > 0, "System prompt is empty");
  assert(Array.isArray(originalTools) && originalTools.length > 0, "Tool schemas are empty");
  for (const tool of originalTools) {
    assert(tool.type === "function" && typeof tool.function?.name === "string" && tool.function.parameters?.type === "object", "Unsupported exported tool schema");
  }
  const userMessage = values["message-file"]
    ? await readFile(values["message-file"], "utf8")
    : "Help me understand why one half plus one third is not two fifths. Start with one short question.";
  assert(userMessage.trim().length > 0, "User message is empty");
  // Resolve exactly the dependency imported by web/src/hooks/keating-stream.ts.
  const packagePath = path.join(ROOT, "web/node_modules/@earendil-works/pi-ai/package.json");
  const sdk = JSON.parse(await readFile(packagePath, "utf8"));
  const { streamSimple } = await import(pathToFileURL(path.resolve(path.dirname(packagePath), sdk.exports["./compat"].import)).href);
  const context = {
    systemPrompt,
    messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
    tools: originalTools.map(({ function: fn }) => ({ name: fn.name, description: fn.description, parameters: fn.parameters })),
  };
  const model = {
    id: ALIAS, name: "Keating pilot (Inkling-Small)", provider: "keating-pilot-local",
    api: "openai-completions", baseUrl: endpoint,
    reasoning: false, input: ["text"], contextWindow: 65536, maxTokens: 2048,
    // The server ledger owns spend accounting; SDK price estimates are not used.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: true, supportsDeveloperRole: false, supportsReasoningEffort: false,
              supportsStrictMode: false, supportsUsageInStreaming: true, maxTokensField: "max_tokens" },
  };
  let requestEvidence;
  let dispatched = 0;
  let checkpoint;
  let modelAlias = ALIAS;
  let token = "payload-preflight-not-a-real-bearer-token";
  if (values.execute) {
    checkpoint = JSON.parse(await readFile(path.join(runDir, "result.json"), "utf8"));
    assert(checkpoint.owner_did === values["owner-did"], "Checkpoint owner mismatch");
    assert(checkpoint.model === "thinkingmachines/Inkling-Small" && checkpoint.renderer === "tml_v0" && checkpoint.effort === 0.1,
      "Checkpoint model or renderer mismatch");
    assert(/^tinker:\/\/[^/\s]+\/sampler_weights\/[^/\s]+$/.test(checkpoint.sampler_path), "Invalid immutable checkpoint");
    modelAlias = checkpoint.public_model_id ?? ALIAS;
    assert(typeof modelAlias === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(modelAlias), "Invalid public model alias");
    model.id = modelAlias;
    model.name = modelAlias === "keating-bot-latest" ? "Keating Bot (latest)" : modelAlias;
    token = await privateToken(values["token-file"]);
    const headers = { Authorization: `Bearer ${token}`, Origin: origin.origin };
    const listing = await fetch(`${endpoint}/models`, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
    assert(listing.ok, "Pilot model discovery failed");
    const listed = await listing.json();
    assert(listed.data?.length === 1 && listed.data[0].id === modelAlias, "Unexpected pilot models");
    assert(listed.data[0].max_tokens === 2048 && listed.data[0].reasoning === false, "Pilot discovery limits mismatch");
  }
  const stream = streamSimple(model, context, {
    apiKey: token, maxTokens: 1024, temperature, maxRetries: 0,
    cacheRetention: "none", headers: { Origin: origin.origin }, signal: AbortSignal.timeout(180_000),
    onPayload(payload) {
      assert(payload.model === modelAlias && payload.stream === true, "SDK request model mismatch");
      assert(payload.messages?.[0]?.role === "system" && payload.messages[0].content === systemPrompt,
        "SDK changed the original system prompt");
      assert(JSON.stringify(payload.tools) === JSON.stringify(originalTools), "SDK changed the exported tool schemas");
      assert(payload.store === false, "SDK storage must be disabled");
      const raw = JSON.stringify(payload);
      assert(Buffer.byteLength(raw) <= 512 * 1024, "SDK request exceeds pilot body bound");
      requestEvidence = { body_sha256: sha(raw), body_bytes: Buffer.byteLength(raw),
        system_prompt_sha256: sha(systemPrompt), system_prompt_bytes: Buffer.byteLength(systemPrompt),
        tool_schemas_sha256: sha(JSON.stringify(originalTools)), tool_count: originalTools.length,
        max_completion_tokens: payload.max_tokens, temperature: payload.temperature, original_system_prompt_preserved: true,
        original_tool_schemas_preserved: true };
      if (!values.execute) throw new Error(PREFLIGHT_STOP);
    },
    async fetch(input, init) {
      assert(values.execute, "Preflight must never dispatch HTTP");
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert(url === `${endpoint}/chat/completions`, "SDK attempted a non-pilot destination");
      assert(init?.method?.toUpperCase() === "POST" && dispatched === 0, "Only one generation request is permitted");
      const sentAuth = Buffer.from(new Headers(init.headers).get("Authorization") || "");
      const expectedAuth = Buffer.from(`Bearer ${token}`);
      assert(sentAuth.length === expectedAuth.length && timingSafeEqual(sentAuth, expectedAuth), "SDK bearer mismatch");
      dispatched += 1;
      return fetch(input, { ...init, redirect: "error" });
    },
  });
  const events = {};
  for await (const event of stream) events[event.type] = (events[event.type] || 0) + 1;
  const response = await stream.result();
  if (!values.execute) {
    assert(requestEvidence && dispatched === 0 && response.errorMessage?.includes(PREFLIGHT_STOP), "Payload preflight did not complete safely");
    console.log(JSON.stringify({ mode: "payload-preflight", sdk: `${sdk.name}@${sdk.version}`, ...requestEvidence,
      provider_requests: 0, inference_verified: false }));
    return;
  }
  assert(dispatched === 1 && response.stopReason !== "error" && response.stopReason !== "aborted", "Pilot SDK generation failed");
  const toolCalls = response.content.filter((part) => part.type === "toolCall");
  const names = new Set(originalTools.map(({ function: fn }) => fn.name));
  assert(toolCalls.every((call) => names.has(call.name)), "SDK response contains an unknown tool");
  const evidence = { schema_version: 1, scope: "Keating SDK transport pilot; no browser UI or quality claim",
    owner_did: checkpoint.owner_did, sampler_path: checkpoint.sampler_path, public_model_id: modelAlias,
    sdk: `${sdk.name}@${sdk.version}`, ...requestEvidence, provider_requests: dispatched,
    events, stop_reason: response.stopReason, usage_tokens: { input: response.usage.input, output: response.usage.output,
      total: response.usage.totalTokens }, tool_calls_received: toolCalls.length, tools_executed: 0,
    response, created_at: new Date().toISOString() };
  await writePrivate(path.join(runDir, "keating-sdk-smoke.json"), evidence);
  console.log(JSON.stringify({ mode: "executed", sdk: evidence.sdk, provider_requests: dispatched,
    stop_reason: evidence.stop_reason, usage_tokens: evidence.usage_tokens,
    tool_calls_received: toolCalls.length, tools_executed: 0, artifact: path.join(runDir, "keating-sdk-smoke.json") }));
}

main().catch(() => {
  // SDK errors can embed credentials or the prompt. Keep failure output generic.
  console.error("Keating SDK pilot check failed; no prompt, credential, or provider error was logged.");
  process.exitCode = 1;
});
