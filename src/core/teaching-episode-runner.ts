import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EpisodeExecution, EpisodeMessage, EpisodeRunner } from "../../shared/evolution/contracts.js";
import { loadKeatingConfig } from "./config.js";
import { selectAuthenticatedProvider } from "../runtime/pi.js";

export interface TeachingEpisodeLimits {
  timeoutMs: number;
  maxProviderCalls: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  maxOutputBytes: number;
}

export const DEFAULT_TEACHING_EPISODE_LIMITS: Readonly<TeachingEpisodeLimits> = Object.freeze({
  timeoutMs: 90_000,
  maxProviderCalls: 6,
  maxToolCalls: 8,
  maxOutputTokens: 2_048,
  maxOutputBytes: 1_048_576,
});

/** Deliberately excludes animation's nested inference, evolution, shell, and source mutation. */
export const TEACHING_EPISODE_TOOLS = Object.freeze(["plan", "map", "verify", "quiz", "grade_quiz", "read"]);

export class TeachingEpisodeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TeachingEpisodeError";
  }
}

/** Private child protocol. Credentials remain in the provider store/environment, never this payload. */
export interface TeachingEpisodeRequest {
  schemaVersion: 1;
  mode: "teaching" | "completion";
  sourceCwd: string;
  provider: string;
  model: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  caseId: string;
  systemPrompt: string;
  messages: EpisodeMessage[];
  limits: TeachingEpisodeLimits;
}

function limitsWithOverrides(overrides: Partial<TeachingEpisodeLimits> = {}): TeachingEpisodeLimits {
  const limits = { ...DEFAULT_TEACHING_EPISODE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    const maximum = key === "timeoutMs" ? 120_000
      : key === "maxProviderCalls" ? 12 : key === "maxToolCalls" ? 24
      : key === "maxOutputTokens" ? 8_192 : 2_097_152;
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new TeachingEpisodeError("episode_invalid_limits");
    }
  }
  return limits;
}

export function validateTeachingEpisodeRequest(value: unknown): value is TeachingEpisodeRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as TeachingEpisodeRequest;
  if (request.schemaVersion !== 1 || !["teaching", "completion"].includes(request.mode)
    || typeof request.sourceCwd !== "string" || !request.sourceCwd
    || typeof request.provider !== "string" || !request.provider
    || typeof request.model !== "string" || !request.model
    || !["off", "minimal", "low", "medium", "high", "xhigh"].includes(request.thinking)
    || typeof request.caseId !== "string" || !request.caseId || request.caseId.length > 256
    || typeof request.systemPrompt !== "string" || !request.systemPrompt.trim()
    || !Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > 64
    || request.messages.at(-1)?.role !== "user") return false;
  let characters = request.systemPrompt.length;
  for (const message of request.messages) {
    if (!message || !["user", "assistant"].includes(message.role)
      || typeof message.content !== "string" || !message.content.trim()) return false;
    characters += message.content.length;
  }
  if (characters > 128_000) return false;
  try {
    if (!request.limits || Object.keys(request.limits).length !== 5) return false;
    limitsWithOverrides(request.limits);
  } catch { return false; }
  return true;
}

