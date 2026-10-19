/** Loads the in-browser model before a local generation. */
import { localModel } from "../../stores/local-model";

export async function loadBrowserModel(modelId?: string) {
  const state = localModel.getState();
  if (!state.loaded || (modelId && state.modelId !== modelId)) {
    await localModel.load(modelId);
  }
  if (!localModel.getState().loaded) {
    throw new Error(
      localModel.getState().error ?? "Failed to load browser model",
    );
  }
}
