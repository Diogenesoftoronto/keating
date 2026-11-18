/**
 * Offline replay of saved final-review turns through the working-tree draft session.
 * Reads study/ledger.json and study/receipts read-only; no network and no provider.
 *
 *   rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/prediction-replay/replay.ts [contractsDir] [out.json]
 *
 * Each tutor reply is the saved draft, in saved order. Each decision is the saved
 * provider answer for the same phase (plan, review N, selection), limited to the
 * question ids the current code asks. An id the saved answer lacks stays missing.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = import.meta.dir;
const study = join(here, "..", "study");
const contracts = resolve(process.argv[2] ?? join(here, "../../../../../packages/learner-contracts"));
const { runTeachingDrafts } = await import(join(contracts, "src/judgement/teaching-drafts.ts"));

type Answers = Record<string, any>;
type Entry = { id: string; requestSha256: string; model: string; request: any; response: { answers: Answers } };
const ledger: Entry[] = JSON.parse(readFileSync(join(study, "ledger.json"), "utf8")).entries;
const maxDrafts: number = JSON.parse(readFileSync(join(study, "cohort.json"), "utf8")).maxDrafts;
const receipt = (id: string) => JSON.parse(readFileSync(join(study, "receipts", `${id}.json`), "utf8"));
const noul = (value: number) => ({ type: "noul", noul: value });

interface Change {
  /** Replace saved plan answers. */
  plan?: Answers;
  /** Replace saved review answers for a 1-based review index. */
  review?: Record<number, Answers>;
  /** Replace or decorate a saved draft before it is generated. */
  draft?: (index: number, reply: { text: string; toolCalls: any[] }) => { text: string; toolCalls: any[] };
  /** Borrow another receipt's saved plan. */
  planFrom?: string;
}

