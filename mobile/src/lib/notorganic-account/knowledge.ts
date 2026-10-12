import { activeDeviceSession, guardedKnowledgeRequest } from "./client";
import { defaultNotOrganicAccountConfig, NOTORGANIC_MOBILE_CLIENT_ID, type NotOrganicAccountConfig } from "./contracts";
import { deviceSessionGeneration, loadDeviceSession } from "./credentials";

export interface MobileKnowledgeTool {
  name: string; description?: string; inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
}
export interface MobileKnowledgeSource {
  id: string; label: string; provider: "remote-mcp"; tools: MobileKnowledgeTool[]; resources_allowed: boolean;
}
export interface MobileKnowledgeResource { uri: string; name: string; description?: string; mimeType?: string }

/** Scope upgrades always go through a new PKCE approval; a refresh cannot add permissions. */
export function mobileKnowledgeAccountConfig(config = defaultNotOrganicAccountConfig(), tools = false, previousScope = ""): NotOrganicAccountConfig {
  return { ...config, scope: [...new Set([...config.scope.split(/\s+/), ...previousScope.split(/\s+/), "knowledge:read", ...(tools ? ["knowledge:tools"] : [])].filter(Boolean))].join(" ") };
}

export function mobileKnowledgePortalUrl(config = defaultNotOrganicAccountConfig()): string {
  const url = new URL(config.authorizationUrl);
  url.pathname = "/"; url.search = ""; url.hash = "";
  if (url.protocol !== "https:" || url.username || url.password) throw Error("Knowledge account configuration is invalid.");
  url.searchParams.set("view", "knowledge");
  url.searchParams.set("app_client", NOTORGANIC_MOBILE_CLIENT_ID);
  return url.toString();
}

/** No credentials for remote servers enter this client. Every operation is checked by the gateway. */
export async function mobileKnowledgeRequest<T>(path: string, init: RequestInit = {}, current: () => boolean = () => true, config = defaultNotOrganicAccountConfig()): Promise<T> {
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== "/") throw Error("Knowledge account configuration is invalid.");
  const stored = await loadDeviceSession();
  const permission = path.endsWith("/call") ? "knowledge:tools" : "knowledge:read";
  if (!current() || init.signal?.aborted || stored?.issuer !== config.issuer || !stored.accountId || !stored.scope.split(/\s+/).includes(permission)) throw Error("Approve knowledge access for Keating mobile first.");
  const active = await activeDeviceSession(config);
  const generation = deviceSessionGeneration();
  if (!current() || init.signal?.aborted || active.issuer !== stored.issuer || active.accountId !== stored.accountId || !active.scope.split(/\s+/).includes(permission)) throw Error("The knowledge account changed.");
  const result = await guardedKnowledgeRequest<T>(path, init, current, { accountId: stored.accountId, generation }, config);
  if (!current() || init.signal?.aborted || generation !== deviceSessionGeneration()) throw Error("The knowledge account changed. Returned content was discarded.");
  return result;
}

export async function loadMobileKnowledgeSources(current?: () => boolean): Promise<MobileKnowledgeSource[]> {
  const body = await mobileKnowledgeRequest<{ data: unknown }>("sources", {}, current);
  if (!Array.isArray(body?.data) || body.data.length > 128) throw Error("The knowledge catalogue is unavailable.");
  return body.data.filter((value): value is MobileKnowledgeSource => !!value && typeof value === "object" && typeof value.id === "string" && value.id.length <= 256
    && typeof value.label === "string" && value.label.length <= 80 && value.provider === "remote-mcp" && typeof value.resources_allowed === "boolean"
    && Array.isArray(value.tools) && value.tools.length <= 128 && value.tools.every((tool: MobileKnowledgeTool) => tool && typeof tool.name === "string" && tool.name.length <= 256
      && !!tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)));
}

export const knowledgePath = (id: string) => `sources/${encodeURIComponent(id)}`;

/** Bounded attributed text is data, never an instruction or executable artifact. */
export function mobileKnowledgeContent(source: Pick<MobileKnowledgeSource, "id" | "label">, result: unknown, uri?: string): Record<string, unknown> {
  const text = JSON.stringify(result) ?? "null";
  return { source: { id: source.id, label: source.label, ...(uri ? { uri } : {}) }, trust: "untrusted-external-content", content: text.slice(0, 24000), truncated: text.length > 24000 };
}
