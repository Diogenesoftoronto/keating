import { OPEN_TUI_TOOL_POLICY, type RuntimeToolPolicy } from "../runtime/tool-policy.js";

export interface TuiRuntimeSettings {
  model: string;
  thinking: string;
  autoRetry: boolean;
  autoCompaction: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  availableModels: number;
  openUiReceiver: boolean;
  toolPolicy: RuntimeToolPolicy;
  codeAugmentation: "handoff-required";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function queueMode(value: unknown): "all" | "one-at-a-time" {
  return value === "one-at-a-time" ? "one-at-a-time" : "all";
}

export function tuiRuntimeSettings(
  rawState: unknown,
  availableModels: number,
  commandNames: readonly string[],
): TuiRuntimeSettings {
  const state = record(rawState);
  const model = record(state.model);
  const modelLabel = [model.provider, model.id].filter((value): value is string => typeof value === "string" && value.length > 0).join("/");
  return {
    model: modelLabel || "model unavailable",
    thinking: typeof state.thinkingLevel === "string" ? state.thinkingLevel : "off",
    autoRetry: state.autoRetryEnabled === true,
    autoCompaction: state.autoCompactionEnabled !== false,
    steeringMode: queueMode(state.steeringMode),
    followUpMode: queueMode(state.followUpMode),
    availableModels: Math.max(0, Math.floor(availableModels)),
    openUiReceiver: commandNames.includes("keating-ui-action-v1"),
    toolPolicy: OPEN_TUI_TOOL_POLICY,
    codeAugmentation: "handoff-required",
  };
}

export function tuiSettingsMarkdown(settings: TuiRuntimeSettings): string {
  return [
    "## Terminal settings",
    "",
    `- Model: **${settings.model}** (${settings.availableModels} configured model${settings.availableModels === 1 ? "" : "s"})`,
    `- Thinking: **${settings.thinking}**`,
    `- Automatic retry: **${settings.autoRetry ? "on" : "off"}**`,
    `- Automatic compaction: **${settings.autoCompaction ? "on" : "off"}**`,
    `- Steering queue: **${settings.steeringMode}**`,
    `- Follow-up queue: **${settings.followUpMode}**`,
    `- Canonical OpenUI receiver: **${settings.openUiReceiver ? "available" : "unavailable"}**`,
    `- Agent tools: **${settings.toolPolicy.tools.join(", ")}**`,
    "",
    "### Capability boundary",
    "",
    `Read/search: **${settings.toolPolicy.read ? "available" : "unavailable"}** · command execution: **${settings.toolPolicy.execute ? "available" : "unavailable"}** · source mutation: **${settings.toolPolicy.sourceMutation ? "available" : "unavailable"}**.`,
    "OpenTUI does not advertise execution or source-mutation tools because this host has no proposed-diff, confirmation, validation, and rollback surface. Use `/shell` for an exact-session capable-surface handoff; OpenTUI will not claim it changed its own code.",
    "",
    "### Data and privacy",
    "",
    "Sessions remain in Pi's project session directory. Keating artifacts, learner history, terminal review schedules, and action receipts remain under this project's `.keating/` directory unless an explicit export or hosted action says otherwise.",
  ].join("\n");
}

export const TUI_SETTINGS_ACTIONS = [
  "Select model",
  "Cycle thinking",
  "Toggle automatic retry",
  "Toggle automatic compaction",
  "Toggle steering queue mode",
  "Toggle follow-up queue mode",
  "Prepare /shell provider or code handoff",
  "Close settings",
] as const;
