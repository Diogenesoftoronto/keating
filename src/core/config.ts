import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_API_RETRY_POLICY, sanitizeApiRetryPolicy, type ApiRetryPolicy } from "./api-retry.js";

export type PiRuntimePreference = "standalone-only" | "prefer-standalone" | "embedded-only";

export interface KeatingConfig {
  pi: {
    runtimePreference: PiRuntimePreference;
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinking?: string;
  };
  speech: {
    enabled: boolean;
    defaultVoice: string;
    fastModel?: string;
    steeringModel?: string;
  };
  debug: {
    persistTraces: boolean;
    traceTopLearners: number;
    consoleSummary: boolean;
  };
  apiRetry: ApiRetryPolicy;
}

export const DEFAULT_PI_PROVIDER = "google";
export const DEFAULT_PI_MODEL = "gemini-3.1-pro-preview";
export const FALLBACK_PI_MODELS: Record<string, string> = {
  google: DEFAULT_PI_MODEL,
  openai: "gpt-5.2",
  anthropic: "claude-sonnet-4-5"
};

export const DEFAULT_KEATING_CONFIG: KeatingConfig = {
  pi: {
    runtimePreference: "prefer-standalone",
    defaultProvider: DEFAULT_PI_PROVIDER,
    defaultModel: DEFAULT_PI_MODEL,
    defaultThinking: "medium"
  },
  speech: {
    enabled: false,
    defaultVoice: "conversational",
    fastModel: "gemini-3.1-flash-live-preview",
    steeringModel: "default"
  },
  debug: {
    persistTraces: true,
    traceTopLearners: 3,
    consoleSummary: false
  },
  apiRetry: DEFAULT_API_RETRY_POLICY
};

export function configPath(cwd: string): string {
  return resolve(cwd, "keating.config.json");
}

function sanitizeRuntimePreference(value: unknown): PiRuntimePreference {
  if (value === "standalone-only" || value === "prefer-standalone" || value === "embedded-only") {
    return value;
  }
  return DEFAULT_KEATING_CONFIG.pi.runtimePreference;
}

function sanitizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeProvider(value: string | undefined): string | undefined {
  if (value === "google-gemini-cli") return DEFAULT_PI_PROVIDER;
  return value;
}

export async function loadKeatingConfig(cwd: string): Promise<KeatingConfig> {
  const path = configPath(cwd);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<KeatingConfig>;
    return {
      pi: {
        runtimePreference: sanitizeRuntimePreference(parsed.pi?.runtimePreference),
        defaultProvider: normalizeProvider(sanitizeOptionalString(parsed.pi?.defaultProvider)) ?? DEFAULT_KEATING_CONFIG.pi.defaultProvider,
        defaultModel: sanitizeOptionalString(parsed.pi?.defaultModel) ?? DEFAULT_KEATING_CONFIG.pi.defaultModel,
        defaultThinking: sanitizeOptionalString(parsed.pi?.defaultThinking) ?? DEFAULT_KEATING_CONFIG.pi.defaultThinking
      },
      speech: {
        enabled:
          typeof parsed.speech?.enabled === "boolean"
            ? parsed.speech.enabled
            : DEFAULT_KEATING_CONFIG.speech.enabled,
        defaultVoice: sanitizeOptionalString(parsed.speech?.defaultVoice) ?? DEFAULT_KEATING_CONFIG.speech.defaultVoice,
        fastModel: sanitizeOptionalString(parsed.speech?.fastModel) ?? DEFAULT_KEATING_CONFIG.speech.fastModel,
        steeringModel: sanitizeOptionalString(parsed.speech?.steeringModel) ?? DEFAULT_KEATING_CONFIG.speech.steeringModel
      },
      debug: {
        persistTraces:
          typeof parsed.debug?.persistTraces === "boolean"
            ? parsed.debug.persistTraces
            : DEFAULT_KEATING_CONFIG.debug.persistTraces,
        traceTopLearners:
          typeof parsed.debug?.traceTopLearners === "number" && parsed.debug.traceTopLearners > 0
            ? Math.round(parsed.debug.traceTopLearners)
            : DEFAULT_KEATING_CONFIG.debug.traceTopLearners,
        consoleSummary:
          typeof parsed.debug?.consoleSummary === "boolean"
            ? parsed.debug.consoleSummary
            : DEFAULT_KEATING_CONFIG.debug.consoleSummary
      },
      apiRetry: sanitizeApiRetryPolicy((parsed as Partial<KeatingConfig>).apiRetry)
    };
  } catch (err) {
    if (existsSync(path)) {
      console.error(`Warning: keating.config.json is invalid and will be ignored. Falling back to defaults. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return DEFAULT_KEATING_CONFIG;
  }
}

export async function writeKeatingConfig(cwd: string, config: KeatingConfig): Promise<void> {
  await writeFile(configPath(cwd), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function ensureConfig(cwd: string): Promise<void> {
  const path = configPath(cwd);
  if (!existsSync(path)) {
    await writeKeatingConfig(cwd, DEFAULT_KEATING_CONFIG);
  }
}

export function mergePiDefaults(config: KeatingConfig, args: string[]): string[] {
  const merged = [...args];
  const hasProvider = merged.includes("--provider");
  const hasModel = merged.includes("--model");
  const hasThinking = merged.includes("--thinking");

  if (!hasProvider && config.pi.defaultProvider) {
    merged.unshift(config.pi.defaultProvider);
    merged.unshift("--provider");
  }
  if (!hasModel && config.pi.defaultModel) {
    merged.unshift(config.pi.defaultModel);
    merged.unshift("--model");
  }
  if (!hasThinking && config.pi.defaultThinking) {
    merged.unshift(config.pi.defaultThinking);
    merged.unshift("--thinking");
  }

  return merged;
}

export function mergePiDefaultsWithOverrides(
  config: KeatingConfig,
  args: string[],
  overrides: { provider?: string; model?: string } = {}
): string[] {
  return mergePiDefaults({
    ...config,
    pi: {
      ...config.pi,
      defaultProvider: overrides.provider ?? config.pi.defaultProvider,
      defaultModel: overrides.model ?? config.pi.defaultModel
    }
  }, args);
}
