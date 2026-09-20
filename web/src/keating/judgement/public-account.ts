/** Browser account capabilities go to Not Organic; its TypeSafe key stays server-side. */
import {
  createSystemOneCaller, isSha256Hex,
  type JudgementTier, type JudgementBackendKey,
} from "@keating/learner-contracts";
import {
  NotOrganicPublicClient, publicClientConfig, publicClientMaxCostMicrousd,
  type NotOrganicPublicClientConfig, type NotOrganicProviderSession,
} from "../../notorganic-provider/public-client";

export interface JudgementAccountClient {
  readonly config: Pick<NotOrganicPublicClientConfig, "issuer">;
  getSession(): NotOrganicProviderSession | null;
  request(path: string, init?: RequestInit): Promise<Response>;
}

function defaultClient(): NotOrganicPublicClient | null {
  try {
    const config = publicClientConfig();
    return config ? new NotOrganicPublicClient(config) : null;
  } catch { return null; }
}

function accountSession(client: JudgementAccountClient, now: number): NotOrganicProviderSession | null {
  try {
    const session = client.getSession();
    return session?.accessToken && Number.isFinite(session.expiresAt) && session.expiresAt > now
      ? session : null;
  } catch { return null; }
}

export function judgementAccountStatus(client: JudgementAccountClient | null = defaultClient()): {
  configured: boolean; connected: boolean; judgementAuthorized: boolean;
} {
  const session = client && accountSession(client, Date.now());
  return { configured: client !== null, connected: Boolean(session),
    judgementAuthorized: Boolean(session?.scope.split(/\s+/u).includes("judgement:evaluate")) };
}

/** Called only by an explicit Connect action; constructing a runtime never starts login. */
export async function judgementAuthorizationUrl(returnTo: string): Promise<string> {
  const config = publicClientConfig();
  if (!config) throw new Error("Not Organic account access is not configured.");
  const scope = [...new Set([...config.scope.split(/\s+/u).filter(Boolean), "judgement:evaluate"])].join(" ");
  return new NotOrganicPublicClient({ ...config, scope }).authorizationUrl(returnTo);
}

function accountEndpoint(issuer: string): string | null {
  try {
    const url = new URL(issuer);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
      || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return `${url.origin}/v1/judgement`;
  } catch { return null; }
}

export interface PublicAccountJudgementOptions {
  readonly client?: JudgementAccountClient | null;
  readonly model?: string;
  readonly calibrationSha256?: string | null;
  readonly maxCostMicrousd?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export function createPublicAccountJudgementBackend(options: PublicAccountJudgementOptions = {}): JudgementTier | null {
  const client = options.client === undefined ? defaultClient() : options.client;
  if (!client) return null;
  const endpoint = accountEndpoint(client.config.issuer);
  if (!endpoint) return null;
  let maxCost: number;
  try { maxCost = options.maxCostMicrousd ?? publicClientMaxCostMicrousd(); }
  catch { return null; }
  if (!Number.isSafeInteger(maxCost) || maxCost <= 0) return null;
  const model = options.model ?? "judgement";
  const calibrationSha256 = options.calibrationSha256 && isSha256Hex(options.calibrationSha256)
    && model !== "judgement" && !model.endsWith("-latest") ? options.calibrationSha256 : null;
  const key: JudgementBackendKey = Object.freeze({ backend: "system-one", model, calibrationSha256 });
  const isAvailable = () => accountEndpoint(client.config.issuer) === endpoint
    && Boolean(accountSession(client, (options.now ?? Date.now)())?.scope.split(/\s+/u).includes("judgement:evaluate"));
  return {
    key, isAvailable,
    call: (request, signal) => {
      // One settlement key per logical operation, shared by its HTTP retries.
      const idempotencyKey = `keating-judgement-${crypto.randomUUID()}`;
      return createSystemOneCaller({
        model, requestModel: "judgement", requireResolvedModel: true,
        endpoint, calibrationSha256, sleep: options.sleep,
        fetch: async (url, init) => {
          if (url !== endpoint || init.method !== "POST" || !isAvailable()) {
            return { ok: false, status: 401, json: async () => ({}) };
          }
          const body = JSON.parse(init.body) as { state: unknown; questions: Record<string, { type?: string; criteria?: unknown }> };
          // The gateway accepts text or named text fields. Keep richer state
          // intact as JSON, never omit nested learner evidence.
          if (typeof body.state !== "string" && (Array.isArray(body.state)
            || Object.values(body.state as object).some(value => typeof value !== "string"))) {
            body.state = JSON.stringify(body.state);
          }
          const state = typeof body.state === "string" ? body.state : JSON.stringify(body.state);
          const questions = Object.values(body.questions);
          if (state.length > 96_000 || questions.length > 64 || JSON.stringify(body.questions).length > 96_000
            || questions.some(question => (question.type === "choice" || question.type === "score")
              && Object.keys(question.criteria as object).length > 64)) {
            return { ok: false, status: 422, json: async () => ({}) };
          }
          const response = await client.request("/v1/judgement", {
            method: "POST", body: JSON.stringify(body), signal: init.signal, redirect: "error",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey,
              "x-notorganic-max-cost-microusd": String(maxCost) },
          });
          return { ok: response.ok, status: response.status, json: () => response.json() };
        },
      })(request, signal);
    },
  };
}
