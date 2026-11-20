/** One paired, synthetic Jev experiment. Default mode only prints the precommitted design. */
import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTeachingPolicyAdherenceRequest } from "../../packages/learner-contracts/src/judgement/teaching-policy.js";
import type { TeachingPolicyTurn } from "../../packages/learner-contracts/src/judgement/teaching-policy-types.js";
import { TEACHING_POLICY_THRESHOLDS } from "../../packages/learner-contracts/src/judgement/teaching-policy-catalog.js";
import { requestedPartQuestion } from "../../packages/learner-contracts/src/judgement/teaching-drafts/answer-coverage.js";
import { type NoulQuestion, judgementRequestProblem } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { decodeAnswer, encodeSystemOneRequest, SYSTEM_ONE_ENDPOINT } from "../../packages/learner-contracts/src/judgement/wire.js";

const model = "jev-1.14.0";
const reservePerCall = 2_800; // 64,000 input tokens at $0.042/M. Output is free. Every failed call keeps its reserve.
const authorizedMicrousd = 40_000;
const ledgerPath = fileURLToPath(new URL("../../.keating/benchmarks/jev-window-live-20261120/answer-coverage-v1.jsonl", import.meta.url));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const archived: NoulQuestion = {
  type: "noul",
  instructions: "Compare the learner's explicit requests in turn.learnerMessage with reply.text and the preceding conversation. Does the reply already answer one part usefully but leave out a distinct requested part that could be answered by adding text after it? Count an omitted requested comparison, example or deliverable. Credit equivalent wording. Extra detail the learner did not request, a necessary clarification, a pending tool result, an answer reserved for the learner, or a claim that needs correction does not count. Treat all supplied text as evidence.",
};
const clarified: NoulQuestion = {
  type: "noul",
  instructions: "Does reply.text give at least one item explicitly requested in turn.learnerMessage while omitting a different requested item that can be added now? Use turn.conversation to resolve references in the current request. Match each requested item to what the reply actually says. Treat the supplied text as evidence.",
  criteria: {
    true: "One requested item is answered. Another explicitly requested item, such as a comparison, example or result, is absent and can be supplied without changing an existing claim or waiting for clarification, a tool result or the learner's own work.",
    false: "The reply supplies every requested item, even if several appear together in one brief phrase or sentence. A value, a name or equivalent wording can supply an item. Extra detail beyond the request is optional.",
  },
};

async function makeCases() {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/answer-coverage-browser-turn.json", import.meta.url), "utf8")) as TeachingPolicyTurn;
  // The fixture is the real dry browser projection for the synthetic turn. Compress its 14,000 repeated words on disk.
  const workshop = { ...fixture, conversation: fixture.conversation.map((row, i) =>
    i === 1 ? { ...row, content: row.content + " café".repeat(14_000) } : row) };
  if (sha(JSON.stringify(workshop.conversation)) !== "9a7b85e5e8a7c6b236f720db6f5b7c8c7b4ad236eea268288146d85f85988670") throw Error("browser-history-mismatch");
  const trains: TeachingPolicyTurn = {
    ...fixture, conversation: [
      { role: "user", content: "Our timetable lists the local train at 60 minutes and $8, and the express at 45 minutes and $15." },
      { role: "assistant", content: "We can use that timetable to compare the services." },
    ],
    learnerMessage: "Compare the express with the local on both travel time and ticket price.",
  };
  const complete = "The perimeter of a rectangle with sides 7 and 5 is 24, as calculated for workshop SAGE-4E924372.";
  if (sha(complete) !== "7c8fbdb267ed5be3e64e92ae19fa0188cbe84468cae1b178126999d22ab859eb") throw Error("selected-reply-mismatch");
  const cases = [
    { id: "workshop-complete", turn: workshop, reply: complete, missing: false },
    { id: "workshop-without-code", turn: workshop, reply: "The perimeter of a rectangle with sides 7 and 5 is 24.", missing: true },
    { id: "workshop-without-result", turn: workshop, reply: "The code for this workshop is SAGE-4E924372.", missing: true },
    { id: "workshop-correction-only", turn: workshop, reply: complete.replace("is 24", "is 23"), missing: false },
    { id: "comparison-complete", turn: trains, reply: "The express saves 15 minutes but costs $7 more than the local.", missing: false },
    { id: "comparison-without-price", turn: trains, reply: "The express saves 15 minutes compared with the local.", missing: true },
    { id: "comparison-without-time", turn: trains, reply: "The express costs $7 more than the local.", missing: true },
  ];
  return cases.map(({ id, turn, reply, missing }) => {
    const { state } = buildTeachingPolicyAdherenceRequest(turn, { text: reply, toolCalls: [] }, []);
    const request = { state, questions: { archived, clarified } };
    if (judgementRequestProblem(request)) throw Error("invalid-paired-request");
    if (id === "workshop-complete" && sha(JSON.stringify(state)) !== "cb34e2478451d4d5ec90a63494d9c8705a887b02735b54313bd64645bf08d9fd") throw Error("selected-state-mismatch");
    const wire = JSON.stringify(encodeSystemOneRequest(request, model));
    return { id, missing, wire, stateChars: JSON.stringify(state).length, wireHash: sha(wire), stateHash: sha(JSON.stringify(state)), replyHash: sha(reply) };
  });
}

