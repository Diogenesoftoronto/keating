import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  classifyOpenUiCue, isOpenUiDiagnosticGateIssue, normalizeOpenUiComponent, openUiDiagnosticComponentForNode, parseOpenUiDiagnosticExport,
  type OpenUiDiagnosticTurn,
} from "../../packages/learner-contracts/src/openui-diagnostics.js";
import type { UiDocumentNode } from "../../packages/learner-contracts/src/ui.js";
import type { BenchmarkReceipt } from "../prompt-adherence/benchmark.js";
import { inspectOpenUIDiagnosticText } from "../../web/src/keating/openui/diagnostic-components.js";

const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

/** Convert executed compact and governed trials. Their final blind assessments did not execute a classroom release. */
export async function fromPromptBenchmark(directory: string): Promise<OpenUiDiagnosticTurn[]> {
  const manifest = await read(resolve(directory, "manifest.json"));
  if (manifest.mode !== "execute" || !manifest.selectedCorpusSha256 || !manifest.createdAt) {
    throw new Error("An executed prompt-adherence run with an identified corpus is required.");
  }
  const experimentId = "prompt-adherence-" + hash([manifest.createdAt, manifest.selectedCorpusSha256, manifest.implementationSha256]);
  const files = (await readdir(directory)).filter(name => /^trial-\d+\.json$/.test(name)).sort();
  const turns: OpenUiDiagnosticTurn[] = [];
  for (const file of files) {
    const r: BenchmarkReceipt = await read(resolve(directory, file));
    if (r.arm !== "compact" && r.arm !== "governed") continue;
    const state = (r.postJudge ?? r.preJudge)?.request.state;
    const turn = state && typeof state === "object" && "turn" in state ? state.turn : undefined;
    const message = turn && typeof turn === "object" && "learnerMessage" in turn && typeof turn.learnerMessage === "string"
      ? turn.learnerMessage : null;
    const pre = r.preJudge?.outcome;
    const planUsed = pre?.ok && r.plan?.status === "guided";
    const reviewer = pre?.ok ? pre.response.backend : null;
    const source = reviewer?.backend === "system-one" && /^jev[-.]/i.test(reviewer.model) ? "jev" : "other";
    const sameModel = r.generation.resolvedModel === r.model.model;
    const usable = sameModel && !r.generation.error && r.generation.finishReason === "stop" && !!r.generation.reply.text.trim();
    const observed = usable ? inspectOpenUIDiagnosticText(r.generation.reply.text) : null;
    const pairId = hash([r.caseId, r.repetition, r.toolSchemaSha256, message === null ? file : turn]);
    const turnId = "trial-" + r.ordinal;
    const review = r.postJudge?.outcome;
    const interaction = r.plan?.interaction; // Older governed runs predate component-family recommendations.
    const targets = (interaction?.families.flatMap(family => family.components) ?? []).map(normalizeOpenUiComponent)
      .filter((kind): kind is string => kind !== null);
    const mode = r.arm === "compact" ? "baseline" : planUsed && source === "jev" ? "guided" : "unknown";
    turns.push({
      schemaVersion: 1, conversationId: experimentId + "-" + turnId, turnId, turnIndex: 0,
      model: r.model.id, mode, cue: classifyOpenUiCue(message), reply: r.generation.error ? "error" : "unknown",
      attempted: observed?.attempted ?? null, compiled: observed?.components ?? null, selected: null, rendered: null,
      guidance: r.arm === "compact" ? null : { source: pre?.ok ? source : "unknown",
        action: interaction?.action ?? "unknown", delivered: Boolean(planUsed), targets: [...new Set(targets)] },
      decisionModel: pre?.ok ? pre.response.backend.model : null,
      experiment: { experimentId, caseId: r.caseId, pairId },
      ...(review?.ok ? { fit: {
        source: "teaching-rubric/" + review.response.backend.model + "/" + r.assessment.version,
        passed: !usable || r.assessment.status === "unknown" ? null : r.assessment.status === "pass",
      } } : {}),
    });
  }
  if (!turns.length) throw new Error("The directory contains no compact or governed trial receipts.");
  return parseOpenUiDiagnosticExport(turns);
}

type AuditScore = {
  stop: string; marked: number; fits: boolean;
  nodes: UiDocumentNode[]; toolNames: string[]; text: string; outsideWords: number;
};
type AuditRecord = {
  id: string; scenario: string; group: string; model: string; cohort: string; phase: string;
  planAction: NonNullable<OpenUiDiagnosticTurn["guidance"]>["action"]; offered: string[];
  drafts: AuditScore[]; final: AuditScore | null;
};
function kinds(values: string[]): string[] {
  return Array.from(new Set(values.map(value => {
    const kind = normalizeOpenUiComponent(value);
    if (!kind) throw new Error("Unrecognized scored component: " + value);
    return kind;
  }))).sort();
}

