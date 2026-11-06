import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ACCOUNT_SYNC_SCOPE, accountSyncAuthPath, createAccountSyncRequester, loadAccountSyncCredential, loginAccountSync, writeAccountSyncJson } from "../src/core/account-sync-auth.js";

const did = "did:plc:sync-test-account";
const tokens = (suffix = "a") => ({ access_token: `access-token-for-testing-${suffix}`, refresh_token: `refresh-token-for-testing-${suffix}`, token_type: "DPoP", scope: ACCOUNT_SYNC_SCOPE, expires_in: 300, refresh_expires_in: 86400 });
const claims = (proof: string) => JSON.parse(Buffer.from(proof.split(".")[1]!, "base64url").toString());

async function loginFixture(cwd: string, fetcher: typeof fetch) {
  let authorization: URL;
  return loginAccountSync(cwd, { onAuth: info => { authorization = new URL(info.url); } }, {
    fetch: fetcher, issuer: "https://provider.example", authorizationUrl: "https://identity.example/authorize",
    callbackListenerFactory: async ({ state }) => ({ clientId: "http://127.0.0.1:4242", redirectUri: "http://127.0.0.1:4242/callback", close: async () => {}, wait: async () => {
      expect(authorization.searchParams.get("scope")).toBe(ACCOUNT_SYNC_SCOPE);
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      return `http://127.0.0.1:4242/callback?code=approved-test-code&state=${state}`;
    } }),
  });
}

describe("separate terminal account sync authorization", () => {
  test("requests a refreshable sync-only grant, verifies authoritative DID, and preserves inference credentials", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-sync-auth-"));
    try {
      await mkdir(join(cwd, ".keating/pi-config"), { recursive: true });
      const inference = join(cwd, ".keating/pi-config/auth.json");
      await writeFile(inference, "existing-inference-credential");
      const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/v1/public/token")) {
          const body = JSON.parse(init!.body as string);
          expect(body.device_session).toBe(true); expect(body.dpop_jwk.d).toBeUndefined(); expect(body.code_verifier.length).toBe(43);
          return Response.json(tokens());
        }
        expect(String(url)).toBe("https://provider.example/v1/account");
        const headers = new Headers(init!.headers);
        expect(headers.get("Authorization")).toBe(`DPoP ${tokens().access_token}`);
        expect(claims(headers.get("DPoP")!).htu).toBe(String(url));
        return Response.json({ account: { did } });
      };
      expect(await loginFixture(cwd, fetcher as typeof fetch)).toMatchObject({ did });
      expect((await loadAccountSyncCredential(cwd))!.did).toBe(did);
      expect((await stat(accountSyncAuthPath(cwd))).mode & 0o777).toBe(0o600);
      expect(await readFile(inference, "utf8")).toBe("existing-inference-credential");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  test("rejects broader grants without persisting them", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-sync-auth-"));
    try {
      await expect(loginFixture(cwd, (async () => Response.json({ ...tokens(), scope: ACCOUNT_SYNC_SCOPE + " infer:balanced" })) as typeof fetch)).rejects.toThrow("broader");
      expect(await loadAccountSyncCredential(cwd)).toBeNull();
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  test("rotates once under concurrent reads and binds DPoP to refresh token and query-free URL", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-sync-auth-"));
    try {
      await loginFixture(cwd, (async url => String(url).endsWith("/token") ? Response.json(tokens()) : Response.json({ account: { did } })) as typeof fetch);
      const credential = (await loadAccountSyncCredential(cwd))!;
      await writeAccountSyncJson(accountSyncAuthPath(cwd), { ...credential, expiresAt: 0 });
      let rotations = 0;
      const requester = await createAccountSyncRequester(cwd, { fetch: (async (url, init) => {
        const proof = claims(new Headers(init?.headers).get("DPoP")!);
        if (String(url).endsWith("/device/token")) {
          rotations++; expect(proof.htm).toBe("POST"); expect(proof.ath).toBe(createHash("sha256").update(tokens().refresh_token).digest("base64url"));
          return Response.json(tokens("rotated"));
        }
        if (String(url).endsWith("/account")) return Response.json({ account: { did } });
        expect(proof.htu).toBe("https://provider.example/v1/sync/records");
        return Response.json({ records: [], cursor: "2", has_more: false });
      }) as typeof fetch });
      await Promise.all([requester.request("/v1/sync/records?after=2"), requester.request("/v1/sync/records?after=2")]);
      expect(rotations).toBe(1);
      expect((await loadAccountSyncCredential(cwd))!.refreshToken).toBe(tokens("rotated").refresh_token);
      await expect(requester.request("https://attacker.example/v1/account")).rejects.toThrow("path");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
