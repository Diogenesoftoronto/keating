/** Optional, account-scoped proxy memory. Review never delays the teacher. */
import { admitMemoryBank, memoryBankPrompt, reviewMemoryCandidates, type MemoryBank,
  type MemoryAdmissionCandidate, type MemoryAdmissionDecision,
  type JudgementCaller, type NeedleSearchResult } from "@keating/learner-contracts";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { createLocalSetting } from "../local-setting";
import type { NeedleSessionStore } from "../needle-retrieval";
import { notOrganicPublicClient } from "../../notorganic-provider";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./runtime";
import { createJudgementOperationCaller } from "./operation";
import { webJudgementCalibrationStore } from "./calibration";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../judgement-model";

const preference = createLocalSetting<boolean>({ key: "keating:memory-admission:v1", event: "keating:memory-admission-changed", normalize: value => value === true || value === "true" });
export const webMemoryAdmissionEnabled = () => preference.load();
export const setWebMemoryAdmissionEnabled = (enabled: boolean) => preference.save(enabled);
export const subscribeWebMemoryAdmission = (listener: () => void) => preference.subscribe(listener);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const blocks = (message: Record<string, unknown>): string[] => typeof message.content === "string" ? [message.content]
  : Array.isArray(message.content) ? message.content.map(part => object(part) && part.type === "text" && typeof part.text === "string" ? part.text : "") : [];
const messageId = (message: Record<string, unknown>, index: number) => typeof message.id === "string" ? message.id : `index:${index}:timestamp:${message.timestamp}`;
const learner = (message: unknown): message is Record<string, unknown> => object(message) && (message.role === "user" || message.role === "user-with-attachments");

/** Recover the complete original message and translate block-relative Needle offsets. */
export async function webMemoryCandidates(result: NeedleSearchResult, store: NeedleSessionStore): Promise<MemoryAdmissionCandidate[]> {
  const candidates: MemoryAdmissionCandidate[] = [];
  for (const match of result.matches.slice(0, 4)) {
    const source = match.source;
    if (source.kind !== "learner-message" || !source.sessionId || !source.messageId) continue;
    let location: unknown;
    try { location = JSON.parse(source.id.slice(0, source.id.lastIndexOf(":"))); } catch { continue; }
    if (!Array.isArray(location) || location.length !== 4 || location[0] !== source.sessionId
      || !Number.isSafeInteger(location[1]) || !Number.isSafeInteger(location[3]) || location[1] < 0 || location[3] < 0) continue;
    const session = await store.loadSession(source.sessionId);
    if (!object(session) || session.id !== source.sessionId || session.hiddenAlternative || session.generatedAlternative || !Array.isArray(session.messages)) continue;
    const original = session.messages[location[1]];
    if (!learner(original) || original.timestamp !== location[2] || messageId(original, location[1]) !== source.messageId) continue;
    const parts = blocks(original), part = parts[location[3]], message = parts.join("\n");
    if (typeof part !== "string" || message.length > 4000 || part.slice(source.start, source.end) !== source.text) continue;
    // Select an intact sentence/line from the shortlist, never invent a paraphrase.
    const sentence = /[^.!?\n]+(?:[.!?]+|$)/u.exec(source.text);
    if (!sentence) continue;
    const evidence = sentence[0].trim();
    if (evidence.length < 3 || evidence.length > 240) continue;
    const start = parts.slice(0, location[3]).reduce((sum, text) => sum + text.length + 1, 0)
      + source.start + sentence.index + sentence[0].indexOf(evidence);
    const candidate = { id: await hash(JSON.stringify([source.sessionId, source.messageId, message, start, evidence])),
      evidence, sessionId: source.sessionId, messageId: source.messageId, message, start, end: start + evidence.length };
    if (!candidates.some(row => row.id === candidate.id)) candidates.push(candidate);
  }
  return candidates;
}

