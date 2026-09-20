#!/usr/bin/env bun
/** One benchmark request over the project's existing Not Organic DPoP capability. */
import { randomUUID } from "node:crypto";
import {
  createNotOrganicJudgementFetch,
  loadNotOrganicJudgementCredential,
  notOrganicJudgementEndpoint,
  NOTORGANIC_JUDGEMENT_MODEL,
} from "../../src/judgement/notorganic.js";

// stdout is exclusively the response protocol. Never print credentials, request
// state, upstream error bodies, or exception text on either output stream.
let failure = "notorganic-judgement-request-failed";
try {
  const text = await Bun.stdin.text();
  if (text.length > 256_000) throw new Error();
  const request: unknown = JSON.parse(text);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error();
  const body = request as Record<string, unknown>;
  // The gateway owns model resolution. Do not silently redirect a direct-model
  // experiment through an alias and mislabel its requested identity.
  if (body.model !== NOTORGANIC_JUDGEMENT_MODEL) {
    failure = "notorganic-judgement-requires-model-alias-judgement";
    throw new Error();
  }
  failure = "notorganic-judgement-capability-unavailable";
  const credential = loadNotOrganicJudgementCredential(process.cwd());
  const endpoint = credential && notOrganicJudgementEndpoint(credential);
  if (!credential || !endpoint) throw new Error();
  failure = "notorganic-judgement-request-failed";
  const dispatch = createNotOrganicJudgementFetch({
    credential,
    endpoint,
    idempotencyKey: randomUUID(),
    fetch: (url, init) => fetch(url, init as RequestInit),
  });
  const response = await dispatch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error();
  const result = await response.json() as Record<string, unknown> | null;
  if (!result || typeof result.model !== "string" || !result.model.trim()
    || result.model.trim() === "judgement" || result.model.trim().endsWith("-latest")
    || !result.answers || typeof result.answers !== "object" || Array.isArray(result.answers)) {
    failure = "notorganic-judgement-invalid-response";
    throw new Error();
  }
  process.stdout.write(JSON.stringify({ model: result.model.trim(), answers: result.answers, usage: result.usage }));
} catch {
  process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
}
