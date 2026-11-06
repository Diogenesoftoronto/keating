import { AuthStorage, type ApiKeyCredential } from "@earendil-works/pi-coding-agent";
import { TUTOR_CONSULTATION_DESCRIPTION, TUTOR_CONSULTATION_PARAMETERS, TUTOR_CONSULTATION_SCOPE, tutorConsultationAdvice, tutorConsultationInput, tutorConsultationResult } from "../../../../shared/tutor-consultation.js";
import { createNotOrganicDpopProof, NOTORGANIC_AUTH_ENV, NOTORGANIC_PROVIDER_ID, notOrganicAuthPath, resolveNotOrganicIssuer } from "../../../core/notorganic-auth.js";
import { getCwd, keatingToolMaker } from "./shared.js";

function storedCredential(cwd: string): ApiKeyCredential | undefined {
  const credential = AuthStorage.create(notOrganicAuthPath(cwd)).get(NOTORGANIC_PROVIDER_ID);
  return credential?.type === "api_key" ? credential : undefined;
}

/** Uses only a real stored account capability; an upstream API key grants no authority here. */
export async function consultTutorFromCli(
  cwd: string,
  value: Record<string, unknown>,
  signal?: AbortSignal,
  options: { credential?: ApiKeyCredential; fetch?: typeof globalThis.fetch; now?: () => number } = {},
): Promise<string> {
  const body = tutorConsultationInput(value);
  signal?.throwIfAborted();
  const credential = options.credential ?? storedCredential(cwd);
  const env = credential?.env;
  if (!credential?.key || !env?.[NOTORGANIC_AUTH_ENV.scope]?.split(/\s+/).includes(TUTOR_CONSULTATION_SCOPE)) {
    throw new Error(`The CLI needs ${TUTOR_CONSULTATION_SCOPE} consent before consulting Ampersand Tutor. Run \`keating login --tutor\` for fresh consent.`);
  }
  const now = options.now ?? Date.now;
  if (env[NOTORGANIC_AUTH_ENV.tokenType] !== "DPoP" || !env[NOTORGANIC_AUTH_ENV.privateJwk]
    || !Number.isFinite(Number(env[NOTORGANIC_AUTH_ENV.expiresAt])) || Number(env[NOTORGANIC_AUTH_ENV.expiresAt]) <= now()) {
    throw new Error("The stored Not Organic tutor capability is invalid or expired. Sign in again with tutor consent.");
  }
  const cap = Number(env[NOTORGANIC_AUTH_ENV.maxCostMicrousd]);
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error("The stored Not Organic tutor budget is invalid.");
  const url = `${resolveNotOrganicIssuer(env[NOTORGANIC_AUTH_ENV.issuer])}/v1/tutor/consult`;
  const proof = await createNotOrganicDpopProof({ privateJwk: env[NOTORGANIC_AUTH_ENV.privateJwk]!, accessToken: credential.key, method: "POST", url, now });
  signal?.throwIfAborted();
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `DPoP ${credential.key}`, dpop: proof,
      "idempotency-key": `keating_tutor_${crypto.randomUUID()}`, "x-notorganic-max-cost-microusd": String(cap) },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Tutor consultation failed (${response.status}). It was not retried; check Not Organic usage before trying again.`);
  }
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Tutor consultation response exceeded its size limit.");
  return tutorConsultationAdvice(tutorConsultationResult(JSON.parse(text)));
}

export function createCliTutorConsultationTools(cwd = getCwd()) {
  const credential = storedCredential(cwd);
  if (!credential?.env?.[NOTORGANIC_AUTH_ENV.scope]?.split(/\s+/).includes(TUTOR_CONSULTATION_SCOPE)) return [];
  const tool = keatingToolMaker("consult_tutor", "consult_tutor", TUTOR_CONSULTATION_DESCRIPTION, TUTOR_CONSULTATION_PARAMETERS,
    async (params, ctx, signal) => ({ content: [{ type: "text", text: await consultTutorFromCli(ctx?.cwd ?? cwd, params, signal) }] }));
  return [{ ...tool, parameters: { ...tool.parameters, required: ["question"] } }];
}