async function replay(id: string, change: Change = {}) {
  const row = receipt(id);
  // Identical request bodies are recorded once per arm; take this arm's own entry so the judge identity stays constant.
  const entry = (ref: { label: string; requestSha256: string; model: string }) => ledger.find(item => item.id === ref.label && item.response?.answers)
    ?? ledger.find(item => item.requestSha256 === ref.requestSha256 && item.model === ref.model && item.response?.answers)!;
  const refs = row.refs as { label: string; requestSha256: string; model: string }[];
  const planRef = change.planFrom ? receipt(change.planFrom).refs.find((ref: any) => ref.label.endsWith("/plan")) : refs.find(ref => ref.label.endsWith("/plan"));
  const plan = entry(planRef);
  const reviews = refs.filter(ref => /\/review\/\d+$/u.test(ref.label)).map(entry);
  const selection = refs.filter(ref => ref.label.endsWith("/selection")).map(entry)[0];
  const calls = { plan: 0, review: 0, selection: 0, generate: 0 };
  const missing = new Set<string>();
  const outOfRecord: string[] = [];
  const result = await runTeachingDrafts({
    turn: structuredClone(plan.request.state.turn), maxAttempts: maxDrafts, random: () => 0,
    generate: async () => {
      const index = calls.generate++;
      const saved = row.drafts[index];
      if (!saved) { outOfRecord.push(`draft ${index + 1}`); throw new Error("no saved draft"); }
      const reply = { text: saved.text as string, toolCalls: saved.toolCalls.map((call: any) => ({ name: call.name, arguments: call.arguments })) };
      return { reply: change.draft ? change.draft(index, reply) : reply, value: index + 1 };
    },
    judge: async (request: any) => {
      const phase = request.questions.learning_task ? "plan" : request.questions.draft_choice ? "selection" : "review";
      const index = calls[phase as "plan"]++;
      const saved = phase === "plan" ? plan : phase === "selection" ? selection : reviews[index];
      if (!saved) { outOfRecord.push(`${phase} ${index + 1}`); return { ok: false, error: { code: "backend-unavailable", retryable: false } }; }
      const override = phase === "plan" ? change.plan : phase === "review" ? change.review?.[index + 1] : undefined;
      const answers: Answers = {};
      for (const key of Object.keys(request.questions)) {
        const answer = override?.[key] ?? saved.response.answers[key];
        if (answer === undefined) missing.add(`${phase}:${key}`); else answers[key] = answer;
      }
      return { ok: true, response: { backend: { backend: "recorded", model: saved.model, calibrationSha256: null }, answers } };
    },
  });
  const receiptOut = result.receipt;
  return {
    id, status: result.status, selectedAttempt: receiptOut.selectedAttempt, reason: receiptOut.reason,
    notice: result.status === "released" ? receiptOut.reason === "best-effort-draft" ? "unverified" : null : "withheld",
    publicText: result.reply?.text ?? null, publicToolCalls: result.reply?.toolCalls.map((call: any) => call.name) ?? [],
    publicHasOpenUi: /```openui/u.test(result.reply?.text ?? ""),
    selectionCandidateAttempts: receiptOut.selectionCandidateAttempts,
    attempts: receiptOut.attempts.map((attempt: any) => ({ attempt: attempt.attempt, status: attempt.status,
      ...(attempt.trimmedCheckpointSuffix ? { trimmedCheckpointSuffix: true } : {}),
      notPassed: attempt.checks.filter((check: any) => check.status !== "pass").map((check: any) => `${check.id}=${check.status}@${check.probability}`) })),
    calls, outOfRecord, questionsMissingFromRecord: [...missing].sort(),
    recorded: { disposition: row.disposition, selectedAttempt: row.selectedAttempt, notice: row.notice, hadOpenUi: (row.public?.components?.length ?? 0) > 0 },
  };
}

const jev = "paper-fold--minimax--jev", google = "paper-fold--flash--google";
const question = receipt(jev).drafts[0] as { text: string };
const withQuestion = (index: number, reply: { text: string; toolCalls: any[] }) => index === 0 ? { text: question.text, toolCalls: [] } : reply;
const questionReview = { 1: ledger.find(item => item.id === `${jev}/review/1`)!.response.answers };

const cases: Record<string, () => Promise<any>> = {
  // The two reported turns, exactly as recorded.
  "target/jev-best-effort": () => replay(jev),
  "target/google-approved-choice": () => replay(google),
  // Best-effort branch: each change must keep the Question from being published.
  "guard/jev-answer-leaked": () => replay(jev, { review: { 1: { checkpoint_answer_leaked: noul(0.7) } } }),
  "guard/jev-answer-leak-uncertain": () => replay(jev, { review: { 1: { checkpoint_answer_leaked: noul(0.5) } } }),
  "guard/jev-continued-past-question": () => replay(jev, { review: { 1: { checkpoint_continued: noul(0.7) } } }),
  "guard/jev-confident-repetition": () => replay(jev, { review: { 1: { checkpoint_repeated: noul(0.85) } } }),
  "guard/jev-unsupported-claim": () => replay(jev, { review: { 1: { tool_success_invented: noul(0.9) } } }),
  "guard/jev-invalid-openui": () => replay(jev, { draft: (index, reply) => index === 0 ? { ...reply, text: reply.text.replace('"ephemeral")\nguess', '"ephemeral"\nguess') } : reply }),
  "guard/jev-profile-write-attached": () => replay(jev, { draft: (index, reply) => index === 0 ? { ...reply, toolCalls: receipt(jev).drafts[1].toolCalls.map((call: any) => ({ name: call.name, arguments: call.arguments })) } : reply }),
  "guard/jev-assessment-declined": () => replay(jev, { plan: { assessment_declined: noul(0.95) } }),
  "guard/jev-plain-reply-requested": () => replay(jev, { plan: { plain_reply_requested: noul(0.95) } }),
  "guard/jev-response-not-requested": () => replay(jev, { plan: { learner_response_due: noul(0.05) } }),
  "guard/jev-response-uncertain": () => replay(jev, { plan: { learner_response_due: noul(0.5) } }),
  // Copper asks for a bare fact. The recorded turn, then the same Question forced into it.
  "guard/copper-recorded": () => replay("copper--minimax--jev"),
  "guard/copper-question-injected": () => replay("copper--minimax--jev", { draft: withQuestion, review: questionReview }),
  "guard/copper-plan-on-paper-fold-drafts": () => replay(jev, { planFrom: "copper--minimax--jev" }),
  // Optional controls and an explicit no-quiz request, exactly as recorded.
  "guard/irrigation-optional-recorded": () => replay("irrigation--minimax--jev"),
  "guard/stage-light-no-quiz-recorded": () => replay("classroom-stage-light--minimax--jev"),
  "guard/stage-light-question-injected": () => replay("classroom-stage-light--minimax--jev", { draft: withQuestion, review: questionReview }),
  // Approved-choice branch: the recorded chooser answer (prose) must stand whenever the Question is not warranted.
  "guard/google-question-leaks": () => replay(google, { review: { 2: { checkpoint_answer_leaked: noul(0.7) } } }),
  "guard/google-assessment-declined": () => replay(google, { plan: { assessment_declined: noul(0.95) } }),
  "guard/google-response-not-requested": () => replay(google, { plan: { learner_response_due: noul(0.05) } }),
  "guard/google-prose-not-a-question": () => replay(google, { review: { 1: { checkpoint_not_interactive: noul(0.05) } } }),
};
// Every guided receipt, unchanged, to show which recorded outcomes move.
for (const file of readdirSync(join(study, "receipts")).sort()) {
  const id = file.replace(/\.json$/u, "");
  const row = receipt(id);
  if (row.arm !== "none" && row.refs.some((ref: any) => ref.label.endsWith("/plan")) && row.drafts.length && row.drafts.every((draft: any) => draft.completed)) cases[`sweep/${id}`] = () => replay(id);
}

const only = process.env.REPLAY_ONLY;
const results: Record<string, any> = {};
for (const [name, run] of Object.entries(cases)) {
  if (only && !name.includes(only)) continue;
  try { results[name] = await run(); } catch (error) { results[name] = { error: String((error as Error)?.message ?? error) }; }
  const r = results[name];
  console.log(`${name.padEnd(46)} ${r.error ? "ERROR " + r.error : `${r.status} attempt=${r.selectedAttempt} openui=${r.publicHasOpenUi} tools=${r.publicToolCalls.length} reason=${r.reason} drafts=${r.calls.generate} chooser=${r.calls.selection} | recorded attempt=${r.recorded.selectedAttempt} openui=${r.recorded.hadOpenUi}${r.outOfRecord.length ? " OUT-OF-RECORD " + r.outOfRecord.join(",") : ""}`}`);
}
if (process.argv[3]) writeFileSync(resolve(process.argv[3]), JSON.stringify({ contracts, results }, null, 1) + "\n");
