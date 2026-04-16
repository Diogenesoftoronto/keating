import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type PiRuntimePreference = "standalone-only" | "prefer-standalone" | "embedded-only";

export interface KeatingConfig {
  pi: {
    runtimePreference: PiRuntimePreference;
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinking?: string;
  };
  debug: {
    persistTraces: boolean;
    traceTopLearners: number;
    consoleSummary: boolean;
  };
}

export const DEFAULT_KEATING_CONFIG: KeatingConfig = {
  pi: {
    runtimePreference: "prefer-standalone",
    defaultProvider: "google",
    defaultModel: "google/gemini-2.5-pro",
    defaultThinking: "medium"
  },
  debug: {
    persistTraces: true,
    traceTopLearners: 3,
    consoleSummary: true
  }
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

export async function loadKeatingConfig(cwd: string): Promise<KeatingConfig> {
  const path = configPath(cwd);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<KeatingConfig>;
    return {
      pi: {
        runtimePreference: sanitizeRuntimePreference(parsed.pi?.runtimePreference),
        defaultProvider: sanitizeOptionalString(parsed.pi?.defaultProvider) ?? DEFAULT_KEATING_CONFIG.pi.defaultProvider,
        defaultModel: sanitizeOptionalString(parsed.pi?.defaultModel) ?? DEFAULT_KEATING_CONFIG.pi.defaultModel,
        defaultThinking: sanitizeOptionalString(parsed.pi?.defaultThinking) ?? DEFAULT_KEATING_CONFIG.pi.defaultThinking
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
      }
    };
  } catch {
    return DEFAULT_KEATING_CONFIG;
  }
}

export async function ensureConfig(cwd: string): Promise<void> {
  const path = configPath(cwd);
  if (!existsSync(path)) {
    await writeFile(path, `${JSON.stringify(DEFAULT_KEATING_CONFIG, null, 2)}\n`, "utf8");
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