function isExecution(value: unknown): value is EpisodeExecution {
  if (!value || typeof value !== "object") return false;
  const execution = value as EpisodeExecution;
  return typeof execution.model === "string" && execution.model.length > 0
    && typeof execution.runtime === "string" && execution.runtime.length > 0
    && Array.isArray(execution.messages) && execution.messages.length > 0
    && execution.messages.every((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    && Array.isArray(execution.toolCalls)
    && execution.toolCalls.every((call) => call && typeof call.name === "string" && (call.result === undefined || typeof call.result === "string"));
}

/** Public for transport tests. Each invocation owns and removes its isolated working directory. */
export async function runTeachingEpisodeSubprocess(
  request: TeachingEpisodeRequest,
  options: { signal: AbortSignal; env?: NodeJS.ProcessEnv; entryPath?: string; executable?: string },
): Promise<EpisodeExecution> {
  if (!validateTeachingEpisodeRequest(request)) throw new TeachingEpisodeError("episode_invalid_request");
  if (options.signal.aborted) throw new TeachingEpisodeError("episode_aborted");
  const payload = JSON.stringify(request);
  const compiledPath = fileURLToPath(new URL("../runtime/teaching-episode-child.js", import.meta.url));
  const entryPath = options.entryPath ?? (existsSync(compiledPath) ? compiledPath : compiledPath.replace(/\.js$/, ".ts"));
  const executable = options.executable ?? (entryPath.endsWith(".ts") ? (process.versions.bun ? process.execPath : "bun") : "node");
  const episodeCwd = await mkdtemp(join(tmpdir(), "keating-teaching-episode-"));
  try {
    if (options.signal.aborted) throw new TeachingEpisodeError("episode_aborted");
    return await new Promise<EpisodeExecution>((resolveResult, reject) => {
      const child = spawn(executable, [entryPath], {
        cwd: episodeCwd,
        env: { ...options.env ?? process.env, PI_SKIP_VERSION_CHECK: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let bytes = 0;
      let failure: string | undefined;
      const stop = (code: string) => {
        failure ??= code;
        child.kill("SIGKILL");
      };
      const onAbort = () => stop("episode_aborted");
      const timer = setTimeout(() => stop("episode_timeout"), request.limits.timeoutMs);
      options.signal.addEventListener("abort", onAbort, { once: true });
      if (options.signal.aborted) onAbort();
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > request.limits.maxOutputBytes) stop("episode_output_limit");
        else stdout += chunk.toString("utf8");
      });
      // Never expose provider stderr, which may contain private request details.
      child.stderr.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > request.limits.maxOutputBytes) stop("episode_output_limit");
      });
      child.stdin.on("error", () => stop("episode_transport_failure"));
      child.on("error", () => { failure ??= "episode_runtime_unavailable"; });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", onAbort);
        if (failure) return reject(new TeachingEpisodeError(failure));
        try {
          const response = JSON.parse(stdout) as { ok?: unknown; execution?: unknown; errorCode?: unknown };
          if (response.ok === false && typeof response.errorCode === "string" && /^episode_[a-z_]+$/.test(response.errorCode)) {
            return reject(new TeachingEpisodeError(response.errorCode));
          }
          if (code !== 0 || response.ok !== true || !isExecution(response.execution)) throw new Error();
          resolveResult(response.execution);
        } catch {
          reject(new TeachingEpisodeError("episode_invalid_response"));
        }
      });
      child.stdin.end(payload);
    });
  } finally {
    await rm(episodeCwd, { recursive: true, force: true });
  }
}

async function configuredRunner(cwd: string, mode: TeachingEpisodeRequest["mode"], overrides: Partial<TeachingEpisodeLimits>): Promise<EpisodeRunner> {
  const sourceCwd = resolve(cwd);
  const config = await loadKeatingConfig(sourceCwd);
  const selected = selectAuthenticatedProvider(sourceCwd, config, []);
  if (selected.missingProvider) throw new TeachingEpisodeError("episode_provider_unconfigured");
  const provider = selected.provider ?? config.pi.defaultProvider;
  const model = selected.model ?? config.pi.defaultModel;
  if (!provider || !model) throw new TeachingEpisodeError("episode_model_unconfigured");
  const limits = limitsWithOverrides(overrides);
  const thinking = (["off", "minimal", "low", "medium", "high", "xhigh"] as const)
    .find((level) => level === config.pi.defaultThinking) ?? "off";
  return (input) => runTeachingEpisodeSubprocess({
    schemaVersion: 1, mode, sourceCwd, provider, model,
    thinking,
    caseId: input.caseId, systemPrompt: input.systemPrompt,
    messages: input.messages, limits,
  }, { signal: input.signal, env: selected.env });
}

export function createPiEpisodeRunner(cwd: string, limits: Partial<TeachingEpisodeLimits> = {}): Promise<EpisodeRunner> {
  return configuredRunner(cwd, "teaching", limits);
}

/** Independent judge/proposer calls use the same provider transport with zero tools. */
export async function createPiCompletionRunner(cwd: string, limits: Partial<TeachingEpisodeLimits> = {}): Promise<(input: {
  systemPrompt: string; prompt: string; signal: AbortSignal;
}) => Promise<string>> {
  const run = await configuredRunner(cwd, "completion", { ...limits, maxProviderCalls: 1 });
  return async (input) => {
    const execution = await run({ caseId: "independent-completion", systemPrompt: input.systemPrompt, messages: [{ role: "user", content: input.prompt }], signal: input.signal });
    const response = execution.messages.filter((message) => message.role === "assistant").at(-1)?.content;
    if (!response?.trim()) throw new TeachingEpisodeError("episode_empty_response");
    return response;
  };
}