export async function webMemorySourceCurrent(candidate: MemoryAdmissionCandidate, store: NeedleSessionStore): Promise<boolean> {
  const session = await store.loadSession(candidate.sessionId);
  if (!object(session) || session.id !== candidate.sessionId || session.hiddenAlternative || session.generatedAlternative || !Array.isArray(session.messages)) return false;
  const matches = session.messages.filter((message, index) => learner(message) && messageId(message, index) === candidate.messageId);
  if (matches.length !== 1) return false;
  const text = blocks(matches[0] as Record<string, unknown>).join("\n");
  return text === candidate.message && text.slice(candidate.start, candidate.end) === candidate.evidence;
}

interface BankRecord { revision: number; bank: MemoryBank; reviews: readonly { needleModel: string; decisions: readonly MemoryAdmissionDecision[] }[] }
export interface WebMemoryStore {
  read(scope: string): Promise<BankRecord>;
  commit(scope: string, revision: number, bank: MemoryBank, review: BankRecord["reviews"][number], current: () => boolean): Promise<boolean>;
}
const empty = (): BankRecord => ({ revision: 0, bank: [], reviews: [] });
function record(value: unknown): BankRecord {
  if (value === undefined) return empty();
  if (!object(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.bank) || !Array.isArray(value.reviews)
    || value.reviews.length > 8 || JSON.stringify(value).length > 2_000_000) throw new Error("memory_bank_invalid");
  const bank = admitMemoryBank(value.bank, [], { entries: {} });
  return { revision: value.revision as number, bank, reviews: value.reviews as BankRecord["reviews"] };
}

/** IndexedDB compare-and-swap protects another tab's bank; never shares the explicit profile store. */
export function createIndexedDbWebMemoryStore(factory: IDBFactory = indexedDB, name = "keating-memory-bank-v1"): WebMemoryStore {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => opened ??= new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("banks");
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = undefined; }; resolve(request.result); };
    request.onerror = () => { opened = undefined; reject(new Error("memory_storage_unavailable")); };
  });
  return {
    async read(scope) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("banks", "readonly"), request = tx.objectStore("banks").get(scope);
        let value: BankRecord;
        request.onsuccess = () => { try { value = record(request.result); } catch { tx.abort(); } };
        tx.oncomplete = () => resolve(value!);
        tx.onerror = tx.onabort = () => reject(new Error("memory_storage_unavailable"));
      });
    },
    async commit(scope, revision, bank, review, current) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("banks", "readwrite"), storage = tx.objectStore("banks"), request = storage.get(scope);
        let saved = false;
        request.onsuccess = () => {
          try {
            const before = record(request.result);
            if (!current() || before.revision !== revision) { tx.abort(); return; }
            const next = record({ revision: revision + 1, bank, reviews: [...before.reviews, structuredClone(review)].slice(-8) });
            storage.put(next, scope); saved = true;
          } catch { tx.abort(); }
        };
        tx.oncomplete = () => resolve(saved);
        tx.onabort = () => resolve(false);
        tx.onerror = () => reject(new Error("memory_storage_unavailable"));
      });
    },
  };
}

