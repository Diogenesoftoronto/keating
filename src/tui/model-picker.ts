import type { KeatingPiModel } from "../runtime/pty-rpc-client.js";

export interface TuiModelChoice {
  key: string;
  label: string;
  description: string;
  model: KeatingPiModel;
}

export interface TuiModelProviderChoice {
  provider: string;
  label: string;
  description: string;
  count: number;
}

export function modelKey(model: Pick<KeatingPiModel, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

export function modelName(model: KeatingPiModel): string {
  return model.name?.trim() || model.id;
}

export function formatModelContextWindow(contextWindow: number | undefined): string {
  if (!Number.isFinite(contextWindow) || !contextWindow || contextWindow < 1) return "context unknown";
  if (contextWindow >= 1_000_000) return `${(contextWindow / 1_000_000).toFixed(contextWindow % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (contextWindow >= 1_000) return `${Math.round(contextWindow / 1_000)}k ctx`;
  return `${contextWindow} ctx`;
}

function modelCapabilitySummary(model: KeatingPiModel): string {
  const capabilities = [
    formatModelContextWindow(model.contextWindow),
    model.reasoning ? "reasoning" : "fast",
    model.input?.includes("image") ? "vision" : undefined,
  ].filter((value): value is string => Boolean(value));
  return capabilities.join(" · ");
}

/** Build stable, searchable picker rows from Pi's authenticated model catalog. */
export function modelChoices(models: readonly KeatingPiModel[], current?: Pick<KeatingPiModel, "provider" | "id">): TuiModelChoice[] {
  const currentKey = current ? modelKey(current) : "";
  return [...models]
    .filter((model) => Boolean(model.provider && model.id))
    .sort((left, right) => {
      const leftCurrent = modelKey(left) === currentKey ? 0 : 1;
      const rightCurrent = modelKey(right) === currentKey ? 0 : 1;
      return leftCurrent - rightCurrent
        || left.provider.localeCompare(right.provider)
        || modelName(left).localeCompare(modelName(right))
        || left.id.localeCompare(right.id);
    })
    .map((model) => {
      const key = modelKey(model);
      const marker = key === currentKey ? "●" : " ";
      return {
        key,
        label: `${marker} ${modelName(model)}  ·  ${key}`,
        description: modelCapabilitySummary(model),
        model,
      };
    });
}

export function modelPickerTitle(models: readonly KeatingPiModel[]): string {
  const providers = new Set(models.map((model) => model.provider).filter(Boolean));
  return `Models · ${models.length} configured across ${providers.size} provider${providers.size === 1 ? "" : "s"}`;
}

/** Provider rows keep a large catalog navigable before showing individual models. */
export function modelProviderChoices(
  models: readonly KeatingPiModel[],
  currentProvider?: string,
): TuiModelProviderChoice[] {
  const counts = new Map<string, number>();
  for (const model of models) {
    if (!model.provider || !model.id) continue;
    counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => {
      const leftCurrent = left === currentProvider ? 0 : 1;
      const rightCurrent = right === currentProvider ? 0 : 1;
      return leftCurrent - rightCurrent || left.localeCompare(right);
    })
    .map(([provider, count]) => ({
      provider,
      count,
      label: `${provider === currentProvider ? "●" : " "} ${provider}`,
      description: `${count} configured model${count === 1 ? "" : "s"}`,
    }));
}
