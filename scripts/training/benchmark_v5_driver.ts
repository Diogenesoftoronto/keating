/** Teaching v5 episode driver: reactive scripted learners and a compact transcript.
 *
 * Runs one v5 instance through the unchanged v3 harness (`runHarnessEpisode`) in controller mode. After
 * every step the controller picks the next learner turn; a message step with `branches` sends the first
 * branch whose condition holds on the tutor's visible reply to the previous learner message, else its
 * default `text`. Conditions are deterministic and recorded, so an episode replays exactly from its
 * transcript. The full harness receipt (gigabytes of streaming events) is not written unless --raw.
 *
 * Usage: bun benchmark_v5_driver.ts REQUEST.json OUT_DIR [--raw]
 * REQUEST is produced by `benchmark_v5.py request`; it never contains rubrics or references.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { runHarnessEpisode, type HarnessV3Step } from "./benchmark_harness_v3.ts";

type Condition =
  | { if: "no_visible_reply" }
  | { if: "asked_question" }
  | { if: "mentions"; any: string[] }
  | { if: "tool_called"; name: string };
type Branch = { when: Condition; negate?: boolean; text: string; id: string };
type V5Step = { kind: "message"; text: string; branches?: Branch[] } | { kind: "reopen" } | { kind: "new_session" };
type V5Request = { schema: "keating-teaching-v5-request/v1"; instance_id: string; steps: V5Step[];
  capture_files_after: number[]; harness: Record<string, unknown> };

const TOOL_RESULT_CHARS = 2000, TOOL_ARG_CHARS = 1500, FILE_CHARS = 6000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const clip = (v: unknown, n: number) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length <= n ? s : `${s.slice(0, n)} …[${s.length - n} more chars]`; };

export function visibleText(messages: any[]): string {
  return messages.filter(m => m?.role === "assistant").flatMap(m => Array.isArray(m.content) ? m.content : [])
    .filter((p: any) => p?.type === "text" && typeof p.text === "string").map((p: any) => p.text).join("\n").trim();
}

export function toolCalls(messages: any[]): string[] {
  return messages.filter(m => m?.role === "assistant").flatMap(m => Array.isArray(m.content) ? m.content : [])
    .filter((p: any) => p?.type === "toolCall").map((p: any) => String(p.name));
}

export function holds(c: Condition, messages: any[]): boolean {
  const text = visibleText(messages);
  switch (c.if) {
    case "no_visible_reply": return text === "";
    case "asked_question": return text.includes("?");
    case "mentions": return c.any.some(p => new RegExp(p, "i").test(text));
    case "tool_called": return toolCalls(messages).includes(c.name);
  }
}

export function choose(step: V5Step, previousTutor: any[] | null): { step: HarnessV3Step; branch: string | null } {
  if (step.kind !== "message") return { step, branch: null };
  for (const b of step.branches ?? []) {
    if (previousTutor && holds(b.when, previousTutor) !== Boolean(b.negate)) return { step: { kind: "message", text: b.text }, branch: b.id };
  }
  return { step: { kind: "message", text: step.text }, branch: null };
}

function compactMessage(m: any) {
  const parts = (Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }]).flatMap((p: any) =>
    p.type === "text" && p.text ? [{ text: m.role === "toolResult" ? clip(p.text, TOOL_RESULT_CHARS) : p.text }]
      : p.type === "toolCall" ? [{ tool_call: p.name, arguments: clip(p.arguments, TOOL_ARG_CHARS) }] : []);
  const row: any = { role: m.role === "toolResult" ? "tool_result" : m.role, parts };
  if (m.role === "assistant") Object.assign(row, { stop_reason: m.stopReason ?? null, output_tokens: m.usage?.output ?? null,
    reasoning_tokens: m.usage?.reasoning ?? null, input_tokens: m.usage?.input ?? null });
  if (m.role === "toolResult") Object.assign(row, { tool: m.toolName ?? null, is_error: Boolean(m.isError) });
  return row;
}

export async function runEpisode(request: V5Request, out: string, raw = false) {
  const plan = request.steps;
  const sent: { learner_text: string | null; branch: string | null }[] = [];
  let lastTutor: any[] | null = null;
  const first = choose(plan[0], null);
  sent.push({ learner_text: first.step.kind === "message" ? first.step.text : null, branch: first.branch });
  const started = Date.now();
  const diagnostics: string[] = [];
  const result = await runHarnessEpisode({ ...(request.harness as any), id: request.instance_id, steps: [first.step] },
    e => diagnostics.push(String(e).slice(0, 500)), {
      max_steps: plan.length,
      async afterStep(receipt: any) {
        if (receipt.kind === "message") lastTutor = receipt.messages.slice(receipt.message_start_index);
        const i = receipt.index + 1;
        if (i >= plan.length) return null;
        const next = choose(plan[i], lastTutor);
        sent.push({ learner_text: next.step.kind === "message" ? next.step.text : null, branch: next.branch });
        return next.step;
      },
    });
  const capture = new Set([...request.capture_files_after, plan.length - 1]);
  const steps = result.steps.map((s: any, i: number) => {
    const fresh = s.kind === "message" ? s.messages.slice(s.message_start_index) : [];
    const row: any = { index: i, kind: s.kind, status: s.status, error_code: s.error_code ?? null,
      learner_text: sent[i]?.learner_text ?? null, branch: sent[i]?.branch ?? null,
      messages: fresh.map(compactMessage), visible_text: visibleText(fresh), tool_calls: toolCalls(fresh),
      session_id: s.state?.sessionId ?? null };
    if (capture.has(i)) row.files_after_step = (s.files ?? []).filter((f: any) => !/(^|\/)(sessions|outputs\/verifications)\//.test(f.path))
      .map((f: any) => ({ path: f.path, sha256: f.sha256 ?? sha(f.content ?? ""), content: clip(f.content ?? "", FILE_CHARS) }));
    return row;
  });
  const usage = steps.flatMap((s: any) => s.messages).filter((m: any) => m.role === "assistant");
  const episode = {
    schema: "keating-teaching-v5-episode/v1", instance_id: request.instance_id, status: result.status,
    error_code: result.error_code ?? null, elapsed_seconds: (Date.now() - started) / 1000,
    provider_calls: (result.requests ?? []).length, planned_steps: plan.length, completed_steps: steps.length,
    output_tokens: usage.reduce((a: number, m: any) => a + (m.output_tokens ?? 0), 0),
    reasoning_tokens: usage.reduce((a: number, m: any) => a + (m.reasoning_tokens ?? 0), 0),
    source_hashes_sha256: sha(JSON.stringify(result.source_hashes ?? {})), measurement: result.measurement ?? null,
    diagnostics, steps,
  };
  await mkdir(out, { recursive: true, mode: 0o700 });
  await writeFile(resolve(out, "episode.json"), JSON.stringify(episode, null, 1) + "\n", { flag: "wx" });
  if (raw) await writeFile(resolve(out, "raw-result.json"), JSON.stringify(result) + "\n", { flag: "wx" });
  return episode;
}

if (import.meta.main) {
  const [requestPath, out, flag] = process.argv.slice(2);
  if (!requestPath || !out) throw new Error("usage: benchmark_v5_driver.ts REQUEST.json OUT_DIR [--raw]");
  const request = JSON.parse(await Bun.file(requestPath).text()) as V5Request;
  if (request.schema !== "keating-teaching-v5-request/v1") throw new Error("not a v5 request");
  const e = await runEpisode(request, out, flag === "--raw");
  console.log(JSON.stringify({ instance_id: e.instance_id, status: e.status, error_code: e.error_code, steps: e.completed_steps,
    provider_calls: e.provider_calls, output_tokens: e.output_tokens, reasoning_tokens: e.reasoning_tokens }));
}