interface MemoryRuntime { runtime: WebJudgementRuntime; current: () => boolean }
async function configuredRuntime(): Promise<MemoryRuntime> {
  const store = webJudgementCalibrationStore(); await store.ensureLoaded();
  const generation = store.state().generation, settings = JSON.stringify(loadJudgementModelSettings());
  return { runtime: createWebJudgementRuntime(), current: () => store.current(generation) && JSON.stringify(loadJudgementModelSettings()) === settings };
}
/** Access token is only a volatile freshness guard. Only issuer + stable public account id are stored. */
export function createWebMemoryAccount(options: {
  client?: () => Pick<NonNullable<ReturnType<typeof notOrganicPublicClient>>, "config" | "getSession" | "request"> | null;
  storage?: () => Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
} = {}) {
  let captured: string | undefined, scope: string | null = null, pending: Promise<void> | null = null, retryAfter = 0;
  const now = options.now ?? Date.now;
  const cacheKey = "keating:memory-account-scope:v1";
  const cache = options.storage ?? (() => typeof localStorage === "undefined" ? null : localStorage);
  const session = () => {
    try { const client = (options.client ?? notOrganicPublicClient)(); return { client, token: client?.getSession()?.accessToken ?? null }; }
    catch { return { client: null, token: null }; }
  };
  const identity = (source: ReturnType<typeof session>) => JSON.stringify([source.client?.config.issuer ?? null, source.token]);
  return {
    current(): string | null { return captured === identity(session()) ? scope : null; },
    refresh(): Promise<void> {
      const source = session();
      const key = identity(source);
      if (captured !== key) { captured = key; scope = source.token ? null : "local-device"; retryAfter = 0; }
      if (!source.token || !source.client) return Promise.resolve();
      if (scope || pending || now() < retryAfter) return pending ?? Promise.resolve();
      const token = source.token, issuer = source.client.config.issuer;
      const current = () => captured === key && identity(session()) === key;
      pending = (async () => {
        try {
          const tokenSha256 = await hash(token);
          if (!current()) return;
          try {
            const text = cache()?.getItem(cacheKey);
            const saved: unknown = text && text.length <= 2048 ? JSON.parse(text) : null;
            if (object(saved) && saved.tokenSha256 === tokenSha256 && saved.issuer === issuer
              && typeof saved.accountId === "string" && !!saved.accountId.trim() && saved.accountId.length <= 256) {
              scope = JSON.stringify([issuer, saved.accountId]); return;
            }
          } catch { /* Storage unavailable: resolve the stable account normally. */ }
          const response = await source.client!.request("/v1/account", { signal: AbortSignal.timeout(5000) });
          const account: unknown = await response.json();
          if (!response.ok || !object(account)) return;
          const id = typeof account.did === "string" ? account.did : account.id;
          if (typeof id !== "string" || !id.trim() || id.length > 256 || !current()) return;
          scope = JSON.stringify([issuer, id]);
          try { cache()?.setItem(cacheKey, JSON.stringify({ tokenSha256, issuer, accountId: id })); } catch { /* Session memory still works. */ }
        } catch { /* Offline signed-in accounts wait for their own known identity. */ }
        finally { if (current() && !scope) retryAfter = now() + 5000; pending = null; }
      })();
      return pending;
    },
  };
}

