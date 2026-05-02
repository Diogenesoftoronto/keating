import { spawnSync } from "node:child_process";
import { loadKeatingConfig, mergePiDefaults } from "./config.js";
import { configDir } from "./paths.js";
import { detectAiRuntime } from "../runtime/pi.js";

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
  const config = await loadKeatingConfig(cwd);
  const runtime = await detectAiRuntime(cwd);

  if (!runtime.selected) {
    throw new Error(
      "No AI runtime found. Install `pi` or configure an embedded agent (e.g. chrysalis-forge)."
    );
  }

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

  let result;
  try {
    const isBinary = runtime.selected.kind === "binary";
    const command = runtime.selected.command;
    const spawnArgs = isBinary ? finalArgs : [runtime.selected.cliPath!, ...finalArgs];

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

  if (result.status !== 0) {
    const errMsg = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
    throw new Error(`Agent completion failed (exit ${result.status}): ${errMsg}`);
  }

  return result.stdout.trim();
}

/**
 * Specialized helper for JSON completions.
 */
export async function piCompleteJson<T>(cwd: string, prompt: string, options: PiCompletionOptions = {}): Promise<T> {
  const response = await piComplete(cwd, prompt, { ...options, json: true });
  try {
    // Some models output reasoning BEFORE the JSON block.
    // We try to find all JSON-like blocks and pick the one that parses successfully,
    // prioritizing the last one.
    const matches = response.match(/\{[\s\S]*?\}/g);
    if (!matches) return JSON.parse(response) as T;
    
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(matches[i]) as T;
      } catch {
        continue;
      }
    }
    throw new Error("No valid JSON block found in response.");
  } catch (error) {
    throw new Error(`Failed to parse agent JSON response: ${response}\nError: ${error}`);
  }
}
