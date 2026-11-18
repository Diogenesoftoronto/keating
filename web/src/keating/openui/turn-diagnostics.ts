import { learningSourceHash } from "@keating/learner-contracts";
import { NATIVE_PAGE_STAGES, parseOpenUiDiagnosticExport, type NativePageEvidence, type OpenUiDiagnosticTurn } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { createSessionId } from "../../hooks/session-metadata";

type Capture = (event: string, properties: Record<string, unknown>) => void;
interface StoredTurn {
  key: string;
  owner: string;
  revision: number;
  assistant: string | null;
  /** Local attribution only. Keys hash originating message, tool call and page together. */
  nativeRefs?: Record<string, Partial<NativePageEvidence>>;
  nativeRefsComplete?: false;
  row: OpenUiDiagnosticTurn;
}
const DATABASE = "keating-openui-turn-diagnostics";
const EMPTY: readonly OpenUiDiagnosticTurn[] = [];

/** Preserve app-issued UUIDs. Project imported identifiers to opaque device-side keys. */
export function diagnosticConversationId(sessionId: string): string {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)
    ? sessionId : `conversation-${learningSourceHash(sessionId).split(":").at(-1)}`;
}
export function diagnosticSourceId(id: string): string {
  return learningSourceHash(id).split(":").at(-1)!;
}

function readRecord(value: unknown): StoredTurn | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StoredTurn>;
  if (typeof record.key !== "string" || typeof record.owner !== "string" || !Number.isSafeInteger(record.revision)
    || (record.assistant !== null && typeof record.assistant !== "string")) return null;
  try {
    const [row] = parseOpenUiDiagnosticExport([record.row]);
    if (!row || record.key !== JSON.stringify([row.conversationId, row.turnId])) return null;
    const nativeRefs = record.nativeRefs && Object.entries(record.nativeRefs).every(([id, flags]) =>
      /^[a-f\d]{16}$/u.test(id) && !!flags && Object.entries(flags).every(([k, v]) => NATIVE_PAGE_STAGES.some(key => key === k) && typeof v === "boolean"))
      ? record.nativeRefs : undefined;
    return { key: record.key, owner: record.owner, revision: record.revision!, assistant: record.assistant!, row, nativeRefs,
      ...(record.nativeRefsComplete === false ? { nativeRefsComplete: false } : {}) };
  } catch { return null; }
}

/** Only explicit schema fields reach the opt-out-aware product analytics client. */
export function openUIDiagnosticEvent(row: OpenUiDiagnosticTurn, revision: number): Record<string, unknown> {
  return {
    diagnostic_schema: 1, diagnostic_revision: revision,
    conversation_id: row.conversationId, turn_id: row.turnId, turn_index: row.turnIndex,
    model: row.model, requested_model: row.requestedModel ?? null, decision_mode: row.mode, cue_kind: row.cue.kind, cue_targets: row.cue.targets,
    cue_repeat: row.cue.repeat ?? false,
    reply_outcome: row.reply, reply_elapsed_ms: row.replyElapsedMs ?? null, ui_attempted: row.attempted, outside_words: row.outsideWords ?? null,
    native_page_requested: row.nativePageRequested ?? null, native_page: row.nativePage ?? null, guidance_reason: row.guidance?.reason ?? null,
    editable_code: row.editableCode ?? null, cue_code_language: row.cue.codeLanguage ?? null, guidance_code_language: row.guidance?.codeLanguage ?? null,
    coding_challenge_languages: row.codingChallengeLanguages ?? null,
    editor_outside_words: row.editorOutsideWords ?? null,
    compiled_components: row.compiled, selected_components: row.selected, rendered_components: row.rendered,
    guidance_source: row.guidance?.source ?? null, guidance_action: row.guidance?.action ?? null,
    guidance_delivered: row.guidance?.delivered ?? null, guidance_targets: row.guidance?.targets ?? null,
    draft_attempts: row.draftAttempts ?? null, gate_issues: row.gateIssues ?? null, decision_model: row.decisionModel ?? null,
    draft_selection: row.selection ?? null,
    draft_pair_reviews: row.pairReviews ?? null,
    draft_final_comparison: row.finalComparison ?? null,
    assessment_opt_out: row.assessment?.optOut ?? null, assessment_checkpoints: row.assessment?.checkpoints ?? null,
  };
}

