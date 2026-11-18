import { learningSourceHash } from "@keating/learner-contracts";
import { NATIVE_PAGE_STAGES, type NativePageEvidence } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { parseInteractiveSegments } from "../../components/interactive-segments";
import { parseTutorPagePayload } from "../interactive-page/tutor-page";
import { learningMessageId } from "../learning-intelligence/source-navigation";

export type NativeMessage = { role?: string; stopReason?: string; content?: unknown; parts?: unknown; toolCallId?: string; toolName?: string; isError?: boolean };
export type NativeResultEvent = { type: string; toolCallId?: string; toolName?: string; result?: { content?: unknown }; isError?: boolean };
const parsed = new WeakMap<object, readonly string[]>();
const savedResults = new WeakSet<object>();
export function nativeOriginKey(source: string, call: string, page: string) {
  return learningSourceHash(JSON.stringify([source, call, page])).split(":").at(-1)!;
}
export const nativeEvidence = (value: boolean | null): NativePageEvidence =>
  Object.fromEntries(NATIVE_PAGE_STAGES.map(key => [key, value])) as NativePageEvidence;

/** Only a validated result tag from the matched native tool is evidence. Its text never leaves this function. */
function pages(result: { content?: unknown }, failed?: boolean): readonly string[] | null {
  if (failed) return [];
  const cached = parsed.get(result);
  if (cached) return cached;
  const content = result.content;
  if (typeof content !== "string" && !Array.isArray(content)) return null;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.flatMap(p => p?.type === "text" && typeof p.text === "string" ? [p.text] : []).join("\n") : "";
  const ids: string[] = [];
  if (text.includes("<keating-interactive")) for (const part of parseInteractiveSegments(text)) {
    if (part.type !== "interactive") continue;
    try { const payload = parseTutorPagePayload(JSON.parse(part.json)); if (payload) ids.push(payload.id); } catch { /* Malformed tag. */ }
  }
  parsed.set(result, ids);
  return ids;
}

export function noteNativeToolEvent(events: Map<string, boolean>, event: NativeResultEvent) {
  if (event.type !== "tool_execution_end" || event.toolName !== "interactive_page" || !event.toolCallId) return;
  const ids = event.isError ? [] : event.result ? pages(event.result) : null;
  if (ids !== null) events.set(event.toolCallId, ids.length > 0);
}

type Call = { id: string; source: string; author: NativeMessage; result?: NativeMessage; duplicate: boolean };
function callsIn(messages: readonly NativeMessage[], start: number, end: number) {
  const calls = new Map<string, Call>();
  for (let i = start; i < end; i++) {
    const m = messages[i]!;
    if (m.role === "assistant" && (m.stopReason === "toolUse" || m.stopReason === "stop")) {
      const parts = m.content ?? m.parts;
      if (Array.isArray(parts)) for (const p of parts) {
        if (p?.type !== "toolCall" || p.name !== "interactive_page" || typeof p.id !== "string" || !p.id) continue;
        const earlier = calls.get(p.id);
        if (earlier) earlier.duplicate = true;
        else calls.set(p.id, { id: p.id, source: learningMessageId(m, i), author: m, duplicate: false });
      }
    } else if (m.role === "toolResult" && m.toolName === "interactive_page" && m.toolCallId) {
      const call = calls.get(m.toolCallId);
      if (call?.result) call.duplicate = true;
      else if (call) call.result = m;
    }
  }
  return [...calls.values()];
}

/** Coalesced or restored display rows may have a different timestamp. Join only unique native tool calls. */
export function nativeRowOrigins(rows: readonly { content?: unknown }[], originals: readonly NativeMessage[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!Array.isArray(row.content)) continue;
    for (const part of row.content) {
      if (part?.type === "tool-call" && part.toolName === "interactive_page" && typeof part.toolCallId === "string")
        counts.set(part.toolCallId, 1 + (counts.get(part.toolCallId) ?? 0));
    }
  }
  const origins = new Map<string, string>();
  if (!counts.size) return origins;
  for (const call of callsIn(originals, 0, originals.length)) {
    if (!call.duplicate && counts.get(call.id) === 1) origins.set(call.id, call.source);
  }
  return origins;
}

export function readNativeTurn(messages: readonly NativeMessage[], start: number, end: number,
  events: ReadonlyMap<string, boolean>, owns: (author: NativeMessage) => boolean, requested: boolean | null) {
  const calls = callsIn(messages, start, end).filter(c => owns(c.author));
  const evidence = nativeEvidence(requested === false ? false : null);
  const refs: string[] = [];
  if (!calls.length) return { evidence, refs, complete: requested === false };
  const outcomes: (boolean | undefined)[] = [], attachments: (boolean | undefined)[] = [];
  const missingId = messages.slice(start, end).some(m => {
    const parts = m.content ?? m.parts;
    return m.role === "assistant" && (m.stopReason === "toolUse" || m.stopReason === "stop") && owns(m) && Array.isArray(parts)
      && parts.some(p => p?.type === "toolCall" && p.name === "interactive_page" && (typeof p.id !== "string" || !p.id));
  });
  if (missingId) { outcomes.push(undefined); attachments.push(undefined); }
  for (const call of calls) {
    if (call.duplicate) { outcomes.push(undefined); attachments.push(undefined); continue; }
    const ids = call.result ? pages(call.result, call.result.isError) : undefined;
    const succeeded = ids ? ids.length > 0 : events.get(call.id);
    outcomes.push(succeeded);
    attachments.push(ids ? ids.length > 0 : succeeded === false ? false : undefined);
    for (const id of ids ?? []) refs.push(nativeOriginKey(call.source, call.id, id));
    if (ids?.length && call.result && savedResults.has(call.result)) evidence.saved = true;
  }
  const any = (values: (boolean | undefined)[], wanted: boolean) => values.includes(wanted) ? true : values.includes(undefined) ? null : false;
  evidence.succeeded = any(outcomes, true);
  evidence.failed = any(outcomes, false);
  evidence.attached = any(attachments, true);
  if (evidence.attached === false) {
    for (const key of NATIVE_PAGE_STAGES) if (key !== "failed" && key !== "succeeded") evidence[key] = false;
  }
  return { evidence, refs: [...new Set(refs)], complete: !attachments.includes(undefined) };
}

/** `saveSessionSnapshot` supplies only the messages in the successfully written snapshot. */
export function savedNativePageRefs(messages: readonly NativeMessage[]): string[] {
  const refs: string[] = [];
  if (!messages.some(m => m.role === "toolResult" && m.toolName === "interactive_page" && !savedResults.has(m))) return refs;
  let start = 0;
  for (let end = 0; end <= messages.length; end++) {
    if (end < messages.length && messages[end]?.role !== "user" && messages[end]?.role !== "user-with-attachments") continue;
    for (const call of callsIn(messages, start, end)) {
      if (call.duplicate || !call.result || savedResults.has(call.result)) continue;
      savedResults.add(call.result);
      for (const id of pages(call.result, call.result.isError) ?? []) refs.push(nativeOriginKey(call.source, call.id, id));
    }
    start = end + 1;
  }
  return refs;
}
