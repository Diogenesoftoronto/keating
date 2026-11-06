import { NotOrganicPublicClient, publicClientConfig } from "../notorganic-provider/public-client";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../keating/model-prefs";
import { recordCourseAccountAdoptions } from "../submissions/account-adoption";

export const COURSE_ACCOUNT_CHANGED_EVENT = "keating:course-account-changed";
type AccountClient = Pick<NotOrganicPublicClient, "getSession" | "headersFor" | "config">;

/** Serializes cookie changes and checks the device login after every asynchronous boundary. */
export class CourseAccountBridge {
  private identity: string | null | undefined;
  private expiresAt = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly client: () => AccountClient | null, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private current(): string | null {
    const session = this.client()?.getSession();
    return session ? session.id ?? session.refreshToken ?? session.accessToken : null;
  }
  ensure(): Promise<void> {
    const run = () => this.refresh();
    const next = this.tail.catch(() => {}).then(() => typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("keating-course-account", run) : run());
    this.tail = next;
    return next;
  }
  private async clear(): Promise<void> {
    const response = await this.fetcher("/api/courses/account-session", { method: "DELETE", credentials: "same-origin", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Could not clear the previous course account.");
    const changed = this.identity !== null;
    this.identity = null;
    this.expiresAt = 0;
    if (changed && typeof window !== "undefined") window.dispatchEvent(new Event(COURSE_ACCOUNT_CHANGED_EVENT));
  }
  private async refresh(): Promise<void> {
    const identity = this.current();
    if (identity === this.identity && (!identity || this.expiresAt > Date.now() + 15_000)) return;
    if (!identity) { await this.clear(); return; }
    const client = this.client()!;
    const headers = await client.headersFor("GET", `${client.config.issuer}/v1/account`);
    if (identity !== this.current()) throw new Error("Course account changed during verification.");
    const response = await this.fetcher("/api/courses/account-session", {
      method: "POST", headers, credentials: "same-origin", signal: AbortSignal.timeout(20_000),
    });
    if (identity !== this.current()) {
      await this.clear();
      throw new Error("Course account changed during verification.");
    }
    if (!response.ok) throw new Error("Your Not Organic course account could not be connected. Please retry.");
    const body = await response.json() as { account?: { id?: unknown }; expiresAt?: unknown; adoptedLocalAccountIds?: unknown };
    if (identity !== this.current()) { await this.clear(); throw new Error("Course account changed during verification."); }
    if (typeof body.account?.id !== "string" || typeof body.expiresAt !== "number" || body.expiresAt <= Date.now()) {
      throw new Error("The course server returned an invalid account session.");
    }
    await recordCourseAccountAdoptions(body.adoptedLocalAccountIds, body.account.id);
    if (identity !== this.current()) { await this.clear(); throw new Error("Course account changed during verification."); }
    const changed = this.identity !== identity;
    this.identity = identity;
    this.expiresAt = body.expiresAt;
    if (changed && typeof window !== "undefined") window.dispatchEvent(new Event(COURSE_ACCOUNT_CHANGED_EVENT));
  }
}

const bridge = new CourseAccountBridge(() => {
  const config = publicClientConfig();
  return config ? new NotOrganicPublicClient(config) : null;
});
export function ensureCourseAccountSession(): Promise<void> { return bridge.ensure(); }

/** App-level renewal also covers protected images and cookie-authenticated WebSockets. */
export function startBrowserCourseAccountSession(): () => void {
  let stopped = false;
  const refresh = () => { if (!stopped) void bridge.ensure().catch(() => {}); };
  const changed = () => { refresh(); };
  const timer = setInterval(refresh, 30_000);
  window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, changed);
  window.addEventListener("storage", changed);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  refresh();
  return () => {
    stopped = true; clearInterval(timer);
    window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, changed);
    window.removeEventListener("storage", changed);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("online", refresh);
  };
}
