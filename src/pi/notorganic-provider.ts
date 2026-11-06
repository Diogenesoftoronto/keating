import {
  createAssistantMessageEventStream,
  streamSimpleOpenAICompletions,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai/compat";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { FLINT_PREVIEW_PROFILE, INKLING_2_SMALL_PROFILE, TUTOR_CONSULTATION_MODEL_ID } from "../../packages/runtime-config/src/index.js";

import {
  createNotOrganicDpopProof,
  NOTORGANIC_AUTH_ENV,
  NOTORGANIC_DEFAULT_ISSUER,
  NOTORGANIC_DEFAULT_MAX_COST_MICROUSD,
  NOTORGANIC_MODEL_ID,
  NOTORGANIC_PROVIDER_ID,
  parseNotOrganicLoginScope,
  parseNotOrganicPrivateJwk,
  resolveNotOrganicIssuer
} from "../core/notorganic-auth.js";

export const NOTORGANIC_PI_API = "notorganic-openai-completions";

export const NOTORGANIC_BALANCED_MODEL = {
  id: "balanced",
  name: "Not Organic Balanced",
  reasoning: true,
  input: ["text"] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 16_384,
  compat: {
    // The account gateway accepts system/user/assistant/tool, not developer.
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    supportsStore: false
  }
} as const;

export const NOTORGANIC_INKLING_2_SMALL_MODEL = {
  ...NOTORGANIC_BALANCED_MODEL,
  id: NOTORGANIC_MODEL_ID,
  name: INKLING_2_SMALL_PROFILE.name,
  input: ["text", "image"] as const,
  contextWindow: INKLING_2_SMALL_PROFILE.contextWindow,
} as const;

/** Dormant preview: the account gateway, not registration, authorizes and enables this route. */
export const NOTORGANIC_FLINT_MODEL = {
  ...FLINT_PREVIEW_PROFILE,
  reasoning: false,
  input: ["text"] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: {
    supportsDeveloperRole: false, supportsReasoningEffort: false,
    supportsUsageInStreaming: true, supportsStore: false,
    maxTokensField: "max_completion_tokens" as const,
  },
} as const;

export interface NotOrganicRequestHeadersInput {
  accessToken: string;
  env?: Record<string, string>;
  method?: string;
  url: string;
  now?: () => number;
  jti?: string;
  idempotencyKey?: string;
  model?: string;
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function assertCapability(env: Record<string, string> | undefined, now: () => number, model?: string): {
  issuer: string;
  privateJwk: string;
  maxCostMicrousd: number;
} {
  if (!env || !parseNotOrganicLoginScope(env[NOTORGANIC_AUTH_ENV.scope])) {
    throw new Error("Not Organic is missing a supported inference capability. Run `keating login` again.");
  }
  const scopes = new Set(env[NOTORGANIC_AUTH_ENV.scope]?.split(" "));
  if (model && !scopes.has(`infer:${model}`)) {
    throw new Error(`Not Organic is missing infer:${model}. Run \`keating login --model=${model}\` for fresh consent.`);
  }
  if (env[NOTORGANIC_AUTH_ENV.tokenType] !== "DPoP") {
    throw new Error("The stored Not Organic capability is not DPoP-bound. Run `keating login` again.");
  }
  const expiresAt = Number(env[NOTORGANIC_AUTH_ENV.expiresAt]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
    const login = `keating login${scopes.has(`infer:${FLINT_PREVIEW_PROFILE.id}`) ? ` --model=${FLINT_PREVIEW_PROFILE.id}` : ""}${scopes.has("infer:balanced") && !scopes.has(`infer:${NOTORGANIC_MODEL_ID}`) ? " --model=balanced" : ""}${scopes.has(`infer:${TUTOR_CONSULTATION_MODEL_ID}`) ? " --tutor" : ""}${scopes.has("judgement:evaluate") ? " --judgement" : ""}`;
    throw new Error(
      `Your five-minute Not Organic capability expired. Run \`${login}\` again; this CLI does not invent a refresh token.`
    );
  }
  const privateJwk = env[NOTORGANIC_AUTH_ENV.privateJwk];
  if (!privateJwk) {
    throw new Error("The Not Organic DPoP key is missing. Run `keating login` again.");
  }
  parseNotOrganicPrivateJwk(privateJwk);
  return {
    issuer: resolveNotOrganicIssuer(env[NOTORGANIC_AUTH_ENV.issuer]),
    privateJwk,
    maxCostMicrousd: positiveInteger(
      env[NOTORGANIC_AUTH_ENV.maxCostMicrousd],
      NOTORGANIC_DEFAULT_MAX_COST_MICROUSD,
      "Not Organic maximum cost"
    )
  };
}

export function notOrganicChatCompletionsUrl(issuer = NOTORGANIC_DEFAULT_ISSUER): string {
  return `${resolveNotOrganicIssuer(issuer)}/v1/chat/completions`;
}

export async function createNotOrganicRequestHeaders(
  input: NotOrganicRequestHeadersInput
): Promise<Record<string, string>> {
  if (!input.accessToken) {
    throw new Error("Not Organic is not connected. Run `keating login` to enable hosted inference.");
  }
  const now = input.now ?? Date.now;
  const capability = assertCapability(input.env, now, input.model);
  const exactUrl = secureExactRequestUrl(input.url, capability.issuer);
  const dpop = await createNotOrganicDpopProof({
    privateJwk: capability.privateJwk,
    accessToken: input.accessToken,
    method: input.method ?? "POST",
    url: exactUrl,
    now,
    jti: input.jti
  });
  return {
    authorization: `DPoP ${input.accessToken}`,
    dpop,
    "idempotency-key": input.idempotencyKey ?? `keating_${crypto.randomUUID()}`,
    "x-notorganic-max-cost-microusd": String(capability.maxCostMicrousd)
  };
}

function secureExactRequestUrl(value: string, expectedIssuer: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Not Organic inference URL is invalid.");
  }
  if (url.origin !== expectedIssuer || url.pathname !== "/v1/chat/completions" || url.search || url.hash) {
    throw new Error("Not Organic inference must use the configured issuer's exact chat-completions URL.");
  }
  return url.toString();
}

function errorMessage(model: Model<Api>, cause: unknown, aborted: boolean): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: aborted ? "aborted" : "error",
    errorMessage: cause instanceof Error ? cause.message : "Not Organic inference could not start.",
    timestamp: Date.now()
  };
}

