import { assertMethod, createError, defineEventHandler, getRequestURL, setResponseHeader } from "h3";
import { SYSTEM_ONE_ENDPOINT, errorForStatus } from "@keating/learner-contracts";
import { readBoundedBody, readBoundedJsonBody } from "../../utils/bounded-body";
import { validateJudgementGatewayBody } from "../../utils/judgement-gateway";
import { acquirePublicConcurrency, consumePublicRateLimit } from "../../utils/public-abuse";

/** BYOK relay: fixed upstream, transient user key, no product/provider credentials. */
export default defineEventHandler(async event => {
  assertMethod(event, "POST");
  setResponseHeader(event, "Cache-Control", "no-store");
  const origin = event.req.headers.get("origin");
  if (origin && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403, statusMessage: "Cross-origin review requests are not allowed." });
  const authorization = event.req.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s\x00-\x1f\x7f]{1,4096}$/.test(authorization)) {
    throw createError({ statusCode: 401, statusMessage: "A TypeSafe API key is required." });
  }
  await consumePublicRateLimit(event, { bucket: "typesafe-review", limit: 120, windowSeconds: 60 });
  const input = await readBoundedJsonBody(event.req, 256 * 1024);
  const checked = validateJudgementGatewayBody(input);
  const model = (input as { model?: unknown })?.model;
  if (!checked.ok || typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) {
    throw createError({ statusCode: 422, statusMessage: "Invalid judgement request." });
  }
  const release = await acquirePublicConcurrency(event, { bucket: "typesafe-review", limit: 4, leaseSeconds: 65 });
  const signal = AbortSignal.any([event.req.signal, AbortSignal.timeout(60_000)]);
  try {
    const upstream = await fetch(SYSTEM_ONE_ENDPOINT, {
      method: "POST", redirect: "error", signal,
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ ...checked.body, model }),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return Response.json({ error: { code: errorForStatus(upstream.status).code } }, {
        status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
        headers: { "cache-control": "no-store" },
      });
    }
    // Bound the response before returning JSON; never propagate upstream headers or errors.
    const bytes = await readBoundedBody(new Request("https://relay.invalid", { method: "POST", body: upstream.body, duplex: "half" } as RequestInit), 512 * 1024, 15_000);
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid response");
    return Response.json({ answers: payload.answers, usage: payload.usage, model: payload.model }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: { code: signal.aborted ? "backend-timeout" : "backend-unavailable" } }, {
      status: signal.aborted ? 504 : 502, headers: { "cache-control": "no-store" },
    });
  } finally { await release(); }
});
