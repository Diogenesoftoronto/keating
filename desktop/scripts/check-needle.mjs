#!/usr/bin/env node
/** Real Node/worker/native-HTTP smoke. Never removes a workspace, model, or generated evidence. */
import { mkdtemp, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const usage = "Usage: node desktop/scripts/check-needle.mjs --workspace PATH [--install] [--runtime PATH-TO-native-runtime.js-OR-DIRECTORY]";
function options(argv) {
  const result = { workspace: "", runtime: join(repository, "desktop/dist/native-runtime.js"), install: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!["--workspace", "--runtime", "--install"].includes(name) || seen.has(name)) throw Error("needle_smoke_invalid_arguments");
    seen.add(name);
    if (name === "--install") { result.install = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw Error("needle_smoke_invalid_arguments");
    result[name.slice(2)] = resolve(value);
  }
  if (!result.workspace) throw Error("needle_smoke_workspace_required");
  return result;
}
function requireCondition(condition, code) { if (!condition) throw Error(code); }
function validateEmbedding(value, count) {
  requireCondition(value && typeof value.model === "string" && value.model.length > 0 && value.dimensions === 3072
    && Array.isArray(value.vectors) && value.vectors.length === count, "needle_smoke_embedding_shape");
  for (const vector of value.vectors) requireCondition(Array.isArray(vector) && vector.length === 3072
    && vector.every(number => typeof number === "number" && Number.isFinite(number))
    && vector.some(number => number !== 0), "needle_smoke_embedding_values");
  return value;
}
const maxDifference = (left, right) => Math.max(...left.map((value, index) => Math.abs(value - right[index])));
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Bundle the unchanged web dispatch wrapper; only the final hosted tutor transport is captured. */
async function checkReplyRecall(runtime) {
  const directory = await mkdtemp(join(tmpdir(), "keating-needle-reply-"));
  const bundle = join(directory, "reply-recall.mjs");
  const built = spawnSync("bun", ["build", join(repository, "web/src/keating/needle-retrieval.ts"), "--target=node", "--format=esm", "--outfile", bundle],
    { cwd: repository, stdio: ["ignore", "pipe", "pipe"], timeout: 60000, maxBuffer: 1024 * 1024 });
  requireCondition(built.status === 0 && !built.error, "needle_smoke_reply_bundle_failed");
  const { createDesktopNeedleRecall, withDesktopNeedleRecall } = await import(pathToFileURL(bundle).href);
  const quote = "I am practicing the difference between area and perimeter by drawing rectangles.";
  const now = Date.now();
  const store = {
    async getAllMetadata() { return [{ id: "smoke-synthetic-session" }]; },
    async loadSession(id) { return id === "smoke-synthetic-session" ? { id, messages: [
      { id: "smoke-learner-message", role: "user", content: quote, timestamp: now - 10000 },
      { id: "smoke-assistant-message", role: "assistant", content: "ASSISTANT_TEXT_MUST_NOT_BECOME_LEARNER_RECALL", timestamp: now - 9000 },
    ] } : null; },
  };
  let retrieved = null, calls = 0, dispatched = null;
  const recall = createDesktopNeedleRecall({ store, execute: (operation, payload) => runtime.execute(operation, payload),
    identity: () => "smoke-local-device", requestIdentity: () => "smoke-request", current: () => true,
    available: () => true, enabled: () => true, subscribe: () => () => {},
    onRetrieved: result => { retrieved = result; } });
  try {
    const initial = { systemPrompt: "Existing tutor instructions.", messages: [{ role: "user", content: quote, timestamp: now }] };
    const wrapped = withDesktopNeedleRecall((_model, context) => { calls++; dispatched = context; return { smokeTransportCaptured: true }; }, recall);
    await wrapped({}, initial, {});
    requireCondition(calls === 1 && dispatched && dispatched !== initial && dispatched.systemPrompt.startsWith(initial.systemPrompt)
      && dispatched.systemPrompt.includes("<keating-local-recall>") && dispatched.systemPrompt.includes(quote)
      && !dispatched.systemPrompt.includes("ASSISTANT_TEXT_MUST_NOT_BECOME_LEARNER_RECALL")
      && !initial.systemPrompt.includes("<keating-local-recall>"), "needle_smoke_reply_context_missing");
    requireCondition(retrieved?.matches?.some(match => match.source.sessionId === "smoke-synthetic-session"
      && match.source.messageId === "smoke-learner-message" && match.source.text === quote), "needle_smoke_reply_source_provenance");
    return { exactSyntheticLearnerExcerpt: true, sourceProvenance: true, existingPromptPreserved: true,
      actualNativeEmbedding: true, tutorTransport: "captured-before-provider", sourceKind: "synthetic-smoke-only", bundle };
  } finally { recall.dispose(); }
}

export async function checkDesktopNeedle(input) {
  requireCondition(!process.versions.bun, "needle_smoke_requires_node");
  const configured = options(input);
  if ((await stat(configured.runtime)).isDirectory()) configured.runtime = join(configured.runtime, "native-runtime.js");
  const { startNativeRuntime } = await import(pathToFileURL(configured.runtime).href);
  requireCondition(typeof startNativeRuntime === "function", "needle_smoke_native_runtime_missing");
  const evidence = { schemaVersion: 1, check: "desktop-needle-native-v1", startedAt: new Date().toISOString(),
    node: process.versions.node, runtime: configured.runtime, workspace: configured.workspace, installAuthorized: configured.install,
    installPerformed: false, mainProcessExternalFetchGuard: true, offlineBlockedFetchAttempts: 0, externalFetchesDuringExplicitInstall: 0 };
  const originalFetch = globalThis.fetch;
  let permitInstallFetch = configured.install, runtime = null, phase = "start";
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      if (!permitInstallFetch) { evidence.offlineBlockedFetchAttempts++; throw Error("needle_smoke_external_fetch_blocked"); }
      evidence.externalFetchesDuringExplicitInstall++;
    }
    return originalFetch(input, init);
  };
  try {
    runtime = await startNativeRuntime(configured.workspace);
    phase = "initial-status";
    const before = await runtime.execute("needle.status", {});
    if (configured.install && !before?.installed) {
      phase = "explicit-install";
      await runtime.execute("needle.install", {}); evidence.installPerformed = true;
    }
    permitInstallFetch = false;
    const status = await runtime.execute("needle.status", {});
    requireCondition(status?.installed === true && status.available === true && status.managed === true, "needle_smoke_managed_model_not_installed");
    evidence.model = status.model;
    phase = "embedding";
    const texts = ["A rectangle's area counts the square units inside its boundary.", "A rectangle's area counts the square units inside its boundary.", "Bread dough rises as yeast produces carbon dioxide."];
    const started = performance.now();
    const embedding = validateEmbedding(await runtime.execute("needle.embed", { texts }), texts.length);
    evidence.initialEmbeddingMs = Math.round(performance.now() - started);
    requireCondition(embedding.model === status.model, "needle_smoke_embedding_model_mismatch");
    requireCondition(maxDifference(embedding.vectors[0], embedding.vectors[1]) <= 1e-6, "needle_smoke_repeated_input_unstable");
    requireCondition(maxDifference(embedding.vectors[0], embedding.vectors[2]) > 1e-6, "needle_smoke_different_inputs_identical");
    evidence.dimensions = embedding.dimensions; evidence.finiteNonzeroVectors = true; evidence.repeatedInputStable = true; evidence.differentInputDifferent = true;
    evidence.vectorDigest = digest(embedding.vectors[0]);
    phase = "stop-and-restart";
    await runtime.stop(); runtime = null;
    runtime = await startNativeRuntime(configured.workspace);
    const restarted = await runtime.execute("needle.status", {});
    requireCondition(restarted?.installed === true && restarted.available === true && restarted.managed === true && restarted.model === status.model, "needle_smoke_restart_install_missing");
    const freshStarted = performance.now();
    const fresh = validateEmbedding(await runtime.execute("needle.embed", { texts: [texts[0]] }), 1);
    requireCondition(fresh.model === status.model && maxDifference(embedding.vectors[0], fresh.vectors[0]) <= 1e-6, "needle_smoke_restart_vector_changed");
    evidence.restartEmbeddingMs = Math.round(performance.now() - freshStarted);
    evidence.restartReusedSavedModel = true;
    phase = "reply-recall";
    evidence.replyRecall = await checkReplyRecall(runtime);
    requireCondition(evidence.offlineBlockedFetchAttempts === 0, "needle_smoke_offline_network_attempted");
    evidence.status = "passed";
    return evidence;
  } catch (error) {
    const code = error instanceof Error && /^needle_[a-z0-9_]+$/u.test(error.message) ? error.message : "needle_smoke_failed";
    return { ...evidence, status: "failed", phase, error: code };
  } finally {
    try { await runtime?.stop(); } finally { globalThis.fetch = originalFetch; }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).includes("--help")) { process.stdout.write(`${usage}\n`); }
  else {
    try {
      const evidence = await checkDesktopNeedle(process.argv.slice(2));
      process.stdout.write(`${JSON.stringify(evidence)}\n`);
      if (evidence.status !== "passed") process.exitCode = 1;
    } catch (error) {
      const code = error instanceof Error && /^needle_[a-z0-9_]+$/u.test(error.message) ? error.message : "needle_smoke_start_failed";
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, check: "desktop-needle-native-v1", status: "failed", error: code })}\n`);
      process.exitCode = 1;
    }
  }
}
