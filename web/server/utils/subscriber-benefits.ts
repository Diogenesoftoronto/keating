import { createError, type H3Event } from "h3";
import { NotOrganicFetchAdapter } from "../../src/notorganic-provider/fetch-adapter";
import {
  getNotOrganicServerConfig,
  requireNotOrganicProductSession,
} from "../../src/notorganic-provider/server";
import {
  hasKeatingPaidSubscription,
  type KeatingSubscriberBenefit,
} from "../../src/notorganic-provider/subscriber-benefits";

/** Server-only authorization; a browser plan flag or wallet balance is insufficient. */
export async function requireKeatingSubscriberBenefit(event: H3Event, benefit: KeatingSubscriberBenefit): Promise<string> {
  const config = getNotOrganicServerConfig();
  if (!config.enabled) throw createError({ statusCode: 503, statusMessage: "Subscriber services are unavailable." });
  const session = await requireNotOrganicProductSession(event, `keating:${benefit}`);
  const client = new NotOrganicFetchAdapter({ baseUrl: config.gatewayBaseUrl, session });
  const response = await client.request("/v1/account", { method: "GET" });
  if (!response.ok) throw createError({ statusCode: 503, statusMessage: "Your subscription could not be verified." });
  const account = await response.json().catch(() => null);
  if (!hasKeatingPaidSubscription(account, session.accountId)) {
    throw createError({ statusCode: 403, statusMessage: "An active Keating Personal subscription is required.", data: { code: "subscription_required", benefit } });
  }
  return session.accountId;
}
