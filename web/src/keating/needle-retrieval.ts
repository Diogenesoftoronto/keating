import { createNeedleRetrieval, needleRecallPrompt, needleSourceWindows, needleQueryText, type NeedleEmbedding, type NeedleSource, type NeedleSearchResult } from "@keating/learner-contracts";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { desktopNativeBridge, executeDesktopNative } from "../lib/desktop-native";
import { createLocalSetting } from "./local-setting";
import { browserNeedleAvailable, browserNeedleStatus, browserNeedleEmbed, subscribeBrowserNeedle } from "./browser-needle-runtime";

const preference = createLocalSetting<boolean>({ key: "keating:desktop-local-recall:v1", event: "keating:desktop-local-recall-changed", normalize: value => value === true || value === "true" });
export const desktopNeedleEnabled = () => preference.load();
export const setDesktopNeedleEnabled = (enabled: boolean) => preference.save(enabled);
export const subscribeDesktopNeedle = (listener: () => void) => {
  const stopSetting = preference.subscribe(listener);
  const stopModel = subscribeBrowserNeedle(listener);
  return () => { stopSetting(); stopModel(); };
};
export interface DesktopNeedleStatus {
  available: boolean; model: string | null;
  installed?: boolean; downloading?: boolean; downloadedBytes?: number; totalBytes?: number; error?: string; managed?: boolean;
}
type Execute = (operation: string, payload: unknown) => Promise<unknown>;
export async function desktopNeedleStatus(execute?: Execute): Promise<DesktopNeedleStatus> {
  if (!execute && !desktopNativeBridge()) return browserNeedleStatus();
  try {
    const result = await (execute ?? executeDesktopNative)("needle.status", {}) as Partial<DesktopNeedleStatus> | null;
    const status: DesktopNeedleStatus = result?.available === true && typeof result.model === "string" && !!result.model && result.model.length <= 512
      ? { available: true, model: result.model } : { available: false, model: null };
    for (const key of ["installed", "downloading", "managed"] as const) if (typeof result?.[key] === "boolean") status[key] = result[key];
    for (const key of ["downloadedBytes", "totalBytes"] as const) if (typeof result?.[key] === "number" && Number.isSafeInteger(result[key]) && result[key]! >= 0) status[key] = result[key];
    if (typeof result?.error === "string" && result.error.length <= 200) status.error = result.error;
    return status;
  } catch { return { available: false, model: null }; }
}
export interface NeedleSessionStore {
  getAllMetadata(): Promise<readonly { id: string; lastModified?: string; hiddenAlternative?: boolean; generatedAlternative?: boolean }[]>;
  loadSession(id: string): Promise<unknown>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function textBlocks(message: Record<string, unknown>): string[] {
  if (typeof message.content === "string") return [message.content];
  if (!Array.isArray(message.content)) return [];
  return message.content.map(part => record(part) && part.type === "text" && typeof part.text === "string" ? part.text : "");
}

/** Source ids include message and text-block indices; offsets refer to that exact block. */
export async function desktopNeedleSources(store: NeedleSessionStore, cutoff: number): Promise<NeedleSource[]> {
  const metadata = (await store.getAllMetadata()).filter(row => !row.hiddenAlternative && !row.generatedAlternative)
    .sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? "") || a.id.localeCompare(b.id)).slice(0, 16);
  const sources: NeedleSource[] = [];
  for (const entry of metadata) {
    const session = await store.loadSession(entry.id);
    if (!record(session) || session.id !== entry.id || session.hiddenAlternative || session.generatedAlternative || !Array.isArray(session.messages)) continue;
    for (let index = session.messages.length - 1; index >= Math.max(0, session.messages.length - 64) && sources.length < 128; index--) {
      const message = session.messages[index];
      if (!record(message) || (message.role !== "user" && message.role !== "user-with-attachments")
        || typeof message.timestamp !== "number" || !Number.isFinite(message.timestamp) || message.timestamp >= cutoff) continue;
      const blocks = textBlocks(message);
      for (let block = 0; block < Math.min(blocks.length, 8) && sources.length < 128; block++) {
        sources.push(...needleSourceWindows({ id: JSON.stringify([entry.id, index, message.timestamp, block]), kind: "learner-message",
          sessionId: entry.id, messageId: typeof message.id === "string" ? message.id : `index:${index}:timestamp:${message.timestamp}`,
          text: blocks[block] }, 4).slice(0, 128 - sources.length));
      }
    }
    if (sources.length >= 128) break;
  }
  return sources;
}

