import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_TEACHER_PERSONA, normalizePersona } from "./persona";

const PERSONA_STORAGE_KEY = "keating.mobile.teacher-persona";

export async function loadPersona(): Promise<string> {
  try {
    return normalizePersona(await AsyncStorage.getItem(PERSONA_STORAGE_KEY));
  } catch (error) {
    console.warn("Failed to load teacher persona:", error);
    return DEFAULT_TEACHER_PERSONA;
  }
}

export async function savePersona(text: string): Promise<void> {
  await AsyncStorage.setItem(PERSONA_STORAGE_KEY, normalizePersona(text));
}

export async function resetPersona(): Promise<void> {
  await AsyncStorage.removeItem(PERSONA_STORAGE_KEY);
}