/** Replay the independently labelled November scenario set using its saved release-stage scores. */
export async function fromNovemberAudit(directory: string): Promise<OpenUiDiagnosticTurn[]> {
  const scored = await read(resolve(directory, "scored.json"));
  const scenarios: {id: string; group: string; fit: string[]}[] = await read(resolve(directory, "scenarios.json"));
  const rows = await Promise.all((scored.records as AuditRecord[]).filter(r => r.cohort === "primary").map(async r => {
    const scenario = scenarios.find(s => s.id === r.scenario);
    if (!scenario) throw new Error("Missing labelled scenario: " + r.scenario);
    const receipt = await read(resolve(directory, "evidence", r.id + ".json"));
    const plan = receipt.judge.find((judge: {phase: string}) => judge.phase === "plan");
    const reviews = receipt.checks as { checks: { id: string; status: string }[] }[];
    const gateIssues = [...new Set(reviews.flatMap(review => review.checks
      .filter(check => (check.status === "fail" || check.status === "unknown") && isOpenUiDiagnosticGateIssue(check.id)).map(check => check.id)))].sort();
    const complete = r.drafts.filter(d => d.stop === "stop" || d.stop === "toolUse");
    const final = r.final;
    const control = scenario.group === "control";
    const fits = control ? !!final?.text && !final.marked && !final.toolNames.length
      : !!final?.fits && (r.scenario !== "code" || final.nodes.some(n => n.type === "coding-challenge" && String(n.language) === "python"));
    return {
      schemaVersion: 1, conversationId: r.id, turnId: r.id, turnIndex: 0, model: r.model, mode: "guided",
      cue: { kind: control ? "direct-text" : "implicit-action", targets: kinds(scenario.fit) },
      reply: r.phase === "released" ? "released" : "withheld", attempted: complete.length ? complete.some(d => d.marked > 0) : null,
      compiled: complete.length ? kinds(complete.flatMap(d => d.nodes.map(openUiDiagnosticComponentForNode))) : null,
      selected: kinds((final?.nodes ?? []).map(openUiDiagnosticComponentForNode)), rendered: null,
      outsideWords: final?.stop === "stop" ? final.outsideWords : null,
      nativePageRequested: final ? final.toolNames.includes("interactive_page") : null,
      guidance: { source: plan?.model && /^jev[-.]/i.test(plan.model) ? "jev" : "unknown", action: r.planAction,
        delivered: r.planAction === "create" ? Boolean(receipt.offer) : Boolean(plan?.answers && !plan.error && receipt.directives?.length), targets: kinds(r.offered) },
      decisionModel: plan?.model ?? null,
      draftAttempts: r.drafts.length, gateIssues, fit: { source: "november-action-and-language", passed: fits },
    } satisfies OpenUiDiagnosticTurn;
  }));
  return parseOpenUiDiagnosticExport(rows);
}

type EpisodeExport = {
  cases: { id: string; steps: { kind: string; text?: string }[] }[];
  models: { id: string; model: string; rows: {
    case_id: string; delivery_status: string; source_sha256: string;
    trace: { steps: { index: number; kind: string; status: string; messages: {role: string; content: {type: string; text?: string}[]}[] }[] };
    ui_documents: {step: number; status: string; document?: {nodes: UiDocumentNode[]}}[];
  }[] }[];
};

/** Use the original terminal adapter's receipts; these establish no web mount or private-draft history. */
export async function fromTerminalEpisodes(file: string): Promise<OpenUiDiagnosticTurn[]> {
  const dataset: EpisodeExport = await read(file);
  const cases = new Map(dataset.cases.map(c => [c.id, c.steps]));
  const turns: OpenUiDiagnosticTurn[] = [];
  for (const model of dataset.models) for (const episode of model.rows) {
    if (episode.delivery_status !== "completed") continue;
    const script = cases.get(episode.case_id);
    if (!script) throw new Error("Missing episode case: " + episode.case_id);
    let session = 0, index = 0;
    for (const step of episode.trace.steps) {
      if (step.kind === "new_session" || step.kind === "reopen") { session++; index = 0; continue; }
      if (step.kind !== "message") continue;
      if (step.status !== "completed" || script[step.index]?.kind !== "message") throw new Error("Unmatched terminal step.");
      const docs = episode.ui_documents.filter(d => d.step === step.index);
      if (docs.some(d => !["rendered", "rejected"].includes(d.status))) throw new Error("Unrecognized terminal adapter result.");
      const selected = kinds(docs.filter(d => d.status === "rendered").flatMap(d => d.document!.nodes.map(openUiDiagnosticComponentForNode)));
      const hasReply = step.messages.some(m => m.role === "assistant" && m.content.some(p => p.type === "text" && p.text?.trim()));
      turns.push({ schemaVersion: 1, conversationId: episode.source_sha256 + "-" + session, turnId: "step-" + step.index,
        turnIndex: index++, model: model.model, mode: "unknown", cue: classifyOpenUiCue(script[step.index]?.text),
        reply: hasReply || selected.length ? "released" : "unknown", attempted: docs.length > 0, compiled: null,
        selected: hasReply || docs.length ? selected : null, rendered: null, guidance: null });
    }
  }
  if (!turns.length) throw new Error("No completed terminal episodes found.");
  return parseOpenUiDiagnosticExport(turns);
}

if (import.meta.main) {
  try {
    const [format, directory, ...extra] = process.argv.slice(2);
    if (!directory || extra.length || !["prompt-adherence", "november-audit", "terminal-episodes"].includes(format ?? "")) {
      throw new Error("Usage: bun scripts/openui-diagnostics/from-benchmark.ts <prompt-adherence|november-audit|terminal-episodes> <receipt-directory-or-terminal-results.json>");
    }
    const turns = format === "terminal-episodes" ? await fromTerminalEpisodes(directory)
      : format === "november-audit" ? await fromNovemberAudit(directory) : await fromPromptBenchmark(directory);
    console.log(JSON.stringify({ schemaVersion: 1, turns }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid benchmark export.");
    process.exitCode = 1;
  }
}
