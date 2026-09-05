import type { DevicePublicJwk } from "../../../modules/keating-device-key/src";
import { NOTORGANIC_DEVICE_KEY_ALIAS } from "./contracts";
import { base64UrlFromText, randomBase64Url, sha256Base64Url } from "./crypto";

export interface DeviceKeyAdapter {
  getOrCreatePublicJwkAsync(alias: string): Promise<DevicePublicJwk>;
  signAsync(alias: string, payload: string): Promise<string>;
  deleteKeyAsync(alias: string): Promise<void>;
}

function nativeDeviceKey(): DeviceKeyAdapter {
  return require("../../../modules/keating-device-key/src") as DeviceKeyAdapter;
}

let adapter: DeviceKeyAdapter | null = null;
const key = () => adapter ?? nativeDeviceKey();

export function setDeviceKeyAdapterForTests(next: DeviceKeyAdapter | null): void {
  adapter = next;
}

export const getDevicePublicJwk = () => key().getOrCreatePublicJwkAsync(NOTORGANIC_DEVICE_KEY_ALIAS);
export const deleteDeviceKey = () => key().deleteKeyAsync(NOTORGANIC_DEVICE_KEY_ALIAS);

export async function createDpopProof(input: { url: string; method: string; boundToken?: string; now?: number; jti?: string }): Promise<string> {
  const publicJwk = await getDevicePublicJwk();
  const header = base64UrlFromText(JSON.stringify({ alg: "ES256", typ: "dpop+jwt", jwk: publicJwk }));
  const payload = base64UrlFromText(JSON.stringify({
    htm: input.method.toUpperCase(),
    htu: input.url,
    iat: Math.floor((input.now ?? Date.now()) / 1_000),
    jti: input.jti ?? await randomBase64Url(18),
    ...(input.boundToken ? { ath: await sha256Base64Url(input.boundToken) } : {}),
  }));
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${await key().signAsync(NOTORGANIC_DEVICE_KEY_ALIAS, signingInput)}`;
}