/** Lifetime belongs to one agent. Noncooperative inference retains its lease after timeout. */
export function createWebMemoryAdmission(options: {
  sessions: NeedleSessionStore; current: () => boolean; requestIdentity: () => string;
  account?: ReturnType<typeof createWebMemoryAccount>; store?: WebMemoryStore;
  runtime?: () => Promise<MemoryRuntime>; enabled?: () => boolean; timeoutMs?: number;
  subscribe?: (listener: () => void) => () => void;
}) {
  const account = options.account ?? createWebMemoryAccount(), enabled = options.enabled ?? webMemoryAdmissionEnabled;
  let database: WebMemoryStore | undefined = options.store;
  const storage = () => database ??= createIndexedDbWebMemoryStore();
  let disposed = false, generation = 0, active: AbortController | undefined, pending = Promise.resolve();
  const leases = new Set<Promise<unknown>>();
  const cancel = () => { generation++; active?.abort(); };
  const unsubscribe = options.subscribe ? options.subscribe(cancel) : (() => {
    const a = subscribeWebMemoryAdmission(cancel), b = subscribeJudgementModelSettings(cancel), c = webJudgementCalibrationStore().subscribe(cancel);
    return () => { a(); b(); c(); };
  })();
  const applicable = () => !disposed && enabled() && options.current();
  const refresh = () => { if (applicable()) void account.refresh(); };
  const bounded = async <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => {
    let stop!: () => void;
    const abort = new Promise<never>((_, reject) => { stop = () => reject(new Error("cancelled")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); });
    try { return await Promise.race([work, abort]); } finally { signal.removeEventListener("abort", stop); }
  };
  async function exact(candidates: readonly MemoryAdmissionCandidate[], signal: AbortSignal): Promise<boolean> {
    for (const candidate of candidates) if (!await bounded(webMemorySourceCurrent(candidate, options.sessions), signal)) return false;
    return true;
  }
  return {
    refresh,
    /** The recall owner supplies a model/source generation guard valid beyond retrieval. */
    review(result: NeedleSearchResult, retrievalCurrent: () => boolean): void {
      refresh();
      const scope = account.current();
      if (!applicable() || !scope || leases.size || active || !retrievalCurrent()) return;
      const epoch = generation, request = options.requestIdentity(), abort = new AbortController(); active = abort;
      const current = () => applicable() && generation === epoch && !abort.signal.aborted && account.current() === scope
        && options.requestIdentity() === request && retrievalCurrent();
      const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 30_000);
      const source = structuredClone(result);
      pending = (async () => {
        try {
          const candidates = await bounded(webMemoryCandidates(source, options.sessions), abort.signal);
          if (!candidates.length || !current() || !await exact(candidates, abort.signal)) return;
          const configured = await bounded((options.runtime ?? configuredRuntime)(), abort.signal);
          // Calibration loading can publish a configuration event; a later retrieval retries safely.
          if (!current() || !configured.current()) return;
          const before = await bounded(storage().read(scope), abort.signal);
          const tiers = configured.runtime.policy.tiers.map(tier => ({ ...tier, call: ((request, signal) => {
            const promise = Promise.resolve().then(() => tier.call(request, signal));
            leases.add(promise); void promise.finally(() => leases.delete(promise)).catch(() => {}); return promise;
          }) as JudgementCaller }));
          const leasedOperation = createJudgementOperationCaller({ runtime: { ...configured.runtime, policy: { ...configured.runtime.policy, tiers } }, accept: () => true });
          const guardedCall: JudgementCaller = (request, signal) => current() && configured.current() ? leasedOperation(request, signal)
            : Promise.resolve({ ok: false, error: { code: "cancelled", retryable: false } });
          const decisions = await bounded(reviewMemoryCandidates(candidates, guardedCall, configured.runtime.policy.calibration, abort.signal), abort.signal);
          if (!current() || !configured.current() || !await exact(candidates, abort.signal) || !current()) return;
          const bank = admitMemoryBank(before.bank, decisions, configured.runtime.policy.calibration);
          await bounded(storage().commit(scope, before.revision, bank, { needleModel: source.model, decisions }, () => current() && configured.current()), abort.signal);
        } catch { /* Optional review never changes reply delivery or explicit profile facts. */ }
        finally { clearTimeout(timer); if (active === abort) active = undefined; }
      })();
    },
    /** Only bounded local reads may delay prompt assembly; admission and identity HTTP never do. */
    async prompt(): Promise<string> {
      refresh(); const scope = account.current();
      if (!applicable() || !scope) return "";
      const epoch = generation, request = options.requestIdentity(), abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 200);
      const current = () => applicable() && !abort.signal.aborted && epoch === generation && account.current() === scope && request === options.requestIdentity();
      try {
        const saved = await bounded(storage().read(scope), abort.signal);
        const live: MemoryAdmissionDecision[] = [];
        for (const row of saved.bank) {
          if (!current()) return "";
          if (await bounded(webMemorySourceCurrent(row.candidate, options.sessions), abort.signal)) live.push(row);
        }
        const prompt = current() ? memoryBankPrompt(live) : "";
        return prompt ? `\n\n${prompt}` : "";
      } catch { return ""; } finally { clearTimeout(timer); }
    },
    applicable,
    captureRequest: () => { refresh(); return { request: options.requestIdentity(), scope: account.current() }; },
    requestCurrent: (captured: { request: string; scope: string | null }) => !disposed && options.current()
      && captured.request === options.requestIdentity() && captured.scope === account.current(),
    settled: () => pending,
    dispose() { disposed = true; cancel(); unsubscribe(); },
  };
}
export type WebMemoryAdmission = ReturnType<typeof createWebMemoryAdmission>;
export function withWebMemoryBank(stream: NonNullable<AgentOptions["streamFn"]>, memory: WebMemoryAdmission): NonNullable<AgentOptions["streamFn"]> {
  return (model, context, options) => {
    if (!memory.applicable()) return stream(model, context, options);
    return (async () => {
      const captured = memory.captureRequest();
      const prompt = await memory.prompt(); options?.signal?.throwIfAborted();
      if (!memory.requestCurrent(captured)) throw new DOMException("The learner request changed while memory was loading.", "AbortError");
      return stream(model, prompt ? { ...context, systemPrompt: `${context.systemPrompt ?? ""}${prompt}` } : context, options);
    })();
  };
}
