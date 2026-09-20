/**
 * The CLI judgement transport.
 *
 * Everything that differs between surfaces lives here: the CLI may hold a
 * credential directly, where the hosted web app must route through a gateway.
 * The rest of the system only ever sees a `JudgementCaller`.
 *
 * Account capabilities use the issuer's exact /v1/judgement route with DPoP.
 * Direct TypeSafe access is explicit opt-in. Custom gateways never receive
 * the TypeSafe key; they must supply their own server-held authorization.
 *
 * Three rules this file exists to keep:
 *
 * - The credential is read from the environment, passed to the caller, and
 *   never returned, logged, or embedded in a diagnostic. Upstream error bodies
 *   can echo a learner's own text, so they are already dropped one layer down
 *   in `createSystemOneCaller`, which returns a stable code instead.
 * - An unconfigured backend is not an error. It yields `null`, the tier is
 *   reported unavailable, and the router escalates or abstains — which is the
 *   documented behaviour, not a degraded one.
 * - A bare `TYPESAFE_API_KEY` without an endpoint and without the explicit
 *   direct opt-in resolves to `null`. A key alone must not silently select a
 *   hosted API the operator never chose.
 */
import {
  type JudgementBackendKey,
  type JudgementCaller,
  isSha256Hex,
} from "../../packages/learner-contracts/src/judgement/contracts.js";
import {
  type FetchLike,
  type SystemOneRetryPolicy,
  createSystemOneCaller,
} from "../../packages/learner-contracts/src/judgement/system-one.js";
import {
  DEFAULT_SYSTEM_ONE_MODEL,
  SYSTEM_ONE_ENDPOINT,
} from "../../packages/learner-contracts/src/judgement/wire.js";
import type { JudgementTier } from "../../packages/learner-contracts/src/judgement/router.js";
import {
  createNotOrganicJudgementFetch,
  loadNotOrganicJudgementCredential,
  notOrganicJudgementEndpoint,
  NOTORGANIC_JUDGEMENT_MODEL,
  type NotOrganicJudgementCredential,
} from "./notorganic.js";

/** Direct credential for the hosted judgement backend. Server-side only. */
export const JUDGEMENT_API_KEY_ENV = "TYPESAFE_API_KEY";
/** Overrides the endpoint, e.g. to point the CLI at the NotOrganic capability route. */
export const JUDGEMENT_ENDPOINT_ENV = "KEATING_JUDGEMENT_ENDPOINT";
/**
 * Explicit opt-in for direct SystemOne access (`"1"` or `"true"`). Without
 * this, a bare `TYPESAFE_API_KEY` does not select the hosted API: direct
 * access is an operator override, and the endpoint route is the default.
 */
export const JUDGEMENT_DIRECT_ENV = "KEATING_JUDGEMENT_DIRECT";
export const JUDGEMENT_MODEL_ENV = "KEATING_JUDGEMENT_MODEL";
/** Pin of the calibration this deployment was fitted with; unset means uncalibrated. */
export const JUDGEMENT_CALIBRATION_ENV = "KEATING_JUDGEMENT_CALIBRATION_SHA256";

export interface CliJudgementOptions {
  /** Defaults to `process.env`. Injected so tests never read the real environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchLike;
  readonly retry?: SystemOneRetryPolicy;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Explicit workspace whose existing account capability may be used. */
  readonly cwd?: string;
  readonly loadCredential?: (cwd: string) => NotOrganicJudgementCredential | null;
  readonly credential?: NotOrganicJudgementCredential;
  readonly now?: () => number;
}

export interface CliJudgementBackend {
  readonly key: JudgementBackendKey;
  readonly call: JudgementCaller;
}