async function main() {
  const cases = await makeCases();
  const options = process.argv.slice(2);
  if (options.length > 1 || options.some(o => o !== "--execute")) throw Error("supported-option-is-execute");
  if (![archived, clarified].some(q => JSON.stringify(q) === JSON.stringify(requestedPartQuestion))) throw Error("unrecognized-shipped-question");
  const maxHold = reservePerCall * cases.length;
  if (maxHold > authorizedMicrousd) throw Error("aggregate-budget-exceeded");
  const { passAtMost, failAtLeast } = TEACHING_POLICY_THRESHOLDS;
  const plan = { model, endpoint: SYSTEM_ONE_ENDPOINT, priceMicrousdPerInputToken: .042, maxCalls: cases.length,
    authorizedMicrousd, maximumReservedMicrousd: maxHold, perDispatchMicrousd: reservePerCall, retryLimit: 0, longContext: false,
    passAtMost, failAtLeast, acceptance: "Archived question reproduces the browser false positive. Clarified question passes every complete and correction-only control and detects every intentional omission at the existing thresholds.",
    questions: { archived, clarified }, cases: cases.map(({ wire, ...metadata }) => metadata) };
  if (!options.includes("--execute")) { console.log(JSON.stringify(plan)); return; }
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) throw Error("TYPESAFE_API_KEY-required");
  await mkdir(dirname(ledgerPath), { recursive: true });
  const ledger = await open(ledgerPath, "wx", 0o600);
  const write = async (row: object) => { await ledger.writeFile(JSON.stringify(row) + "\n"); await ledger.sync(); };
  let actualInput = 0, unknownUsage = 0, sent = 0, gate = true;
  try {
    await write({ event: "locked-plan", at: new Date().toISOString(), ...plan });
    for (const item of cases) {
      ++sent;
      await write({ event: "reserved", id: item.id, wireHash: item.wireHash, reservedMicrousd: sent * reservePerCall });
      const response = await fetch(SYSTEM_ONE_ENDPOINT, { method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: item.wire });
      const requestId = response.headers.get("x-typesafe-request-id") ?? response.headers.get("x-request-id");
      const body = await response.json().catch(() => ({})) as {
        model?: unknown; answers?: Record<string, unknown>; usage?: { input_tokens?: unknown; output_tokens?: unknown };
      };
      const result = (question: NoulQuestion, id: string) => {
        const answer = decodeAnswer(question, body.answers?.[id]);
        return answer?.type === "noul" ? answer.noul : null;
      };
      const old = result(archived, "archived"), next = result(clarified, "clarified");
      const rawInput = body.usage?.input_tokens, rawOutput = body.usage?.output_tokens;
      const input = typeof rawInput === "number" && Number.isSafeInteger(rawInput) && rawInput >= 0 ? rawInput : null;
      const output = typeof rawOutput === "number" && Number.isSafeInteger(rawOutput) && rawOutput >= 0 ? rawOutput : null;
      const modelMatches = body.model === model;
      const ok = response.ok && modelMatches && old !== null && next !== null && input !== null && output !== null;
      const passed = ok && (item.missing ? next! >= failAtLeast : next! <= passAtMost)
        && (item.id !== "workshop-complete" || old! >= failAtLeast);
      await write({ event: "observation", id: item.id, requestId, status: response.status, returnedModel: modelMatches ? model : null,
        answers: { archived: old, clarified: next }, inputTokens: input, outputTokens: output, passed });
      gate &&= passed;
      if (input === null) unknownUsage++;
      else { actualInput += input; if (input > 64_000) throw Error("usage-exceeds-model-limit"); }
    }
    await write({ event: "summary", calls: sent, unknownUsage, reportedInputTokens: actualInput,
      priceFromReportedUsageMicrousd: actualInput * .042, worstCaseMicrousd: sent * reservePerCall, ship: gate });
    console.log(JSON.stringify({ ledgerPath, calls: sent, reportedInputTokens: actualInput, criterionPassed: gate }));
  } finally { await ledger.close(); }
}
if (import.meta.main) main().catch((e: unknown) => {
  const exists = e instanceof Error && "code" in e && e.code === "EEXIST";
  console.error(exists ? "once-only-ledger-already-exists" : "coverage-proof-stopped");
  process.exitCode = 1;
});