type Change = (previous: StoredTurn | null) => StoredTurn | null;

/** The latest 500 physical turns recorded by this browser profile, across conversations. */
export const OPENUI_DIAGNOSTIC_HISTORY_LIMIT = 500;

export function createOpenUIDiagnosticStore(factory: () => IDBFactory | undefined, broadcast = false, limit = OPENUI_DIAGNOSTIC_HISTORY_LIMIT) {
  const cache = new Map<string, StoredTurn>();
  const byAssistant = new Map<string, Set<string>>();
  const byNative = new Map<string, Set<string>>();
  const listeners = new Set<() => void>();
  const captures = new Map<string, Capture>();
  const earlyNative = new Map<string, Map<string, Partial<NativePageEvidence>>>();
  let rows: readonly OpenUiDiagnosticTurn[] = EMPTY;
  let connection: Promise<IDBDatabase | null> | undefined;
  let pending: Promise<void> = Promise.resolve();
  let channel: BroadcastChannel | undefined;

  function publish() {
    if (cache.size > limit) {
      const older = [...cache.values()].sort((a, b) => a.revision - b.revision || (a.key < b.key ? -1 : 1));
      for (const record of older.slice(0, cache.size - limit)) cache.delete(record.key);
    }
    const values = [...cache.values()];
    rows = values.map(item => item.row).sort((a, b) =>
      a.conversationId.localeCompare(b.conversationId) || a.turnIndex - b.turnIndex || a.turnId.localeCompare(b.turnId));
    byAssistant.clear();
    byNative.clear();
    for (const record of values) {
      for (const ref of Object.keys(record.nativeRefs ?? {})) {
        const id = record.row.conversationId + "/" + ref;
        if (!byNative.has(id)) byNative.set(id, new Set());
        byNative.get(id)!.add(record.key);
      }
      if (!record.assistant || (record.row.reply !== "released" && record.row.reply !== "withheld")) continue;
      const key = `${record.row.conversationId}/${record.assistant}`;
      if (!byAssistant.has(key)) byAssistant.set(key, new Set());
      byAssistant.get(key)!.add(record.key);
    }
    for (const listener of listeners) { try { listener(); } catch { /* A failed subscriber cannot interrupt recording. */ } }
  }

  function connect(): Promise<IDBDatabase | null> {
    if (connection) return connection;
    connection = new Promise<IDBDatabase | null>(resolve => {
      let open: IDBOpenDBRequest;
      try {
        const idb = factory();
        if (!idb) { resolve(null); return; }
        open = idb.open(DATABASE, 2);
      } catch { resolve(null); return; }
      open.onupgradeneeded = () => {
        const table = open.result.objectStoreNames.contains("turns") ? open.transaction!.objectStore("turns")
          : open.result.createObjectStore("turns", { keyPath: "key" });
        if (!table.indexNames.contains("revision")) table.createIndex("revision", "revision");
      };
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        const load = db.transaction("turns").objectStore("turns").getAll();
        load.onerror = () => resolve(db);
        load.onsuccess = () => {
          for (const value of load.result) {
            const record = readRecord(value);
            if (record) cache.set(record.key, record);
          }
          publish();
          resolve(db);
        };
      };
    });
    if (broadcast && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" && !channel) {
      try {
        channel = new BroadcastChannel(DATABASE);
        channel.onmessage = event => {
          const record = readRecord(event.data);
          if (record && record.revision > (cache.get(record.key)?.revision ?? 0)) {
            cache.set(record.key, record);
            publish();
          }
        };
      } catch { /* IndexedDB remains available without cross-tab notification. */ }
    }
    return connection;
  }

  function commit(previous: StoredTurn | null, next: StoredTurn | null, capture?: Capture) {
    if (!next || previous === next) return;
    if (next.revision > (cache.get(next.key)?.revision ?? 0)) { cache.set(next.key, next); publish(); }
    try { channel?.postMessage(next); } catch { /* The local commit remains valid. */ }
    try { capture?.("openui_turn_observed", openUIDiagnosticEvent(next.row, next.revision)); }
    catch { /* Analytics transport must not interrupt a lesson. */ }
  }

  function update(key: string, conversationId: string, change: Change) {
    const capture = captures.get(conversationId);
    pending = pending.then(async () => {
      const db = await connect();
      if (!db) {
        const previous = cache.get(key) ?? null;
        commit(previous, change(previous), capture);
        return;
      }
      // One readwrite transaction arbitrates replayed renders and racing tabs.
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("turns", "readwrite");
        const table = tx.objectStore("turns");
        const read = table.get(key);
        let previous: StoredTurn | null = null, next: StoredTurn | null = null;
        read.onsuccess = () => {
          previous = readRecord(read.result);
          next = change(previous);
          if (!next || next === previous) return;
          table.put(next);
          if (!previous) {
            const count = table.count();
            count.onsuccess = () => {
              let excess = count.result - limit;
              if (excess < 1) return;
              const cursor = table.index("revision").openKeyCursor();
              cursor.onsuccess = () => {
                if (!cursor.result || excess < 1) return;
                table.delete(cursor.result.primaryKey);
                if (--excess > 0) cursor.result.continue();
              };
            };
          }
        };
        tx.oncomplete = () => { commit(previous, next, capture); resolve(); };
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    }).catch(() => {
      // Storage restrictions or quota failures still permit an in-memory feed.
      connection = Promise.resolve(null);
      try {
        const previous = cache.get(key) ?? null;
        commit(previous, change(previous), capture);
      } catch { /* Recording is independent of lesson execution. */ }
    });
  }

  return {
    getRows(): readonly OpenUiDiagnosticTurn[] { void connect(); return rows; },
    subscribe(listener: () => void) { listeners.add(listener); void connect(); return () => { listeners.delete(listener); }; },
    async settled() {
      await connect();
      let observed: Promise<void>;
      do { observed = pending; await observed; } while (observed !== pending);
    },
    registerCapture(conversationId: string, capture: Capture) {
      captures.set(conversationId, capture);
      return () => { if (captures.get(conversationId) === capture) captures.delete(conversationId); };
    },
    awaitingRender(conversationId: string, sourceIds: readonly string[]) {
      if (sourceIds.length !== 1) return false;
      const found = byAssistant.get(`${conversationId}/${diagnosticSourceId(sourceIds[0]!)}`);
      if (found?.size !== 1) return false;
      const [key] = found;
      return cache.get(key!)?.row.rendered === null;
    },
    begin(row: OpenUiDiagnosticTurn) {
      const key = JSON.stringify([row.conversationId, row.turnId]);
      const owner = createSessionId();
      // Tool cards can mount and disappear while the final tutor call is still running.
      // Keep only local opaque refs from this attempt. Finish joins exact attached pages.
      const early = new Map<string, Partial<NativePageEvidence>>();
      earlyNative.set(row.conversationId, early);
      update(key, row.conversationId, previous => ({ key, owner,
        revision: Math.max(Date.now(), (previous?.revision ?? 0) + 1), assistant: null, row }));
      return (nextRow: OpenUiDiagnosticTurn, assistant: string | null, nativeRefs: readonly string[] = [], complete = true) => {
        update(key, row.conversationId, previous => {
          if (earlyNative.get(row.conversationId) === early) earlyNative.delete(row.conversationId);
          if (!previous || previous.owner !== owner) return previous;
          if (!nativeRefs.length || !nextRow.nativePage) return { key, owner, revision: previous.revision + 1, row: nextRow, assistant };
          const flags = nativeRefs.map(ref => early.get(ref) ?? {});
          const native = { ...nextRow.nativePage };
          for (const stage of NATIVE_PAGE_STAGES) {
            if (flags.some(f => f[stage] === true)) native[stage] = true;
            else if (complete && native[stage] !== true && flags.every(f => f[stage] === false)) native[stage] = false;
          }
          return { key, owner, revision: previous.revision + 1, row: { ...nextRow, nativePage: native }, assistant,
            nativeRefs: Object.fromEntries(nativeRefs.map((ref, i) => [ref, flags[i]!])), ...(complete ? {} : { nativeRefsComplete: false }) };
        });
      };
    },
    nativeObservation(conversationId: string, refs: readonly string[], flags: Partial<NativePageEvidence>) {
      const matches = refs.flatMap(ref => [...(byNative.get(conversationId + "/" + ref) ?? [])]
        .map(key => ({ record: cache.get(key)!, ref })));
      if (matches.length !== 1) {
        const early = earlyNative.get(conversationId);
        if (matches.length === 0 && refs.length === 1 && early && (early.has(refs[0]!) || early.size < 64)) {
          const previous = early.get(refs[0]!) ?? {};
          for (const key of NATIVE_PAGE_STAGES) if (typeof flags[key] === "boolean" && previous[key] !== true) previous[key] = flags[key];
          early.set(refs[0]!, previous);
        }
        return false;
      }
      const { record, ref } = matches[0]!;
      const changed = (previous: Partial<NativePageEvidence>) => NATIVE_PAGE_STAGES.filter(key => typeof flags[key] === "boolean"
        && previous[key] !== true && previous[key] !== flags[key]);
      if (!changed(record.nativeRefs![ref]!).length) return true;
      update(record.key, conversationId, previous => {
        if (previous?.owner !== record.owner || !previous.nativeRefs?.[ref] || !previous.row.nativePage) return previous;
        const keys = changed(previous.nativeRefs[ref]);
        if (!keys.length) return previous;
        const entry = { ...previous.nativeRefs[ref] }, native = { ...previous.row.nativePage };
        const nativeRefs = { ...previous.nativeRefs, [ref]: entry };
        for (const key of keys) {
          entry[key] = flags[key];
          if (flags[key] === true) native[key] = true;
          else if (previous.nativeRefsComplete !== false && native[key] !== true && Object.values(nativeRefs).every(page => page[key] === false)) native[key] = false;
        }
        return { ...previous, nativeRefs, revision: previous.revision + 1, row: { ...previous.row, nativePage: native } };
      });
      return true;
    },
    rendered(conversationId: string, sourceIds: readonly string[], components: readonly string[]) {
      // A projected row can coalesce several assistant rounds. Only an unambiguous
      // single original assistant row can be attributed to a final reply.
      if (sourceIds.length !== 1) return;
      const found = byAssistant.get(`${conversationId}/${diagnosticSourceId(sourceIds[0]!)}`);
      if (found?.size !== 1) return;
      const [key] = found;
      const current = cache.get(key!)!;
      const rendered = [...new Set(components)].sort();
      if (current.row.rendered !== null) return;
      update(key!, conversationId, previous => {
        if (!previous || previous.owner !== current.owner || previous.assistant !== current.assistant
          || previous.row.reply !== current.row.reply || previous.row.rendered !== null) return previous;
        return { ...previous, revision: previous.revision + 1, row: { ...previous.row, rendered } };
      });
    },
  };
}

export const openUIDiagnosticStore = createOpenUIDiagnosticStore(() =>
  typeof window === "undefined" ? undefined : window.indexedDB, true);
export const getOpenUIDiagnosticTurns = openUIDiagnosticStore.getRows;
export const subscribeOpenUIDiagnosticTurns = openUIDiagnosticStore.subscribe;
