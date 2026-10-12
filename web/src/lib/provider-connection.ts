import { NOTORGANIC_PROVIDER_ID } from "../notorganic-provider";

export interface ProviderConnectionReaders {
  hostedSession: () => Promise<unknown | null>;
  apiKey: (provider: string) => Promise<string | null | undefined>;
  oauth: (provider: string) => Promise<unknown | null>;
}

/** Read credential availability, never infer hosted access from wallet balance. */
export async function readConnectedProviders(
  providers: readonly string[],
  readers: ProviderConnectionReaders,
): Promise<Set<string>> {
  const connected = new Set<string>();
  await Promise.all(providers.map(async (provider) => {
    try {
      if (provider === NOTORGANIC_PROVIDER_ID) {
        if (await readers.hostedSession()) connected.add(provider);
        return;
      }
      if ((await readers.apiKey(provider))?.trim() || await readers.oauth(provider)) {
        connected.add(provider);
      }
    } catch { /* unavailable or expired credentials are not connected */ }
  }));
  return connected;
}
