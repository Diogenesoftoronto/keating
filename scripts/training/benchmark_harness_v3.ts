/** Actual Keating headless TUI/Pi RPC sessions. No replacement model or tool loop. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchRpcClient, type KeatingRpcClient } from "../../src/runtime/pi.js";
import { DEFAULT_KEATING_CONFIG } from "../../src/core/config.js";
import { ensureProjectScaffold } from "../../src/core/project.js";
import { withLearnerProfile } from "../../src/core/learner-profile-selection.js";
import { learnerStatePath, sessionsDir, configDir } from "../../src/core/paths.js";
import { loadLearnerState, saveLearnerState } from "../../src/core/learner-state.js";
import { RpcUiActionDispatcher } from "../../src/tui/ui/rpc-action-transport.js";
import { canonicalUiAction, type UiAction, type UiDocument } from "../../src/tui/learner-contracts.js";
import { captureHarnessSources, changedHarnessSources, type HarnessSourceInventory } from "./benchmark_harness_v3_provenance.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const HARNESS_V3_LOCAL_TOOLS = ["read", "plan", "map", "verify", "quiz", "grade_quiz",
  "feedback", "learner_state", "remember_learner_profile", "forget_learner_profile", "timeline", "due", "policy", "outputs", "trace", "bench",
  "set_learner_goal", "list_learner_goals", "update_goal_step"] as const;
// Legacy quiz opens an operator form. Headless cancellation must never become a learner attempt.
// Keep its name valid for explicit compatibility profiles, whose calls are still blocked by the extension.
export const HARNESS_V3_DEFAULT_TOOLS = HARNESS_V3_LOCAL_TOOLS.filter((name) => name !== "quiz");
export interface HarnessTapeResponse {
  text?: string;
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}
export type HarnessV3Step = { kind: "message"; text: string } | { kind: "reopen" } | { kind: "new_session" }
  | { kind: "ui_action"; action: UiAction; sourceDocument: UiDocument };
export interface HarnessV3Request {
  id: string;
  transport: { kind: "tape"; responses: HarnessTapeResponse[] }
    | { kind: "provider"; provider: string; model: string; thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
      endpoint?: string; apiKeyEnv?: string; modelMetadata?: { contextWindow: number; maxTokens: number; reasoning?: boolean; name?: string } };
  steps: HarnessV3Step[];
  seed_files?: Record<string, string>;
  profile_name?: string;
  learner_profile?: string;
  allowed_tools?: string[];
  limits?: Partial<{ max_provider_calls: number; max_tool_calls: number; max_output_tokens: number; turn_timeout_ms: number }>;
}
interface FileReceipt { path: string; sha256: string; content: string }
export interface HarnessV3Result {
  id: string;
  status: "completed" | "failed";
  error_code: string | null;
  runtime: "keating-tui-pi-rpc";
  measurement: "offline_integration" | "model_episode";
  fidelity: { entrypoint: string; model_loop: string; tool_handlers: string; persistence: string; limitations: string[] };
  configuration: { allowed_tools: string[]; limits: Required<HarnessV3Request>["limits"]; transport_kind: string; profile_name: string | null };
  source_hashes: Record<string, string>;
  source_provenance: Omit<HarnessSourceInventory, "hashes" | "readonly_resources"> & { unchanged_at_end: boolean | null; changed_paths: string[] };
  steps: Array<{ index: number; kind: HarnessV3Step["kind"]; status: "completed" | "failed"; error_code?: string;
    message_start_index: number;
    events: unknown[]; messages: unknown[]; state: Record<string, unknown>; files: FileReceipt[]; action_result?: unknown;
    action_followup?: "completed" | "not_requested" | "already_delivered" | "not_supported_by_built_receiver" }>;
  requests: unknown[];
  receipts: unknown[];
  initial_files: FileReceipt[];
  files: FileReceipt[];
  session_files: FileReceipt[];
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function positive(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error("harness_invalid_limits");
  return Number(value);
}
export function validateHarnessRequest(request: HarnessV3Request): void {
  if (!request || typeof request.id !== "string" || !request.id || request.id.length > 160
    || !Array.isArray(request.steps) || !request.steps.length || request.steps.length > 40) throw new Error("harness_invalid_request");
  if (!["tape", "provider"].includes(request.transport?.kind)) throw new Error("harness_invalid_transport");
  if (request.transport.kind === "tape" && (!Array.isArray(request.transport.responses) || request.transport.responses.length > 100)) throw new Error("harness_invalid_tape");
  if (request.transport.kind === "provider" && (!request.transport.provider || !request.transport.model)) throw new Error("harness_invalid_model");
  if (request.transport.kind === "provider" && request.transport.endpoint !== undefined) {
    const transport = request.transport;
    let url: URL;
    try { url = new URL(transport.endpoint!); } catch { throw new Error("harness_invalid_endpoint"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || !/^[A-Z][A-Z0-9_]*$/.test(transport.apiKeyEnv ?? "")
      || !Number.isSafeInteger(transport.modelMetadata?.contextWindow) || transport.modelMetadata!.contextWindow < 1000
      || !Number.isSafeInteger(transport.modelMetadata?.maxTokens) || transport.modelMetadata!.maxTokens < 1) throw new Error("harness_invalid_custom_provider");
  }
  for (const step of request.steps) {
    if (!["message", "reopen", "new_session", "ui_action"].includes(step.kind)) throw new Error("harness_invalid_step");
    // Slash and shell commands execute before Pi tool guards. Learner text is conversation text only.
    if (step.kind === "message" && (typeof step.text !== "string" || !step.text.trim() || /^[\s]*[!/]/.test(step.text)
      || step.text.length > 65_536)) throw new Error("harness_invalid_learner_message");
  }
  if (request.profile_name !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(request.profile_name)) throw new Error("harness_invalid_profile");
  if (request.learner_profile !== undefined && (typeof request.learner_profile !== "string" || request.learner_profile.length > 1500 || !request.profile_name)) throw new Error("harness_invalid_profile");
  if (request.allowed_tools?.some((name) => !(HARNESS_V3_LOCAL_TOOLS as readonly string[]).includes(name))) throw new Error("harness_unsupported_tool_profile");
  for (const [path, content] of Object.entries(request.seed_files ?? {})) {
    const normalized = path.replaceAll("\\", "/");
    // Only authored learner fixtures/data, never config, extensions, credentials or source.
    if (isAbsolute(path) || normalized.split("/").includes("..") || normalized.includes("\0")
      || !(normalized.startsWith("fixtures/") || /^\.keating\/state\/(learner|goals)\.json$/.test(normalized))
      || typeof content !== "string" || content.length > 262_144) throw new Error("harness_invalid_seed_path");
  }
}

async function filesUnder(cwd: string, prefix: string): Promise<FileReceipt[]> {
  const result: FileReceipt[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const content = await readFile(path, "utf8");
        if (content.length <= 4_194_304) result.push({ path: relative(cwd, path), sha256: hash(content), content });
      }
    }
  }
  await visit(join(cwd, prefix));
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
async function domainFiles(cwd: string): Promise<FileReceipt[]> {
  return [...await filesUnder(cwd, ".keating/state"), ...await filesUnder(cwd, ".keating/outputs"), ...await filesUnder(cwd, ".keating/profiles")].filter(file => !file.path.includes("/sessions/") && !file.path.includes("/pi-config/"));
}
function assistantError(messages: unknown[]): string | null {
  const error = messages.find((message: any) => message?.role === "assistant" && ["error", "aborted"].includes(message.stopReason)) as any;
  if (!error) return null;
  return /^harness_[a-z_]+$/.test(error.errorMessage ?? "") ? error.errorMessage : "harness_provider_failure";
}
async function assertRuntimeReady(client: KeatingRpcClient, directory: string, request: HarnessV3Request): Promise<void> {
  await client.prompt("/keating-benchmark-v3-ready");
  const receipts = (await readFile(join(directory, "events.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const failure = receipts.findLast((receipt) => receipt.kind === "fatal");
  if (failure) throw new Error(failure.data.code);
  const startup = receipts.findLast((receipt) => receipt.kind === "session_start");
  if (!startup || !receipts.some((receipt) => receipt.kind === "resources_verified")) throw new Error("harness_startup_not_verified");
  if (request.transport.kind === "provider" && !receipts.some((receipt) => receipt.kind === "limits_installed")) throw new Error("harness_limits_not_installed");
}

export async function runHarnessEpisode(request: HarnessV3Request, diagnostics?: (error: unknown) => void): Promise<HarnessV3Result> {
  validateHarnessRequest(request);
  // The launcher pins its agent/session directories; reject executable preload/package overrides.
  for (const key of ["NODE_OPTIONS", "BUN_OPTIONS", "BUN_INSPECT", "PI_PACKAGE_DIR"]) {
    if (process.env[key]?.trim()) throw new Error("harness_ambient_runtime_override");
  }
  const limits = {
    max_provider_calls: positive(request.limits?.max_provider_calls, 24, 100),
    max_tool_calls: positive(request.limits?.max_tool_calls, 32, 128),
    max_output_tokens: positive(request.limits?.max_output_tokens, 3000, 16000),
    turn_timeout_ms: positive(request.limits?.turn_timeout_ms, 60_000, 600_000),
  };
  const allowed_tools = [...new Set(request.allowed_tools ?? HARNESS_V3_DEFAULT_TOOLS)];
  const inventory = await captureHarnessSources(ROOT);
  const source_hashes = inventory.hashes;
  const builtSubmissionFollowup = (await readFile(join(ROOT, "dist/src/tui/ui/rpc-action-transport.js"), "utf8")).includes("triggerTurn: true");
  const cwd = await mkdtemp(join(tmpdir(), "keating-harness-v3-"));
  return withLearnerProfile(cwd, request.profile_name, async () => {
  const directory = join(cwd, ".keating", "benchmark-harness");
  let client: KeatingRpcClient | undefined;
  const result: HarnessV3Result = {
    id: request.id, status: "completed", error_code: null, runtime: "keating-tui-pi-rpc",
    measurement: request.transport.kind === "tape" ? "offline_integration" : "model_episode",
    fidelity: {
      entrypoint: "src/runtime/pi.ts:launchRpcClient", model_loop: "Actual shipped Pi RPC runtime and agent loop",
      tool_handlers: "Actual hyper-teacher extension handlers under a recorded local capability profile",
      persistence: "Actual filesystem learner state, goals, action journals and Pi JSONL sessions; disposable workspace",
      limitations: ["Headless TUI runtime; no terminal pixels or browser Flue/OpenUI renderer proof.",
        "Local tools only; shell, source edits, speech, external effects and model-backed evolution are unavailable.",
        "Legacy interactive quiz is inactive by default and always blocked before execution, including explicit compatibility profiles. Only actual canonical learner submissions create activity attempts.",
        "The explicit --tools profile includes teaching extensions; this installed Pi version also applies --tools to custom tools.",
        "Pi prompts/skills and teaching revision hooks run normally; ancestor/user context discovery, provider retries and auto-compaction are disabled explicitly.",
        builtSubmissionFollowup ? "Terminal assessment submissions use Pi's persisted follow-up loop; terminal journals and grading still differ from web IndexedDB." : "This built terminal receiver journals documents but predates automatic tutor follow-ups; source and built hashes are recorded separately.",
        "Scripted learner behavior and offline tapes do not measure human learning or model teaching quality."],
    },
    configuration: { allowed_tools, limits, transport_kind: request.transport.kind, profile_name: request.profile_name ?? null }, source_hashes,
    source_provenance: { scope: inventory.scope, unresolved_optional_imports: inventory.unresolved_optional_imports, unchanged_at_end: null, changed_paths: [] },
    steps: [], requests: [], receipts: [], initial_files: [], files: [], session_files: [],
  };
  try {
    await ensureProjectScaffold(cwd);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "request.json"), JSON.stringify({ ...request, blocked_roots: [sessionsDir(cwd), configDir(cwd)], allowed_tools, limits,
      readonly_resources: inventory.readonly_resources }), { mode: 0o600 });
    const provider = request.transport.kind === "tape" ? "keating-benchmark-tape" : request.transport.provider;
    const model = request.transport.kind === "tape" ? "scripted" : request.transport.model;
    const thinking = request.transport.kind === "tape" ? "off" : request.transport.thinking ?? "off";
    await writeFile(join(cwd, "keating.config.json"), JSON.stringify({ ...DEFAULT_KEATING_CONFIG,
      pi: { runtimePreference: "embedded-only", defaultProvider: provider, defaultModel: model, defaultThinking: thinking, packages: [] },
      speech: { ...DEFAULT_KEATING_CONFIG.speech, enabled: false } }), { mode: 0o600 });
    for (const [path, content] of Object.entries(request.seed_files ?? {})) {
      const target = join(cwd, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { mode: 0o600 });
    }
    if (request.learner_profile !== undefined) {
      const state = await loadLearnerState(learnerStatePath(cwd));
      state.profile.background = request.learner_profile;
      await saveLearnerState(learnerStatePath(cwd), state);
    }
    result.initial_files = await domainFiles(cwd);
    client = await launchRpcClient(cwd, ["--provider", provider, "--model", model, "--thinking", thinking, "--tools", allowed_tools.join(","), "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes",
      "--extension", join(ROOT, "scripts/training/benchmark_harness_v3_extension.ts")]);
    if (client.getStderr()) diagnostics?.(client.getStderr());
    await assertRuntimeReady(client, directory, request);
    await client.setAutoRetry(false);
    await client.setAutoCompaction(false);
    client.onEvent((event: any) => {
      // RPC UI prompts must not wait for a nonexistent operator or trigger an external action.
      if (event?.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method)) {
        void client?.respondToExtensionUI({ type: "extension_ui_response", id: event.id, cancelled: true, reason: "headless benchmark" });
      }
    });
    for (const [index, step] of request.steps.entries()) {
      const before = await client.getMessages();
      const receipt: HarnessV3Result["steps"][number] = { index, kind: step.kind, status: "completed", message_start_index: ["message", "ui_action"].includes(step.kind) ? before.length : 0, events: [], messages: [], state: {}, files: [] };
      try {
        if (step.kind === "message") receipt.events = await client.promptAndWait(step.text, undefined, limits.turn_timeout_ms);
        else if (step.kind === "reopen") {
          const state = await client.getState();
          const sessionPath = state.sessionFile;
          if (typeof sessionPath !== "string" || !sessionPath.startsWith(sessionsDir(cwd) + "/")) throw new Error("harness_session_path_missing");
          await client.restart({ sessionPath });
          await assertRuntimeReady(client, directory, request);
          await client.setAutoRetry(false);
          await client.setAutoCompaction(false);
        } else if (step.kind === "new_session") {
          if ((await client.newSession()).cancelled) throw new Error("harness_session_cancelled");
          await assertRuntimeReady(client, directory, request);
        } else {
          const dispatcher = new RpcUiActionDispatcher(client, Math.min(limits.turn_timeout_ms, 10_000));
          const assessment = ["submit-answer", "choose-option", "submit-question-group", "complete-quiz"].includes(step.action.type);
          const fingerprint = canonicalUiAction(step.action);
          const delivered = before.some((message: any) => message?.details?.actionFingerprint === fingerprint);
          let ended = false;
          let finish!: () => void;
          const idle = new Promise<void>((resolve) => { finish = resolve; });
          // Subscribe before dispatch: a fast offline continuation may finish before the business ACK.
          const unsubscribe = client.onEvent((event: any) => {
            receipt.events.push(event);
            if (event?.type === "agent_end") { ended = true; finish(); }
          });
          try {
            const outcome = await dispatcher.dispatch(step.action, step.sourceDocument);
            receipt.action_result = outcome;
            if (!assessment || outcome.status !== "completed") receipt.action_followup = "not_requested";
            else if (delivered) receipt.action_followup = "already_delivered";
            else if (!builtSubmissionFollowup) receipt.action_followup = "not_supported_by_built_receiver";
            else {
              if (!ended) {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try { await Promise.race([idle, new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => reject(new Error("harness_timeout")), limits.turn_timeout_ms);
                })]); }
                finally { if (timer) clearTimeout(timer); }
              }
              receipt.action_followup = "completed";
            }
          } finally { unsubscribe(); dispatcher.dispose(); }
        }
        receipt.messages = await client.getMessages();
        const failure = step.kind === "message" || step.kind === "ui_action" ? assistantError(receipt.messages.slice(before.length)) : null;
        if (failure) throw new Error(failure);
        receipt.state = await client.getState();
      } catch (error) {
        diagnostics?.(error);
        const message = error instanceof Error ? error.message : "";
        receipt.status = "failed";
        receipt.error_code = /^harness_[a-z_]+$/.test(message) ? message : /Timeout/.test(message) ? "harness_timeout" : "harness_rpc_failure";
        receipt.messages = await client.getMessages().catch(() => []);
        receipt.state = await client.getState().catch(() => ({}));
        result.status = "failed";
        result.error_code = receipt.error_code;
      }
      receipt.files = await domainFiles(cwd);
      result.steps.push(receipt);
      if (receipt.status === "failed") break;
    }
  } catch (error) {
    diagnostics?.(error);
    result.status = "failed";
    result.error_code = error instanceof Error && /^harness_[a-z_]+$/.test(error.message) ? error.message : "harness_startup_failure";
  } finally {
    await client?.stop();
    const source = await readFile(join(directory, "events.jsonl"), "utf8").catch(() => "");
    result.receipts = source.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    result.requests = result.receipts.filter((receipt: any) => receipt.kind === "provider_request");
    result.files = await domainFiles(cwd);
    result.session_files = await filesUnder(cwd, relative(cwd, sessionsDir(cwd)));
    result.source_provenance.changed_paths = await changedHarnessSources(ROOT, source_hashes);
    result.source_provenance.unchanged_at_end = result.source_provenance.changed_paths.length === 0;
    if (!result.source_provenance.unchanged_at_end) { result.status = "failed"; result.error_code = "harness_source_changed"; }
    await rm(cwd, { recursive: true, force: true });
  }
  return result;
  });
}

if (import.meta.main) {
  const source = process.argv[2] ? await readFile(resolve(process.argv[2]), "utf8") : await Bun.stdin.text();
  try {
    const result = await runHarnessEpisode(JSON.parse(source));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "completed" ? 0 : 1;
  } catch (error) {
    const code = error instanceof Error && /^harness_[a-z_]+$/.test(error.message) ? error.message : "harness_invalid_request";
    process.stdout.write(`${JSON.stringify({ status: "failed", error_code: code })}\n`);
    process.exitCode = 1;
  }
}
