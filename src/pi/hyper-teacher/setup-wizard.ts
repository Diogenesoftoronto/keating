import { MODEL_CHOICES } from "../../../packages/runtime-config/src/index.js";
import { relative } from "node:path";
import { DEFAULT_PI_PROVIDER, type KeatingConfig, configPath, loadKeatingConfig, writeKeatingConfig } from "../../core/config.js";
import { envWithProviderAliases, providerIsConfigured } from "../../core/provider-auth.js";
import type { SetupChoice } from "../../runtime/setup-choice.js";
import { info } from "./ui-helpers.js";

const SETUP_PROVIDERS: SetupChoice[] = [
  { label: "OpenRouter (free)", value: "openrouter", hint: "Free models, no credit card required" },
  { label: "Zyphra Cloud", value: "zyphra", hint: "ZAYA1-8B reasoning model" },
  { label: "Google", value: "google", hint: "Gemini models" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Custom", value: "custom", hint: "Type a provider name" }
];

const SETUP_MODELS_BY_PROVIDER: Record<string, SetupChoice[]> = MODEL_CHOICES.piSetup;

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