function readEnv(options: CliJudgementOptions): Readonly<Record<string, string | undefined>> {
  return options.env ?? (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function defaultFetch(): FetchLike | null {
  const global = globalThis.fetch;
  if (typeof global !== "function") return null;
  // Adapted explicitly rather than passed through, so only the three fields the
  // caller contract declares are ever read off the response.
  return async (input, init) => {
    // A provider redirect must not forward account proof or direct credentials.
    const response = await global(input, { ...init, redirect: "error" });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  };
}

function isDirectOptIn(value: string | undefined): boolean {
  const text = value?.trim().toLowerCase();
  return text === "1" || text === "true";
}

/**
 * Build the hosted judgement backend from the environment, or `null` when it is
 * not configured. Existing account capabilities require judgement:evaluate;
 * merely possessing an infer:balanced token never authorizes this route.
 */
export function createCliJudgementBackend(
  options: CliJudgementOptions = {},
): CliJudgementBackend | null {
  const env = readEnv(options);
  const apiKey = trimmed(env[JUDGEMENT_API_KEY_ENV]);
  const endpoint = trimmed(env[JUDGEMENT_ENDPOINT_ENV]);
  const fetchImpl = options.fetch ?? defaultFetch();
  if (!fetchImpl) return null;

  let credential = options.credential ?? null;
  try {
    if (!credential && options.cwd) {
      credential = (options.loadCredential ?? loadNotOrganicJudgementCredential)(options.cwd);
    }
  } catch {
    return null;
  }
  const accountEndpoint = credential
    ? notOrganicJudgementEndpoint(credential, (options.now ?? Date.now)()) : null;
  if (credential && !accountEndpoint) return null;
  // A custom endpoint cannot redirect an account token to another issuer/path.
  if (accountEndpoint && endpoint && endpoint !== accountEndpoint) return null;
  const direct = !accountEndpoint && (!endpoint || endpoint === SYSTEM_ONE_ENDPOINT);
  if (direct && !(apiKey && isDirectOptIn(env[JUDGEMENT_DIRECT_ENV]))) return null;
  const resolvedEndpoint = accountEndpoint ?? endpoint ?? SYSTEM_ONE_ENDPOINT;
  try {
    const url = new URL(resolvedEndpoint);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
      || url.username || url.password || url.search || url.hash) return null;
  } catch { return null; }

  const configuredModel = trimmed(env[JUDGEMENT_MODEL_ENV]);
  const model = configuredModel ?? (accountEndpoint ? NOTORGANIC_JUDGEMENT_MODEL : DEFAULT_SYSTEM_ONE_MODEL);
  const declared = trimmed(env[JUDGEMENT_CALIBRATION_ENV]);
  // A malformed pin is treated as absent: an uncalibrated backend abstains,
  // which is safe, where a bogus pin would authorize thresholds it never fitted.
  const calibrationSha256 = declared && isSha256Hex(declared)
    && (!accountEndpoint || (configuredModel && configuredModel !== NOTORGANIC_JUDGEMENT_MODEL)) ? declared : null;

  if (accountEndpoint && credential) {
    const accountCredential = credential;
    return {
      key: { backend: "system-one", model, calibrationSha256 },
      call: (request, signal) => createSystemOneCaller({
        fetch: createNotOrganicJudgementFetch({
          credential: accountCredential,
          endpoint: accountEndpoint,
          fetch: fetchImpl,
          idempotencyKey: `keating_judgement_${crypto.randomUUID()}`,
          now: options.now,
        }),
        endpoint: accountEndpoint,
        model,
        requestModel: NOTORGANIC_JUDGEMENT_MODEL,
        requireResolvedModel: true,
        calibrationSha256,
        retry: options.retry,
        sleep: options.sleep,
      })(request, signal),
    };
  }

  return {
    key: { backend: "system-one", model, calibrationSha256 },
    call: createSystemOneCaller({
      fetch: fetchImpl,
      ...(direct && apiKey ? { apiKey } : {}),
      endpoint: resolvedEndpoint,
      model,
      calibrationSha256,
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    }),
  };
}

/**
 * The same backend as a router tier.
 *
 * `isAvailable` is re-read on every route rather than captured once, because
 * escalating off the device is a setting a learner can change mid-session.
 */
export function cliJudgementTier(
  backend: CliJudgementBackend,
  isAvailable?: () => boolean,
): JudgementTier {
  return { key: backend.key, call: backend.call, ...(isAvailable ? { isAvailable } : {}) };
}