function unprotectedHeaders(headers: SimpleStreamOptions["headers"]): Record<string, string | null> {
  const protectedNames = new Set([
    "authorization",
    "dpop",
    "idempotency-key",
    "x-notorganic-max-cost-microusd"
  ]);
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => !protectedNames.has(name.toLowerCase()))
  );
}

function restoreRegisteredApi(
  event: AssistantMessageEvent,
  api: Api
): AssistantMessageEvent {
  if ("partial" in event) event.partial.api = api;
  if (event.type === "done") event.message.api = api;
  if (event.type === "error") event.error.api = api;
  return event;
}

export function streamNotOrganic(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
) {
  const outer = createAssistantMessageEventStream();
  void (async () => {
    try {
      const issuer = resolveNotOrganicIssuer(options?.env?.[NOTORGANIC_AUTH_ENV.issuer]);
      const baseUrl = `${issuer}/v1`;
      const requestUrl = notOrganicChatCompletionsUrl(issuer);
      const protectedHeaders = await createNotOrganicRequestHeaders({
        accessToken: options?.apiKey ?? "",
        env: options?.env,
        method: "POST",
        model: model.id,
        url: requestUrl
      });
      const requestModel = {
        ...model,
        api: "openai-completions" as const,
        baseUrl
      };
      // Do not hand the serialized private JWK to the generic OpenAI adapter.
      // It only needs the token plus the already-signed request headers.
      const { env: _privateProviderEnvironment, ...safeOptions } = options ?? {};
      const inner = streamSimpleOpenAICompletions(requestModel, context, {
        ...safeOptions,
        ...(model.id === FLINT_PREVIEW_PROFILE.id ? { temperature: 0 } : {}),
        headers: {
          ...unprotectedHeaders(options?.headers),
          ...protectedHeaders
        },
        apiKey: options?.apiKey,
        maxRetries: 0
      });
      for await (const event of inner) outer.push(restoreRegisteredApi(event, model.api));
    } catch (cause) {
      const aborted = options?.signal?.aborted === true;
      const error = errorMessage(model, cause, aborted);
      outer.push({ type: "error", reason: aborted ? "aborted" : "error", error });
      outer.end(error);
    }
  })();
  return outer;
}

export function createNotOrganicProviderConfig(
  issuer = NOTORGANIC_DEFAULT_ISSUER
): ProviderConfig {
  const baseUrl = `${resolveNotOrganicIssuer(issuer)}/v1`;
  return {
    name: "Not Organic Hosted",
    baseUrl,
    apiKey: "$NOTORGANIC_ACCESS_TOKEN",
    api: NOTORGANIC_PI_API,
    models: [
      {
        ...NOTORGANIC_INKLING_2_SMALL_MODEL,
        input: [...NOTORGANIC_INKLING_2_SMALL_MODEL.input],
        api: NOTORGANIC_PI_API
      },
      {
        ...NOTORGANIC_BALANCED_MODEL,
        input: [...NOTORGANIC_BALANCED_MODEL.input], api: NOTORGANIC_PI_API,
      },
      {
        ...NOTORGANIC_FLINT_MODEL,
        input: [...NOTORGANIC_FLINT_MODEL.input],
        api: NOTORGANIC_PI_API
      }
    ],
    streamSimple: streamNotOrganic
  };
}

// The local provider contract is source-derived and fully tested, but a real
// production portal -> gateway -> inference acceptance run remains unverified.
export const NOTORGANIC_LIVE_ACCEPTANCE_VERIFIED = false;
