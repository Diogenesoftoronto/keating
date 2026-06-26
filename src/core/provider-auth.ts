import { readFileSync } from "node:fs";
import { join } from "node:path";

import { configDir } from "./paths.js";

export const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  zyphra: ["ZYPHRA_API_KEY"]
};

export const PROVIDER_SETUP_HINTS: Record<string, string[]> = {
  google: [
    "export GEMINI_API_KEY=your_google_ai_studio_key",
    "or run `/login google` inside the Keating shell"
  ],
  openai: [
    "export OPENAI_API_KEY=your_openai_key",
    "or run `/login openai` inside the Keating shell"
  ],
  anthropic: [
    "export ANTHROPIC_API_KEY=your_anthropic_key",
    "or run `/login anthropic` inside the Keating shell"
  ],
  openrouter: [
    "export OPENROUTER_API_KEY=your_openrouter_key",
    "get a free key at https://openrouter.ai (free models available, no credit card required)",
    "or run `/login openrouter` inside the Keating shell"
  ],
  zyphra: [
    "export ZYPHRA_API_KEY=your_zyphra_key",
    "get a key at https://cloud.zyphra.com",
    "or run `/login zyphra` inside the Keating shell"
  ]
};

export function envWithProviderAliases(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.GEMINI_API_KEY && env.GOOGLE_API_KEY) {
    return { ...env, GEMINI_API_KEY: env.GOOGLE_API_KEY };
  }
  return { ...env };
}

export function authJsonHasProvider(cwd: string, provider: string): boolean {
  const path = join(configDir(cwd), "auth.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return Boolean(parsed?.[provider]);
  } catch {
    return false;
  }
}

export function envHasProvider(env: NodeJS.ProcessEnv, provider: string): boolean {
  return (PROVIDER_ENV_KEYS[provider] ?? []).some((key) => Boolean(env[key]));
}

export function providerIsConfigured(cwd: string, env: NodeJS.ProcessEnv, provider: string): boolean {
  return envHasProvider(env, provider) || authJsonHasProvider(cwd, provider);
}

export function providerAuthHints(provider: string): string[] {
  return PROVIDER_SETUP_HINTS[provider] ?? [
    `set the API key expected by provider "${provider}"`,
    `or run \`/login ${provider}\` inside the Keating shell`
  ];
}

export function providerSetupMessage(provider: string): string {
  return [
    `No credentials found for provider "${provider}".`,
    "",
    "Recover with:",
    ...providerAuthHints(provider).map((hint) => `  ${hint}`),
    "  /setup   # change Keating provider/model defaults inside this TUI",
    "",
    "The Keating shell can still open so you can configure credentials without leaving the TUI."
  ].join("\n");
}

