import { relative } from "node:path";
import { DEFAULT_PI_PROVIDER, type KeatingConfig, configPath, loadKeatingConfig, writeKeatingConfig } from "../../core/config.js";
import { envWithProviderAliases, providerIsConfigured } from "../../core/provider-auth.js";
import { info } from "./ui-helpers.js";

interface SetupChoice<T extends string = string> {
  label: string;
  value: T;
  hint?: string;
}

const SETUP_PROVIDERS: SetupChoice[] = [
  { label: "OpenRouter (free)", value: "openrouter", hint: "Free models, no credit card required" },
  { label: "Zyphra Cloud", value: "zyphra", hint: "ZAYA1-8B reasoning model" },
  { label: "Google", value: "google", hint: "Gemini models" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Custom", value: "custom", hint: "Type a provider name" }
];

const SETUP_MODELS_BY_PROVIDER: Record<string, SetupChoice[]> = {
  zyphra: [
    { label: "ZAYA1-8B", value: "zyphra/ZAYA1-8B", hint: "Recommended" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  openrouter: [
    { label: "Poolside Laguna M.1 (free)", value: "poolside/laguna-m.1:free", hint: "Recommended" },
    { label: "Poolside Laguna XS.2 (free)", value: "poolside/laguna-xs.2:free", hint: "Faster/smaller" },
    { label: "OpenAI GPT-OSS 120B (free)", value: "openai/gpt-oss-120b:free" },
    { label: "DeepSeek V4 Flash (free)", value: "deepseek/deepseek-v4-flash:free" },
    { label: "Google Gemma 4 31B (free)", value: "google/gemma-4-31b-it:free" },
    { label: "Nvidia Nemotron 120B (free)", value: "nvidia/nemotron-3-super-120b-a12b:free" },
    { label: "MoonshotAI Kimi K2.6 (free)", value: "moonshotai/kimi-k2.6:free" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  google: [
    { label: "Gemini 3.1 Pro Preview", value: "gemini-3.1-pro-preview", hint: "Recommended" },
    { label: "Gemini 3.5 Flash", value: "gemini-3.5-flash", hint: "Faster" },
    { label: "Gemini 3 Pro Preview", value: "gemini-3-pro-preview" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  openai: [
    { label: "GPT-5.5", value: "gpt-5.5", hint: "Recommended" },
    { label: "GPT-5.5 Pro", value: "gpt-5.5-pro" },
    { label: "GPT-5.4", value: "gpt-5.4" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  anthropic: [
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6", hint: "Recommended" },
    { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
    { label: "Claude Haiku 4.5", value: "claude-haiku-4-5", hint: "Faster" },
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ],
  custom: [
    { label: "Custom", value: "custom", hint: "Type a model name" }
  ]
};

const SETUP_THINKING: SetupChoice[] = [
  { label: "Medium", value: "medium", hint: "Recommended" },
  { label: "Low", value: "low" },
  { label: "High", value: "high" }
];

const SETUP_RUNTIMES: SetupChoice<KeatingConfig["pi"]["runtimePreference"]>[] = [
  { label: "Prefer standalone", value: "prefer-standalone", hint: "Recommended" },
  { label: "Embedded only", value: "embedded-only" },
  { label: "Standalone only", value: "standalone-only" }
];

function choiceDisplay(choice: SetupChoice): string {
  return `${choice.label} (${choice.value})${choice.hint ? ` — ${choice.hint}` : ""}`;
}

async function selectSetupChoice<T extends string>(
  ctx: any,
  title: string,
  choices: SetupChoice<T>[],
  current?: string
): Promise<T | undefined> {
  const keep = current ? `Keep current (${current})` : undefined;
  const labels = [...(keep ? [keep] : []), ...choices.map(choiceDisplay)];
  const selected = await ctx.ui.select(title, labels);
  if (!selected) return undefined;
  if (keep && selected === keep) return current as T;
  const index = labels.indexOf(selected) - (keep ? 1 : 0);
  return choices[index]?.value;
}

async function inputSetupValue(ctx: any, title: string, fallback: string): Promise<string | undefined> {
  const value = await ctx.ui.input(title, fallback);
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

export async function runKeatingSetupInTui(ctx: any): Promise<void> {
  if (
    typeof ctx.ui?.select !== "function" ||
    typeof ctx.ui?.input !== "function" ||
    typeof ctx.ui?.confirm !== "function"
  ) {
    ctx.ui.setEditorText?.("Run `keating setup` outside the shell, or use `/login <provider>` here to add credentials.");
    info(ctx, "This shell does not expose setup dialogs.");
    return;
  }

  const current = await loadKeatingConfig(ctx.cwd);
  const providerChoice = await selectSetupChoice(ctx, "Keating setup: choose default provider", SETUP_PROVIDERS, current.pi.defaultProvider ?? DEFAULT_PI_PROVIDER);
  if (!providerChoice) {
    info(ctx, "Setup cancelled.");
    return;
  }

  const defaultProvider = providerChoice === "custom"
    ? await inputSetupValue(ctx, "Keating setup: custom provider", current.pi.defaultProvider ?? DEFAULT_PI_PROVIDER)
    : providerChoice;
  if (!defaultProvider) {
    info(ctx, "Setup cancelled.");
    return;
  }

  const models = SETUP_MODELS_BY_PROVIDER[defaultProvider] ?? SETUP_MODELS_BY_PROVIDER.custom;
  const modelChoice = await selectSetupChoice(ctx, "Keating setup: choose default model", models, current.pi.defaultModel ?? models[0]?.value);
  if (!modelChoice) {
    info(ctx, "Setup cancelled.");
    return;
  }

  const defaultModel = modelChoice === "custom"
    ? await inputSetupValue(ctx, "Keating setup: custom model", current.pi.defaultModel ?? "model-name")
    : modelChoice;
  if (!defaultModel) {
    info(ctx, "Setup cancelled.");
    return;
  }

  const defaultThinking = await selectSetupChoice(ctx, "Keating setup: choose thinking effort", SETUP_THINKING, current.pi.defaultThinking ?? "medium");
  if (!defaultThinking) {
    info(ctx, "Setup cancelled.");
    return;
  }

  const runtimePreference = await selectSetupChoice(ctx, "Keating setup: choose runtime", SETUP_RUNTIMES, current.pi.runtimePreference);
  if (!runtimePreference) {
    info(ctx, "Setup cancelled.");
    return;
  }

  const summary = [
    `Provider: ${defaultProvider}`,
    `Model: ${defaultModel}`,
    `Thinking: ${defaultThinking}`,
    `Runtime: ${runtimePreference}`,
    "",
    `Write ${configPath(ctx.cwd)}?`
  ].join("\n");
  const confirmed = await ctx.ui.confirm("Confirm Keating setup", summary);
  if (!confirmed) {
    info(ctx, "Setup cancelled.");
    return;
  }

  await writeKeatingConfig(ctx.cwd, {
    ...current,
    pi: {
      ...current.pi,
      defaultProvider,
      defaultModel,
      defaultThinking,
      runtimePreference
    }
  });

  const relativeConfig = relative(ctx.cwd, configPath(ctx.cwd));
  ctx.ui.setEditorText?.([
    `Keating setup saved to ${relativeConfig}.`,
    "",
    `Provider: ${defaultProvider}`,
    `Model: ${defaultModel}`,
    `Thinking: ${defaultThinking}`,
    `Runtime: ${runtimePreference}`
  ].join("\n"));

  if (!providerIsConfigured(ctx.cwd, envWithProviderAliases(process.env), defaultProvider)) {
    ctx.ui.setEditorText?.(`/login ${defaultProvider}`);
    info(ctx, `Saved setup. No ${defaultProvider} credentials found; press Enter to run /login ${defaultProvider}.`);
  } else {
    info(ctx, `Saved setup to ${relativeConfig}.`);
  }
}
