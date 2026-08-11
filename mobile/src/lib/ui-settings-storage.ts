import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_UI_SETTINGS, type KeatingUiSettings, normalizeUiSettings } from "./ui-settings";

const UI_SETTINGS_STORAGE_KEY = "keating.mobile.ui-settings";

export async function loadUiSettings(): Promise<KeatingUiSettings> {
  try {
    const raw = await AsyncStorage.getItem(UI_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_UI_SETTINGS;
    return normalizeUiSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("Failed to load UI settings:", error);
    return DEFAULT_UI_SETTINGS;
  }
}

export async function saveUiSettings(settings: KeatingUiSettings): Promise<void> {
  await AsyncStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeUiSettings(settings)));
}
