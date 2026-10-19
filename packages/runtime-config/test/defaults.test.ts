/** Compatibility checks for public defaults; no provider calls or environment required. */
import { describe, expect, test } from "bun:test";
import {
  API_VERSIONS, DEFAULT_MODELS, DEFAULT_NOTORGANIC_SCOPE, DEFAULT_SYSTEM_ONE_MODEL,
  NOTORGANIC_CHAT_MODEL_IDS, NOTORGANIC_IMAGE_MODEL_IDS, PROVIDER_ENDPOINTS,
  SERVICE_ENDPOINTS, SPENDING_LIMITS, SYSTEM_ONE_ENDPOINT, buildNotOrganicScope,
} from "../src/index.js";

describe("public runtime configuration", () => {
  test("preserves intentional CLI, mobile, speech and judgement defaults", () => {
    expect(DEFAULT_MODELS.cli).toEqual({ notorganic: "balanced", openai: "gpt-5.5", google: "gemini-3.5-flash",
      anthropic: "claude-sonnet-4-6", openrouter: "poolside/laguna-m.1:free", zyphra: "zyphra/ZAYA1-8B", minimax: "MiniMax-M2.7-highspeed" });
    expect(DEFAULT_MODELS.mobile).toEqual({ openai: "gpt-5.4", anthropic: "claude-sonnet-4-6", google: "gemini-3.5-flash",
      openrouter: "anthropic/claude-sonnet-4.6", custom: "default" });
    expect(DEFAULT_MODELS.speech).toEqual({ sttOpenai: "gpt-4o-transcribe", sttGoogle: "gemini-2.5-flash",
      ttsOpenai: "gpt-4o-mini-tts", realtimeOpenai: "gpt-realtime-2.1", liveGoogle: "gemini-3.1-flash-live-preview", liveNotOrganic: "gpt-live-1", steering: "default" });
    expect(DEFAULT_MODELS.web.notorganic).toBe("balanced");
    expect(DEFAULT_SYSTEM_ONE_MODEL).toBe("jev-latest");
    expect(DEFAULT_MODELS.judgement.tabular).toBe("v3.5_default");
  });
  test("preserves service URLs, API versions and distinct reservation ceilings", () => {
    expect(SERVICE_ENDPOINTS.notorganic).toEqual({ api: "https://api.notorganic.info", authorization: "https://id.notorganic.info/authorize",
      account: "https://id.notorganic.info/account", waitlist: "https://id.notorganic.info/waitlist" });
    expect(SYSTEM_ONE_ENDPOINT).toBe("https://api.typesafe.ai/v1/systemone");
    expect(PROVIDER_ENDPOINTS.openaiSpeech).toBe("https://api.openai.com/v1/audio/speech");
    expect(SERVICE_ENDPOINTS.zyphra).toBe("https://api.zyphracloud.com/v1");
    expect(PROVIDER_ENDPOINTS.openaiTranscription).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(PROVIDER_ENDPOINTS.openaiImages).toBe("https://api.openai.com/v1/images/generations");
    expect(PROVIDER_ENDPOINTS.openaiRealtimeSecrets).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(PROVIDER_ENDPOINTS.openaiRealtimeCalls).toBe("https://api.openai.com/v1/realtime/calls");
    expect(PROVIDER_ENDPOINTS.googleImageTemplate).toBe("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
    expect(API_VERSIONS).toEqual({ anthropic: "2023-06-01", google: "v1beta" });
    expect(SPENDING_LIMITS).toEqual({ notorganicRequestMicrousd: 100000, notorganicServerRequestMicrousd: 50000 });
  });
  test("derived browser consent is byte-identical to the shipped code fallback", () => {
    expect(DEFAULT_NOTORGANIC_SCOPE).toBe("wallet:read usage:read billing:checkout infer:balanced infer:gpt-6.1-sol web:search web:fetch infer:image realtime:connect");
    for (const model of [...NOTORGANIC_CHAT_MODEL_IDS, ...NOTORGANIC_IMAGE_MODEL_IDS]) {
      expect(DEFAULT_NOTORGANIC_SCOPE.split(" ")).toContain(`infer:${model}`);
    }
    expect(DEFAULT_NOTORGANIC_SCOPE).not.toContain("judgement:evaluate");
    expect(DEFAULT_NOTORGANIC_SCOPE).not.toContain("tabular:predict");
  });
  test("new models automatically gain sorted, unique inference scopes without widening capabilities", () => {
    const options = { models: ["qwen-new", DEFAULT_MODELS.image.notorganic, "gpt-new", "gpt-new", " balanced "], capabilities: ["web:search", "wallet:read", "wallet:read"] };
    const scope = buildNotOrganicScope(options).split(" ");
    expect(scope.filter(value => value.startsWith("infer:"))).toEqual(["infer:balanced", "infer:gpt-new", "infer:image", "infer:qwen-new"]);
    expect(scope).toHaveLength(new Set(scope).size);
    expect(buildNotOrganicScope({ ...options, models: [...options.models].reverse() })).toBe(scope.join(" "));
    expect(buildNotOrganicScope({ models: [], capabilities: ["usage:read"] })).toBe("usage:read");
  });
});
