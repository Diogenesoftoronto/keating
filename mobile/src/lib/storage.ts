import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { PersistedAppState, ProviderId } from "./types";

const APP_STATE_KEY = "keating.mobile.state.v1";

function providerKeyName(provider: ProviderId): string {
  return `keating.provider.${provider}.api-key`;
}

export async function loadPersistedState(): Promise<PersistedAppState | null> {
  const raw = await AsyncStorage.getItem(APP_STATE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
  return parsed.schemaVersion === 1 ? parsed as PersistedAppState : null;
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
}

export async function clearPersistedState(): Promise<void> {
  await AsyncStorage.removeItem(APP_STATE_KEY);
}

export async function getProviderKey(provider: ProviderId): Promise<string | null> {
  return SecureStore.getItemAsync(providerKeyName(provider));
}

export async function setProviderKey(provider: ProviderId, apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(providerKeyName(provider), apiKey.trim(), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteProviderKey(provider: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(providerKeyName(provider));
}
