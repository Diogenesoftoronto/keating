export const NOTORGANIC_MOBILE_CLIENT_ID = "https://keating.help/mobile";
export const NOTORGANIC_MOBILE_REDIRECT_URI = "keating:///notorganic/callback";
export const NOTORGANIC_MOBILE_SCOPE = [
  "infer:balanced",
  "realtime:connect",
  "sync:key:read",
  "usage:read",
  "wallet:read",
  "evolution:read",
  "evolution:write",
  "evolution:execute",
].join(" ");
export const NOTORGANIC_DEVICE_KEY_ALIAS = "keating.notorganic.dpop.v1";

export interface NotOrganicAccountConfig {
  issuer: string;
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface PendingAuthorization {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}

export interface NotOrganicTokenResponse {
  access_token: string;
  token_type: "DPoP";
  expires_in: number;
  scope: string;
  refresh_token: string;
  refresh_expires_in: number;
}

export interface NotOrganicDeviceSession {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  scope: string;
  accountId?: string;
}

export interface NotOrganicAccountSnapshot {
  id?: string;
  did?: string;
  handle?: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface NotOrganicAccountResponse {
  account: NotOrganicAccountSnapshot | null;
  products: unknown[];
  subscriptions: unknown[];
}

export const defaultNotOrganicAccountConfig = (): NotOrganicAccountConfig => ({
  issuer: (process.env.EXPO_PUBLIC_NOTORGANIC_ISSUER ?? "https://api.notorganic.info").replace(/\/$/, ""),
  authorizationUrl: process.env.EXPO_PUBLIC_NOTORGANIC_AUTHORIZATION_URL ?? "https://id.notorganic.info/authorize",
  clientId: NOTORGANIC_MOBILE_CLIENT_ID,
  redirectUri: NOTORGANIC_MOBILE_REDIRECT_URI,
  scope: NOTORGANIC_MOBILE_SCOPE,
});
