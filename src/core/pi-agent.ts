import { spawnSync } from "node:child_process";
import { loadKeatingConfig, mergePiDefaults } from "./config.js";
import { configDir } from "./paths.js";
import { detectAiRuntime } from "../runtime/pi.js";
import { withApiRetry } from "./api-retry.js";
import { classifyObservationError, exportProviderCompletion } from "../observability/arize.js";

const OBSERVABILITY_APP_VERSION = process.env.npm_package_version ?? "3.0.0";

export interface PiCompletionOptions {
  systemPrompt?: string;
  json?: boolean;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

/**
 * Programmatic interface to the AI agent via CLI.
 * This ensures we use the same provider, model, and thinking settings as the user's agent install.
 */
export async function piComplete(cwd: string, prompt: string, options: PiCompletionOptions = {}): Promise<string> {
  const startedAt = Date.now();
  const config = await loadKeatingConfig(cwd);
  const runtime = await detectAiRuntime(cwd);

  if (!runtime.selected) {
    throw new Error(
      "No AI runtime found. Install `pi` with `npm install -g @earendil-works/pi-coding-agent`, or reinstall Keating so its embedded runtime dependency is present."
    );
  }
  const selectedRuntime = runtime.selected;

  const args = ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills"];

  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  if (options.json) {
    args.push("--mode", "json");
  }

  if (options.thinking) {
    args.push("--thinking", options.thinking);
  }

  const finalArgs = mergePiDefaults(config, [...args, prompt]);

  try {
    const response = await withApiRetry(() => {
    let result;
    try {
      const isBinary = selectedRuntime.kind === "binary";
      const command = selectedRuntime.command;
      const spawnArgs = isBinary ? finalArgs : [selectedRuntime.cliPath!, ...finalArgs];

      result = spawnSync(command, spawnArgs, {
        cwd,
        stdio: "pipe",
        encoding: "utf8",
        env: {
          ...process.env,
          PI_SKIP_VERSION_CHECK: "1",
          PI_CODING_AGENT_DIR: configDir(cwd)
        }
      });
    } catch (e) {
      throw new Error(`Agent command could not be spawned: ${e}`);
    }

    if (result.error) {
      throw new Error(`Agent command failed to launch: ${result.error.message}`);
    }

    const signal = result.signal;
    const exitStatus = result.status;

    if (exitStatus === null || exitStatus !== 0) {
      const errMsg = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
      const exitInfo = exitStatus !== null ? `exit ${exitStatus}` : `killed by signal ${signal ?? "unknown"}`;
      throw new Error(`Agent completion failed (${exitInfo}): ${errMsg}`);
    }

    return result.stdout.trim();
    }, config.apiRetry);
    if (!options.json) {
      await exportProviderCompletion({
        provider: config.pi.defaultProvider ?? "unknown",
        model: config.pi.defaultModel ?? "unknown",
        duration_ms: Math.max(0, Date.now() - startedAt),
        status: "success",
        parse_outcome: "not_requested",
        app_version: OBSERVABILITY_APP_VERSION,
        surface: "cli",
      });
    }
    return response;
  } catch (error) {
    await exportProviderCompletion({
      provider: config.pi.defaultProvider ?? "unknown",
      model: config.pi.defaultModel ?? "unknown",
      duration_ms: Math.max(0, Date.now() - startedAt),
      status: "error",
      parse_outcome: "not_requested",
      error_category: classifyObservationError(error),
      app_version: OBSERVABILITY_APP_VERSION,
      surface: "cli",
    });
    throw error;
  }
}

/**
 * Specialized helper for JSON completions.
 */
export async function piCompleteJson<T>(cwd: string, prompt: string, options: PiCompletionOptions = {}): Promise<T> {
  const startedAt = Date.now();
  const response = await piComplete(cwd, prompt, { ...options, json: true });
  const config = await loadKeatingConfig(cwd).catch(() => undefined);
  try {
    // Some models output reasoning BEFORE the JSON block.
    // We try to find all JSON-like blocks and pick the one that parses successfully,
    // prioritizing the last one.
    const matches = response.match(/\{[\s\S]*?\}/g);
    let parsed: T;
    if (!matches) parsed = JSON.parse(response) as T;
    else {
      let matched: T | undefined;
      for (let i = matches.length - 1; i >= 0; i--) {
        try {
          matched = JSON.parse(matches[i]) as T;
          break;
        } catch {
          continue;
        }
      }
      if (matched === undefined) throw new Error("No valid JSON block found in response.");
      parsed = matched;
    }

    await exportProviderCompletion({
      provider: config?.pi.defaultProvider ?? "unknown",
      model: config?.pi.defaultModel ?? "unknown",
      duration_ms: Math.max(0, Date.now() - startedAt),
      status: "success",
      parse_outcome: "success",
      app_version: OBSERVABILITY_APP_VERSION,
      surface: "cli",
    });
    return parsed;
  } catch (error) {
    await exportProviderCompletion({
      provider: config?.pi.defaultProvider ?? "unknown",
      model: config?.pi.defaultModel ?? "unknown",
      duration_ms: Math.max(0, Date.now() - startedAt),
      status: "error",
      parse_outcome: "invalid",
      error_category: "parse",
      app_version: OBSERVABILITY_APP_VERSION,
      surface: "cli",
    });
    throw new Error(`Failed to parse agent JSON response: ${response}\nError: ${error}`);
  }
}
