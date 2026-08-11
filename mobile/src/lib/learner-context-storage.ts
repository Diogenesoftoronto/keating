import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeLearnerContext } from "./learner-context";

const LEARNER_CONTEXT_STORAGE_KEY = "keating.mobile.learner-context";

export async function loadLearnerContext(): Promise<string> {
  try {
    return normalizeLearnerContext(await AsyncStorage.getItem(LEARNER_CONTEXT_STORAGE_KEY));
  } catch (error) {
    console.warn("Failed to load learner context:", error);
    return "";
  }
}

export async function saveLearnerContext(context: string): Promise<void> {
  const normalized = normalizeLearnerContext(context);
  if (!normalized) {
    await AsyncStorage.removeItem(LEARNER_CONTEXT_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(LEARNER_CONTEXT_STORAGE_KEY, normalized);
}
