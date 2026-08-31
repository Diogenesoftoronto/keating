import type * as ExpoCrypto from "expo-crypto";

export interface AccountCryptoAdapter {
  randomBytes(length: number): Promise<Uint8Array>;
  sha256Base64(value: string): Promise<string>;
}

function nativeCrypto(): typeof ExpoCrypto {
  return require("expo-crypto") as typeof ExpoCrypto;
}

const nativeAdapter: AccountCryptoAdapter = {
  randomBytes: async (length) => nativeCrypto().getRandomBytes(length),
  sha256Base64: (value) => {
    const crypto = nativeCrypto();
    return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value, { encoding: crypto.CryptoEncoding.BASE64 });
  },
};

let adapter: AccountCryptoAdapter = nativeAdapter;

export function setAccountCryptoAdapterForTests(next: AccountCryptoAdapter | null): void {
  adapter = next ?? nativeAdapter;
}

export function base64UrlFromBase64(value: string): string {
  return value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlFromBytes(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    if (index + 1 < bytes.length) output += alphabet[(value >>> 6) & 63];
    if (index + 2 < bytes.length) output += alphabet[value & 63];
  }
  return output;
}

export function base64UrlFromText(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

export async function randomBase64Url(length = 32): Promise<string> {
  return base64UrlFromBytes(await adapter.randomBytes(length));
}

export async function sha256Base64Url(value: string): Promise<string> {
  return base64UrlFromBase64(await adapter.sha256Base64(value));
}
