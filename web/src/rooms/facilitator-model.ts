/**
 * Which model this browser would run Keating with in a study room: the same
 * default chat model the learner chose for Chat, falling back to the most
 * recent one, then to a connected provider.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { getRecentModels, loadModelPrefs } from "../keating/model-prefs";
import { DEFAULT_TEACHER_PERSONA, loadPersona } from "../keating/persona";
import { modelKey } from "../lib/model-catalog";
import { getSelectableModels, resolveAvailableChatModel } from "../lib/provider-models";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";

export interface FacilitatorModelDependencies {
  loadPrefs: typeof loadModelPrefs;
  recent: typeof getRecentModels;
  selectable: typeof getSelectableModels;
  resolveAvailable: typeof resolveAvailableChatModel;
}

export async function resolveFacilitatorModel(overrides: Partial<FacilitatorModelDependencies> = {}): Promise<Model<Api>> {
  const dependencies = { loadPrefs: loadModelPrefs, recent: getRecentModels, selectable: getSelectableModels, resolveAvailable: resolveAvailableChatModel, ...overrides };
  const prefs = dependencies.loadPrefs();
  const key = prefs.defaultChatModelKey ?? dependencies.recent()[0]?.key;
  if (key) {
    const models =
      key === modelKey(NOTORGANIC_DEFAULT_MODEL) ? [NOTORGANIC_DEFAULT_MODEL] : await dependencies.selectable();
    const saved = models.find((model) => modelKey(model) === key);
    if (saved) return saved;
    throw new Error("The model selected in Chat is unavailable. Choose or connect a model in Chat, then try again.");
  }
  return dependencies.resolveAvailable(NOTORGANIC_DEFAULT_MODEL, { allowFallback: true });
}

export function facilitatorModelLabel(model: Pick<Model<Api>, "id" | "name">): string {
  return (model.name || model.id).slice(0, 160);
}

/** The learner's editable teacher persona carries into group sessions. */
export function facilitatorPersona(): string {
  try {
    return loadPersona();
  } catch {
    return DEFAULT_TEACHER_PERSONA;
  }
}
