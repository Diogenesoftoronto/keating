/** CLI account capability transport. Credentials never leave the configured issuer. */
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import {
  createNotOrganicDpopProof,
  notOrganicAuthPath,
  NOTORGANIC_AUTH_ENV,
  NOTORGANIC_DEFAULT_MAX_COST_MICROUSD,
  NOTORGANIC_PROVIDER_ID,
  parseNotOrganicPrivateJwk,
  resolveNotOrganicIssuer,
} from "../core/notorganic-auth.js";
import type { FetchLike } from "../../packages/learner-contracts/src/judgement/system-one.js";

export const NOTORGANIC_JUDGEMENT_SCOPE = "judgement:evaluate";
export const NOTORGANIC_JUDGEMENT_MODEL = "judgement";
/** Account gateway ceilings, which are stricter than the direct provider. */
export const NOTORGANIC_JUDGEMENT_MAX_CRITERIA = 64;

function normalizeGatewayBody(body: string): string | null {
  try {
    const payload = JSON.parse(body) as { state: unknown; questions: Record<string, unknown> };
    if (!payload || typeof payload !== "object" || !payload.questions
      || typeof payload.questions !== "object" || Array.isArray(payload.questions)) return null;
    const state = payload.state;
    if (typeof state !== "string") {
      if (!state || typeof state !== "object") return null;
      if (Array.isArray(state) || Object.values(state).some((value) => typeof value !== "string")) {
        payload.state = JSON.stringify(state);
      }
    }
    const stateText = typeof payload.state === "string" ? payload.state : JSON.stringify(payload.state);
    if (stateText.length > 96_000 || JSON.stringify(payload.questions).length > 96_000) return null;
    for (const raw of Object.values(payload.questions)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const question = raw as { type?: string; criteria?: unknown };
      if (question.type !== "choice" && question.type !== "score") continue;
      const options = question.type === "score" && Array.isArray(question.criteria)
        ? question.criteria
        : question.type === "choice" && question.criteria && typeof question.criteria === "object" && !Array.isArray(question.criteria)
          ? Object.keys(question.criteria) : [];
      if (options.length < 2 || options.length > NOTORGANIC_JUDGEMENT_MAX_CRITERIA
        || options.some((option) => typeof option !== "string" || !option.trim())
        || new Set(options).size !== options.length) return null;
    }
    return JSON.stringify(payload);
  } catch { return null; }
}

export interface NotOrganicJudgementCredential {
  readonly accessToken: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function loadNotOrganicJudgementCredential(cwd: string): NotOrganicJudgementCredential | null {
  const credential = AuthStorage.create(notOrganicAuthPath(cwd)).get(NOTORGANIC_PROVIDER_ID);
  if (credential?.type !== "api_key" || !credential.key) return null;
  return { accessToken: credential.key, env: credential.env ?? {} };
}

/** Fail closed before signing; an inference capability is not a judgement capability. */
export function notOrganicJudgementEndpoint(
  credential: NotOrganicJudgementCredential,
  now = Date.now(),
): string | null {
  const env = credential.env;
  if (!credential.accessToken || env[NOTORGANIC_AUTH_ENV.tokenType] !== "DPoP") return null;
  if (!env[NOTORGANIC_AUTH_ENV.scope]?.split(/\s+/u).includes(NOTORGANIC_JUDGEMENT_SCOPE)) return null;
  const expiresAt = Number(env[NOTORGANIC_AUTH_ENV.expiresAt]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const maxCost = Number(env[NOTORGANIC_AUTH_ENV.maxCostMicrousd] ?? NOTORGANIC_DEFAULT_MAX_COST_MICROUSD);
  if (!Number.isSafeInteger(maxCost) || maxCost <= 0) return null;
  try {
    parseNotOrganicPrivateJwk(env[NOTORGANIC_AUTH_ENV.privateJwk] ?? "");
    return `${resolveNotOrganicIssuer(env[NOTORGANIC_AUTH_ENV.issuer])}/v1/judgement`;
  } catch {
    return null;
  }
}

/** A fresh DPoP proof per retry, with one settlement key per logical request. */
export function createNotOrganicJudgementFetch(input: {
  credential: NotOrganicJudgementCredential;
  endpoint: string;
  fetch: FetchLike;
  idempotencyKey: string;
  now?: () => number;
}): FetchLike {
  return async (url, init) => {
    const body = normalizeGatewayBody(init.body);
    if (body === null) return { ok: false, status: 422, json: async () => ({}) };
    const now = input.now ?? Date.now;
    if (url !== input.endpoint || init.method !== "POST"
      || notOrganicJudgementEndpoint(input.credential, now()) !== input.endpoint) {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    const env = input.credential.env;
    let dpop: string;
    try {
      dpop = await createNotOrganicDpopProof({
        privateJwk: env[NOTORGANIC_AUTH_ENV.privateJwk]!,
        accessToken: input.credential.accessToken,
        method: "POST",
        url,
        now,
      });
    } catch {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return input.fetch(url, {
      ...init,
      body,
      headers: {
        "content-type": "application/json",
        authorization: `DPoP ${input.credential.accessToken}`,
        dpop,
        "idempotency-key": input.idempotencyKey,
        "x-notorganic-max-cost-microusd": String(env[NOTORGANIC_AUTH_ENV.maxCostMicrousd]
          ?? NOTORGANIC_DEFAULT_MAX_COST_MICROUSD),
      },
    });
  };
}
