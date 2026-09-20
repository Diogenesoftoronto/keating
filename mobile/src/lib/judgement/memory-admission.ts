/** Optional durable proxy memory; explicit learner profiles are a separate store. */
import { admitMemoryBank, memoryBankPrompt, reviewMemoryCandidates, type MemoryBank, type MemoryAdmissionCandidate,
  type MemoryAdmissionDecision, type NeedleSearchResult, type JudgementCaller } from "@keating/learner-contracts";
import type { ChatSession } from "../types";
import type { MobileJudgementRuntime } from "./runtime";

type Digest = (text: string) => Promise<string>;
const digest: Digest = async text => {
  const crypto = await import("expo-crypto");
  return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, text);
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);

function original(sessions: readonly ChatSession[], sessionId: string, messageId: string) {
  if (!Array.isArray(sessions) || sessions.length > 4096) return null;
  const matches = sessions.filter(session => session.id === sessionId);
  if (matches.length !== 1 || !Array.isArray(matches[0].messages) || matches[0].messages.length > 20000) return null;
  const messages = matches[0].messages.filter((message: ChatSession["messages"][number]) => message.id === messageId);
  const message = messages[0];
  return messages.length === 1 && message.role === "user" && typeof message.content === "string" && message.content.length <= 4000
    && message.content.trim() && !message.content.includes("\0") ? message : null;
}

/** Source windows carry exact UTF-16 offsets into one complete original user message. */
export async function mobileMemoryCandidates(result: NeedleSearchResult, sessions: readonly ChatSession[], hash: Digest = digest): Promise<MemoryAdmissionCandidate[]> {
  if (!result || typeof result.model !== "string" || !result.model.trim() || result.model.length > 512 || !Array.isArray(result.matches) || result.matches.length > 4) return [];
  const candidates: MemoryAdmissionCandidate[] = [];
  for (const match of result.matches) {
    const source = match?.source;
    if (!source || source.kind !== "learner-message" || !validId(source.sessionId) || !validId(source.messageId)
      || typeof source.text !== "string" || !source.text || source.text.length > 500
      || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.start < 0 || source.end - source.start !== source.text.length) continue;
    const message = original(sessions, source.sessionId, source.messageId);
    if (!message || message.content.slice(source.start, source.end) !== source.text) continue;
    // Start with complete original sentences; a window beginning mid-sentence cannot invent a standalone quote.
    for (const sentence of message.content.matchAll(/[^.!?\n]+(?:[.!?]+|$)/gu)) {
      const evidence = sentence[0].trim();
      const start = sentence.index + sentence[0].indexOf(evidence), end = start + evidence.length;
      if (evidence.length < 3 || evidence.length > 240 || start < source.start || end > source.end) continue;
      const candidate = { id: await hash(JSON.stringify([source.sessionId, source.messageId, message.content, start, evidence])),
        evidence, sessionId: source.sessionId, messageId: source.messageId, message: message.content, start, end };
      if (!candidates.some(row => row.id === candidate.id)) candidates.push(candidate);
      break;
    }
  }
  return candidates;
}
export function mobileMemorySourceCurrent(candidate: MemoryAdmissionCandidate, sessions: readonly ChatSession[]): boolean {
  const message = original(sessions, candidate.sessionId, candidate.messageId);
  return !!message && message.content === candidate.message && message.content.slice(candidate.start, candidate.end) === candidate.evidence;
}

export interface MobileMemoryRecord {
  revision: number;
  bank: MemoryBank;
  reviews: readonly { needleModel: string; decisions: readonly MemoryAdmissionDecision[] }[];
}
export interface MobileMemoryStore {
  read(scope: string): Promise<MobileMemoryRecord>;
  commit(scope: string, revision: number, bank: MemoryBank, review: MobileMemoryRecord["reviews"][number], current: () => boolean): Promise<boolean>;
}
export interface MobileMemoryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
const empty = (): MobileMemoryRecord => ({ revision: 0, bank: [], reviews: [] });
function parseRecord(raw: string | null): MobileMemoryRecord {
  if (raw === null) return empty();
  if (raw.length > 2_000_000 || new TextEncoder().encode(raw).byteLength > 2_000_000) throw new Error("memory_bank_invalid");
  const value: unknown = JSON.parse(raw);
  if (!object(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.bank)
    || !Array.isArray(value.reviews) || value.reviews.length > 8 || value.reviews.some(review => !object(review)
      || typeof review.needleModel !== "string" || !review.needleModel || review.needleModel.length > 512
      || !Array.isArray(review.decisions) || review.decisions.length > 4)) throw new Error("memory_bank_invalid");
  return { revision: value.revision as number, bank: admitMemoryBank(value.bank, [], { entries: {} }), reviews: value.reviews as MobileMemoryRecord["reviews"] };
}

