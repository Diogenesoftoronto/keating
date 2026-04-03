import { spawnSync } from "node:child_process";
import { loadKeatingConfig, mergePiDefaults } from "./config.js";

export interface PiCompletionOptions {
  systemPrompt?: string;
  json?: boolean;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

/**
 * Programmatic interface to the Pi agent via CLI.
 * This ensures we use the same provider, model, and thinking settings as the user's Pi install.
 */
export async function piComplete(cwd: string, prompt: string, options: PiCompletionOptions = {}): Promise<string> {
  const config = await loadKeatingConfig(cwd);
  
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
  
  const result = spawnSync("pi", finalArgs, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PI_SKIP_VERSION_CHECK: "1"
    }
  });

  if (result.status !== 0) {
    throw new Error(`Pi completion failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

/**
 * Specialized helper for JSON completions.
 */
export async function piCompleteJson<T>(cwd: string, prompt: string, options: PiCompletionOptions = {}): Promise<T> {
  const response = await piComplete(cwd, prompt, { ...options, json: true });
  try {
    // Pi in JSON mode might return the raw JSON or a markdown block depending on the provider.
    // We try to extract it.
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : response;
    return JSON.parse(cleanJson) as T;
  } catch (error) {
    throw new Error(`Failed to parse Pi JSON response: ${response}\nError: ${error}`);
  }
}
