import type { ArizeAvailability } from "./types.js";

const DEFAULT_ENDPOINT = "https://otlp.arize.com/v1/traces";
const MAX_CONTENT_CHARS = 16_000;
const MAX_RATE_LIMIT = 300;

export interface ArizeServerConfig extends ArizeAvailability {
  apiKey?: string;
  spaceId?: string;
  endpoint?: string;
  projectName?: string;
}

function boundedInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function validEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validProjectName(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value);
}

/** Reads only server/local environment. Never expose this structure to a client. */
export function readArizeConfig(env: NodeJS.ProcessEnv = process.env): ArizeServerConfig {
  const enabledByOperator = env.ARIZE_ENABLED === "true";
  const apiKey = env.ARIZE_API_KEY?.trim();
  const spaceId = env.ARIZE_SPACE_ID?.trim();
  const endpoint = (env.ARIZE_OTLP_ENDPOINT?.trim() || DEFAULT_ENDPOINT);
  const projectName = (env.ARIZE_PROJECT_NAME?.trim() || "keating");
  const evaluationContentEnabled = env.ARIZE_EVALUATION_CONTENT_ENABLED === "true";
  const maxContentChars = boundedInteger(env.ARIZE_MAX_CONTENT_CHARS, MAX_CONTENT_CHARS, MAX_CONTENT_CHARS);
  const rateLimitPerMinute = boundedInteger(env.ARIZE_RATE_LIMIT_PER_MINUTE, 30, MAX_RATE_LIMIT);

  let reason: ArizeServerConfig["reason"] = "enabled";
  if (!enabledByOperator) reason = "disabled";
  else if (!apiKey) reason = "missing_api_key";
  else if (!spaceId) reason = "missing_space_id";
  else if (!validEndpoint(endpoint)) reason = "invalid_endpoint";
  else if (!validProjectName(projectName)) reason = "invalid_project_name";

  return {
    enabled: reason === "enabled",
    reason,
    evaluationContentEnabled,
    maxContentChars,
    rateLimitPerMinute,
    ...(reason === "enabled" ? { apiKey, spaceId, endpoint, projectName } : {}),
  };
}

export function publicArizeAvailability(config = readArizeConfig()): ArizeAvailability {
  return {
    enabled: config.enabled,
    reason: config.reason,
    evaluationContentEnabled: config.evaluationContentEnabled,
    maxContentChars: config.maxContentChars,
    rateLimitPerMinute: config.rateLimitPerMinute,
  };
}
