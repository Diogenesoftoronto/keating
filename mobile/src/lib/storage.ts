import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { stripEphemeralReasoning } from "./durable-agent-events";
import type { PersistedAppState, ProviderId } from "./types";
import { migratePersistedState } from "./persisted-state";

const APP_STATE_KEY = "keating.mobile.state.v1";

export interface PersistedStateSource {
  raw: string;
  state: PersistedAppState;
}

function providerKeyName(provider: ProviderId): string {
  return `keating.provider.${provider}.api-key`;
}

export async function loadPersistedState(): Promise<PersistedAppState | null> {
  return (await loadPersistedStateSource())?.state ?? null;
}

/** Returns the exact source bytes so a resumable SQLite migration can bind its digest. */
export async function loadPersistedStateSource(): Promise<PersistedStateSource | null> {
  const raw = await AsyncStorage.getItem(APP_STATE_KEY);
  if (!raw) return null;
  const migrated = migratePersistedState(JSON.parse(raw));
  if (!migrated) {
    throw new Error("Saved learning data is invalid or from an unsupported version. It was preserved and not overwritten.");
  }
  return { raw, state: stripEphemeralReasoning(migrated) };
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(stripEphemeralReasoning(state)));
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