// All default-store instances share this serialization boundary within the mobile JS runtime.
let storageQueue: Promise<unknown> = Promise.resolve();
export function createAsyncStorageMobileMemoryStore(storage: MobileMemoryStorage, hash: Digest = digest): MobileMemoryStore {
  const key = async (scope: string) => {
    if (typeof scope !== "string" || !scope.trim() || scope.length > 1024) throw new Error("memory_scope_invalid");
    return `keating:proxy-memory:v1:${await hash(scope)}`;
  };
  return {
    async read(scope) { return parseRecord(await storage.getItem(await key(scope))); },
    commit(scope, revision, bank, review, current) {
      const work = storageQueue.catch(() => {}).then(async () => {
        const name = await key(scope), raw = await storage.getItem(name), before = parseRecord(raw);
        if (!current() || before.revision !== revision) return false;
        const encoded = JSON.stringify({ revision: revision + 1, bank, reviews: [...before.reviews, structuredClone(review)].slice(-8) });
        parseRecord(encoded);
        if (!current()) return false;
        await storage.setItem(name, encoded);
        const saved = await storage.getItem(name);
        if (saved !== encoded) throw new Error("memory_storage_write_failed");
        if (current()) return true;
        // AsyncStorage has no transaction API. Restore only our exact value, under the shared write lease.
        if (await storage.getItem(name) === encoded) {
          if (raw === null) await storage.removeItem(name); else await storage.setItem(name, raw);
        }
        return false;
      });
      storageQueue = work;
      return work;
    },
  };
}
let defaultStore: Promise<MobileMemoryStore> | null = null;
function memoryStore() {
  return defaultStore ??= import("@react-native-async-storage/async-storage")
    .then(module => createAsyncStorageMobileMemoryStore(module.default));
}

export function createMobileMemoryAdmission(options: {
  sessions: () => readonly ChatSession[]; scope: () => string | null; enabled: () => boolean;
  current: () => boolean; requestIdentity: () => string;
  /** Include account, source, opt-in, judgement-setting and calibration changes. */
  subscribe?: (listener: () => void) => () => void;
  runtime?: () => Promise<MobileJudgementRuntime>; store?: MobileMemoryStore; hash?: Digest; timeoutMs?: number;
}) {
  let disposed = false, generation = 0, active: AbortController | null = null, pending: Promise<void> = Promise.resolve();
  const leases = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    leases.add(work); void work.finally(() => leases.delete(work)).catch(() => {}); return work;
  };
  const applicable = () => !disposed && options.enabled() && options.current();
  const cancel = () => { generation++; active?.abort(); };
  const unsubscribe = options.subscribe?.(cancel);
  const storage = () => options.store ? Promise.resolve(options.store) : memoryStore();
  const snapshot = () => ({ scope: options.scope(), request: options.requestIdentity(), generation });
  const requestCurrent = (captured: ReturnType<typeof snapshot>) => applicable() && !!captured.scope
    && options.scope() === captured.scope && options.requestIdentity() === captured.request && generation === captured.generation;
  const bounded = async <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => {
    let stop!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      stop = () => reject(new Error("memory_operation_cancelled"));
      signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    });
    try { return await Promise.race([work, cancelled]); } finally { signal.removeEventListener("abort", stop); }
  };
  return {
    applicable, cancel, captureRequest: snapshot, requestCurrent,
    review(result: NeedleSearchResult, retrievalCurrent: () => boolean): void {
      if (!applicable() || leases.size || active || !retrievalCurrent()) return;
      const captured = snapshot();
      if (!captured.scope) return;
      // Candidate extraction bounds and copies only exact source text before the first model stage.
      const controller = active = new AbortController();
      const current = () => requestCurrent(captured) && !controller.signal.aborted && retrievalCurrent();
      const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(options.timeoutMs ?? 30000, 30000)));
      pending = (async () => {
        try {
          const needleModel = result.model;
          const candidates = await bounded(mobileMemoryCandidates(result, options.sessions(), options.hash), controller.signal);
          const exact = () => candidates.every(candidate => mobileMemorySourceCurrent(candidate, options.sessions()));
          if (!candidates.length || !current() || !exact()) return;
          const runtime = await bounded(options.runtime ? options.runtime() : import("./runtime").then(module => module.configuredMobileJudgementRuntime()), controller.signal);
          if (!(runtime.enabled ?? runtime.hostedEnabled) || !current() || !exact()) return;
          const store = await bounded(storage(), controller.signal), before = await bounded(store.read(captured.scope!), controller.signal);
          const call: JudgementCaller = (request, signal) => {
            if (!current() || !exact()) return Promise.resolve({ ok: false, error: { code: "cancelled", retryable: false } });
            const work = Promise.resolve().then(() => current() && exact() ? runtime.call(request, signal)
              : { ok: false as const, error: { code: "cancelled" as const, retryable: false } });
            return track(work);
          };
          const decisions = await bounded(reviewMemoryCandidates(candidates, call, runtime.policy.calibration, controller.signal), controller.signal);
          if (!current() || !exact()) return;
          const bank = admitMemoryBank(before.bank, decisions, runtime.policy.calibration);
          await bounded(track(store.commit(captured.scope!, before.revision, bank, { needleModel, decisions }, () => current() && exact())), controller.signal);
        } catch { /* Optional background admission cannot block or rewrite the learner's reply. */ }
        finally { clearTimeout(timer); if (active === controller) active = null; }
      })();
    },
    async prompt(): Promise<string> {
      const captured = snapshot();
      if (!requestCurrent(captured)) return "";
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 200);
      try {
        const store = await bounded(storage(), controller.signal), saved = await bounded(store.read(captured.scope!), controller.signal);
        if (controller.signal.aborted || !requestCurrent(captured)) return "";
        const live = saved.bank.filter(row => mobileMemorySourceCurrent(row.candidate, options.sessions()));
        const prompt = memoryBankPrompt(live);
        return !controller.signal.aborted && requestCurrent(captured) && prompt ? `\n\n${prompt}` : "";
      } catch { return ""; } finally { clearTimeout(timer); }
    },
    settled: () => pending,
    dispose() { disposed = true; cancel(); unsubscribe?.(); },
  };
}
export type MobileMemoryAdmission = ReturnType<typeof createMobileMemoryAdmission>;