/** One agent owns this RAM-only index. No recalled text is written to the profile or base prompt. */
export function createDesktopNeedleRecall(options: {
  store: NeedleSessionStore; identity: () => string; current: () => boolean;
  requestIdentity?: () => string;
  onRetrieved?: (result: NeedleSearchResult, current: () => boolean) => void;
  execute?: Execute; available?: () => boolean; enabled?: () => boolean;
  subscribe?: (listener: () => void) => () => void; timeoutMs?: number;
}) {
  const execute = options.execute;
  const enabled = options.enabled ?? desktopNeedleEnabled;
  const available = options.available ?? (() => desktopNativeBridge() !== null || browserNeedleAvailable());
  let generation = 0;
  let disposed = false;
  let identity = options.identity();
  const controllers = new Set<AbortController>();
  const retrieval = createNeedleRetrieval(async (texts, signal) => {
    if (signal?.aborted || !available() || !enabled()) return null;
    const before = await desktopNeedleStatus(execute);
    if (!before.available || signal?.aborted) return null;
    const result = execute || desktopNativeBridge()
      ? await (execute ?? executeDesktopNative)("needle.embed", { texts: [...texts] }) as NeedleEmbedding | null
      : await browserNeedleEmbed(texts, signal);
    if (signal?.aborted || !enabled() || !available() || result?.model !== before.model) return null;
    return result;
  });
  const clear = () => { generation++; for (const controller of controllers) controller.abort(); retrieval.clear(); };
  const unsubscribe = (options.subscribe ?? subscribeDesktopNeedle)(clear);
  return {
    dispose() { disposed = true; clear(); unsubscribe(); },
    applicable() { return !disposed && options.current() && enabled() && available(); },
    current() { return !disposed && options.current() && options.identity() === identity && enabled() && available(); },
    captureRequest() { return { identity: options.identity(), request: options.requestIdentity?.() ?? "" }; },
    requestCurrent(captured: { identity: string; request: string }) {
      return !disposed && options.current() && options.identity() === captured.identity && (options.requestIdentity?.() ?? "") === captured.request;
    },
    async prepare(query: string, cutoff: number, signal?: AbortSignal): Promise<string> {
      const nextIdentity = options.identity();
      if (nextIdentity !== identity) { clear(); identity = nextIdentity; }
      if (disposed || !options.current() || !enabled() || !available() || signal?.aborted || !Number.isFinite(cutoff)) return "";
      generation++;
      for (const pending of controllers) pending.abort();
      const epoch = generation;
      const requestIdentity = options.requestIdentity?.() ?? "";
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(abort, options.timeoutMs ?? 12_000);
      const current = () => !disposed && generation === epoch && !controller.signal.aborted && options.current()
        && options.identity() === nextIdentity && (options.requestIdentity?.() ?? "") === requestIdentity && enabled() && available();
      const cancelled = new Promise<string>(resolve => { controller.signal.addEventListener("abort", () => resolve(""), { once: true }); if (controller.signal.aborted) resolve(""); });
      const run = async () => {
        try {
          const sources = await desktopNeedleSources(options.store, cutoff);
          if (!current()) return "";
          const sourceKey = JSON.stringify(sources);
          const result = await retrieval.search(query, sources, { signal: controller.signal, current });
          if (!current() || !result) return "";
          const fresh = await desktopNeedleSources(options.store, cutoff);
          if (!current() || JSON.stringify(fresh) !== sourceKey) { retrieval.clear(); return ""; }
          const status = await desktopNeedleStatus(execute);
          if (!current() || !status.available || status.model !== result.model) { retrieval.clear(); return ""; }
          try { options.onRetrieved?.(structuredClone(result), current); } catch { /* Optional background admission must not interrupt a reply. */ }
          return needleRecallPrompt(result);
        } catch { return ""; }
      };
      try { return await Promise.race([run(), cancelled]); }
      finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controllers.delete(controller); }
    },
  };
}

export type DesktopNeedleRecall = ReturnType<typeof createDesktopNeedleRecall>;
/** Resolve optional retrieval at dispatch time, preserving every existing prompt layer. */
export function withDesktopNeedleRecall(stream: NonNullable<AgentOptions["streamFn"]>, recall: DesktopNeedleRecall): NonNullable<AgentOptions["streamFn"]> {
  return (model, context, options) => {
    if (!recall.applicable()) return stream(model, context, options);
    return (async () => {
      const captured = recall.captureRequest();
      const latest = [...context.messages].reverse().find(message => message.role === "user");
      const blocks = latest ? textBlocks(latest as unknown as Record<string, unknown>) : [];
      const query = needleQueryText(blocks.join("\n"));
      const prepared = latest && query.trim() ? await recall.prepare(query, latest.timestamp, options?.signal) : "";
      options?.signal?.throwIfAborted();
      if (!recall.requestCurrent(captured)) throw new DOMException("The learner request changed while local recall was running.", "AbortError");
      const prompt = recall.current() ? prepared : "";
      return stream(model, prompt ? { ...context, systemPrompt: `${context.systemPrompt ?? ""}${prompt}` } : context, options);
    })();
  };
}
