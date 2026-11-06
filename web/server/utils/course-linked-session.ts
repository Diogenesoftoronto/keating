import { createError, getCookie, getHeader, type H3Event } from "h3";
import type { Storage } from "unstorage";

export const COURSE_ACCOUNT_COOKIE = "keating_course_session";
export const COURSE_ACCOUNT_TTL_MS = 60_000;
const TOKEN = /^[0-9a-f]{64}$/;
type SessionRecord = { accountId: string; expiresAt: number };
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function unauthorized(message = "Sign in again to continue with your course account."): never {
  throw createError({ statusCode: 401, statusMessage: message });
}
async function sessionKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `identity:session:${Buffer.from(digest).toString("hex")}`;
}

/** Opaque sessions carry no provider credentials, and expire independently of cookies. */
export class CourseAccountSessions {
  constructor(private readonly store?: SessionStorage, private readonly now = Date.now) {}
  private async storage(): Promise<SessionStorage> { return this.store ?? (await import("nitro/storage")).useStorage("keating:courses"); }
  async issue(accountId: string, prior?: string): Promise<SessionRecord & { token: string }> {
    const store = await this.storage();
    let token = TOKEN.test(prior ?? "") ? prior! : "";
    if (token) {
      const previous = await store.getItem<SessionRecord>(await sessionKey(token));
      if (previous?.accountId !== accountId) {
        await this.revoke(token);
        token = "";
      }
    }
    token ||= Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const record = { accountId, expiresAt: this.now() + COURSE_ACCOUNT_TTL_MS };
    await store.setItem(await sessionKey(token), record);
    return { ...record, token };
  }
  async read(token: string): Promise<SessionRecord> {
    if (!TOKEN.test(token)) unauthorized();
    const store = await this.storage();
    const key = await sessionKey(token);
    const record = await store.getItem<SessionRecord>(key);
    if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= this.now()) {
      await store.removeItem(key);
      unauthorized();
    }
    return record;
  }
  async revoke(token: string): Promise<void> {
    const store = await this.storage();
    if (TOKEN.test(token)) await store.removeItem(await sessionKey(token));
  }
}

export function courseAccountToken(event: H3Event): string | undefined {
  return getHeader(event, "x-keating-course-session") ?? getCookie(event, COURSE_ACCOUNT_COOKIE);
}

