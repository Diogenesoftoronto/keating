// Default and --verify never load credentials. --execute runs the six predeclared tutor turns.
// --execute --frozen uses only the frozen shared-decision requests. Both commands share one ledger.
import { plugin } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  cells,
  credential,
  fileHash,
  here,
  httpStatus,
  must,
  openJournal,
  original,
  protocol,
  read,
  recordedDecision,
  root,
  save,
  sha,
  total,
  verifyPrior,
  withSharedLock,
} from "./journal.mjs";
import {
  TEACHING_POLICY_VERSION,
  projectTeachingPolicyDecision,
  interactionDirectives,
} from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { parseOpenUiDiagnosticExport } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn.ts";

verifyPrior();
const cfg = original.protocol,
  bundle = JSON.parse(gunzipSync(readFileSync(join(here, protocol.releasedInputs))));
const tools = JSON.parse(bundle.toolSchemasText).map((t) => t.function);
must(
  TEACHING_POLICY_VERSION === protocol.policy &&
    bundle.meta.sourceRelease === protocol.release &&
    bundle.meta.verifiedEqualToOriginalWebBuilder &&
    sha(bundle.systemPrompt) === original.systemSha256 &&
    sha(bundle.toolSchemasText) === original.toolSchemasSha256,
  "Policy or release export mismatch",
);
await plugin({
  name: "audit-markdown-raw",
  setup(b) {
    b.onLoad({ filter: /\.md(?:\?raw)?$/ }, async (a) => ({
      contents: "export default " + JSON.stringify(await Bun.file(a.path.replace(/\?raw$/, "")).text()),
      loader: "js",
    }));
  },
});
const { composeKeatingSystemPrompt } = await import("../../../../web/src/keating/browser-tools/prompt.ts");
const { DEFAULT_TEACHER_PERSONA } = await import("../../../../web/src/keating/persona.ts");
const { withTeachingDraftGate } = await import("../../../../web/src/keating/judgement/draft-gate.ts");
const { parseReviewNotice } = await import("../../../../web/src/keating/judgement/review-notice.ts");
const { inspectOpenUIDiagnosticText } =
  await import("../../../../web/src/keating/openui/diagnostic-components.ts");
const { parseOpenUIMessageSegments } = await import("../../../../web/src/keating/openui/segments.ts");
const { tryCompileOpenUISourceToSharedDocument } =
  await import("../../../../web/src/keating/openui/shared-bridge.ts");
const base = composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA);
must(
  sha(base) === bundle.meta.basePromptSha256 && bundle.systemPrompt.startsWith(base),
  "Original release base prompt differs",
);
function inspect(text) {
  const measured = inspectOpenUIDiagnosticText(text),
    nodes = [],
    errors = [],
    outside = [];
  for (const s of parseOpenUIMessageSegments(text)) {
    if (s.type === "text") {
      outside.push(s.content);
      continue;
    }
    if (!s.complete) {
      errors.push("unfinished");
      continue;
    }
    if (s.format === "document") {
      if (s.document) nodes.push(...s.document.nodes);
      else errors.push("invalid-document");
      continue;
    }
    const result = tryCompileOpenUISourceToSharedDocument(s.rawProgram, {
      documentId: s.metadata.id,
      revision: s.metadata.revision,
      retention: s.metadata.lifecycle,
    });
    if (result.ok) nodes.push(...result.document.nodes);
    else errors.push(result.kind);
  }
  return { ...measured, nodes, errors, outsideText: outside.join("\n").trim() };
}
const manifestFile = join(here, "manifest.json");
const previousManifest = read(join(here, "../policy-holdout/manifest.json"));
const sourcePaths = [
  ...Object.keys(previousManifest.sourceHashes),
  "scripts/openui-diagnostics/gemini-decision.ts",
];
const baseline = {
  schemaVersion: 1,
  protocolSha256: fileHash(join(here, "protocol.json")),
  originalCohortSha256: protocol.casesSha256,
  systemSha256: original.systemSha256,
  toolsSha256: original.toolSchemasSha256,
  sourceRelease: protocol.release,
  policy: protocol.policy,
  scheduled: cells.map((cell) => cell.id),
  sourceHashes: Object.fromEntries(
    sourcePaths.map((p) => [p, existsSync(join(root, p)) ? fileHash(join(root, p)) : null]),
  ),
};
if (process.argv.includes("--verify")) {
  const { verify } = await import("./score.mjs");
  await verify({ cells, inspect, baseline, parseOpenUiDiagnosticExport });
  process.exit(0);
}
if (!process.argv.includes("--execute")) {
  console.log(
    JSON.stringify({
      dry: true,
      networkRequests: 0,
      scheduled: baseline.scheduled,
      previousBoundUsd: protocol.previousBoundUsd,
      incrementalLimitUsd: protocol.incrementalLimitUsd,
      adapterReady: !!baseline.sourceHashes["scripts/openui-diagnostics/gemini-decision.ts"],
    }),
  );
  process.exit(0);
}
withSharedLock();
must(
  baseline.sourceHashes["scripts/openui-diagnostics/gemini-decision.ts"],
  "Typed decision adapter unavailable",
);
if (!existsSync(manifestFile)) save(manifestFile, { ...baseline, frozenAt: new Date().toISOString() });
else {
  const frozen = read(manifestFile);
  must(
    sha({ ...frozen, frozenAt: null }) === sha({ ...baseline, frozenAt: null }),
    "Frozen source changed; evaluate offline before changing a live run",
  );
}
const journal = openJournal();
if (journal.ledger.stop) {
  console.log("Closed ledger: " + journal.ledger.stop);
  process.exit(0);
}
const { createBenchmarkRegistry } = await import("../../../../scripts/prompt-adherence/providers.ts");
const { streamSimple } = await import("../../../../node_modules/@earendil-works/pi-ai/dist/compat.js");
const registry = await createBenchmarkRegistry(join(root, ".keating/pi-config"));
async function runtimeModel(item) {
  const model = registry.find(item.provider, item.id);
  must(
    model && model.baseUrl === item.endpoint && model.provider === item.provider && model.id === item.id,
    "Unexpected official tutor identity",
  );
  const auth = await registry.getApiKeyAndHeaders(model);
  const apiKey =
    auth.apiKey ||
    credential(
      item.provider === "google" ? "GEMINI_API_KEY" : "MINIMAX_API_KEY",
      item.provider === "google" ? "gemini" : "minimax",
    );
  must(apiKey, "Missing credential for " + item.id);
  return { model, auth, apiKey };
}
const refs = new Map();
for (const item of original.models) refs.set(item.id, await runtimeModel(item));
const googleKey = refs.get(protocol.secondaryTutor).apiKey;
if (process.argv.includes("--recover-429")) {
  const disposition = read(join(here, "quota-disposition.json")),
    input = read(join(here, "frozen/requests.json"));
  const firstPath = join(here, "frozen/first-pass-google-outcomes.json"),
    outPath = join(here, "frozen/google-outcomes.json");
  must(fileHash(firstPath) === disposition.firstPassFileSha256, "Initial panel differs");
  const first = read(firstPath),
    out = read(outPath);
  for (const h of disposition.eligible) {
    const initial = first.cases.find((o) => o.requestSha256 === h),
      c = input.cases.find((c) => c.requestSha256 === h);
    must(
      initial &&
        c &&
        c.id === initial.caseId &&
        sha(c.request) === h &&
        initial.receipt.httpStatus === 429 &&
        !initial.outcome.ok,
      "Unexpected original outcome",
    );
    const index = out.cases.findIndex((o) => o.requestSha256 === h);
    must(index >= 0, "Missing scheduled result");
    if (out.cases[index].quotaDisposition || journal.ledger.stop) continue;
    const events = journal.ledger.entries.filter((e) => e.kind === "decision");
    const prior = events.find((e) => e.label === "decision/" + h);
    const deadline = Math.max(
      Date.parse(prior.finishedAt) + disposition.minimumDelayAfterOriginalMs,
      Date.parse(events.at(-1).startedAt) + disposition.minimumGapBetweenNewDecisionsMs,
    );
    while (Date.now() < deadline)
      await new Promise((r) => setTimeout(r, Math.min(deadline - Date.now(), 1000)));
    const r = await recordedDecision({
      request: c.request,
      label: c.id,
      journal,
      apiKey: googleKey,
      signal: AbortSignal.timeout(30000),
      quotaRecovery: true,
    });
    out.cases[index] = {
      ...r,
      quotaDisposition: { firstStatus: 429, firstCacheFile: initial.cacheFile, secondCacheFile: r.cacheFile },
    };
    save(outPath, out);
    console.log(
      JSON.stringify({ recovered: c.id, ok: r.outcome.ok, http: r.receipt?.httpStatus, usage: r.usage }),
    );
  }
  process.exit(0);
}
if (process.argv.includes("--posthoc")) {
  const output = join(here, "frozen/perimeter-google-outcome.json"),
    inputPath = join(here, "frozen/perimeter-request.json");
  const amendment = read(join(here, "posthoc-protocol.json"));
  if (existsSync(output)) {
    console.log("The separate post-hoc result is already recorded.");
    process.exit(0);
  }
  must(
    fileHash(inputPath) === amendment.inputFileSha256 &&
      amendment.previousProtocolSha256 === baseline.protocolSha256,
    "Post-hoc input differs",
  );
  const input = read(inputPath),
    c = input.case;
  must(
    input.version === 1 &&
      c.id === amendment.caseId &&
      c.stage === "review" &&
      sha(c.request) === c.requestSha256 &&
      c.request.state.reply.text === "16.",
    "Wrong post-hoc review or candidate",
  );
  const result = await recordedDecision({
    request: c.request,
    label: c.id,
    journal,
    apiKey: googleKey,
    signal: AbortSignal.timeout(30000),
  });
  save(output, { version: 1, case: result, sourceSha256: amendment.inputFileSha256 });
  console.log(
    JSON.stringify({ posthoc: c.id, ok: result.outcome.ok, source: result.source, usage: result.usage }),
  );
  process.exit(0);
}
if (process.argv.includes("--frozen")) {
  const path = join(here, "frozen/google-outcomes.json"),
    inputPath = join(here, "frozen/requests.json");
  const input = read(inputPath),
    inputDigest = fileHash(inputPath);
  must(inputDigest === protocol.matchedDecisionInputsSha256, "Different matched decision input file");
  must(
    input.version === 1 &&
      input.policy === protocol.policy &&
      input.cases.length === 15 &&
      input.cases.filter((c) => c.stage === "plan").length === 6 &&
      new Set(input.cases.map((c) => c.id)).size === 15,
    "Unexpected frozen cohort",
  );
  const output = existsSync(path) ? read(path) : { version: 1, sourceSha256: inputDigest, cases: [] };
  must(inputDigest === output.sourceSha256, "Frozen inputs changed");
  for (const c of input.cases) {
    must(sha(c.request) === c.requestSha256, "Frozen app request digest differs");
    if (output.cases.some((r) => r.caseId === c.id) || journal.ledger.stop) continue;
    const r = await recordedDecision({
      request: c.request,
      apiKey: googleKey,
      label: c.id,
      journal,
      signal: AbortSignal.timeout(30000),
    });
    output.cases.push(r);
    save(path, output);
    console.log(
      JSON.stringify({
        frozen: c.id,
        ok: r.outcome.ok,
        source: r.source,
        usage: r.usage?.inputTokens ?? null,
      }),
    );
  }
  process.exit(0);
}
const publicText = (m) =>
  m.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const safeUsage = (u) =>
  u?.totalTokens > 0 &&
  ["input", "output", "cacheRead", "cacheWrite"].every((k) => Number.isFinite(u[k]) && u[k] >= 0)
    ? { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite }
    : null;
for (const { id, model: m, c } of cells) {
  const path = join(here, "turn-receipts", id + ".json");
  if (existsSync(path) || journal.ledger.entries.some((e) => e.label.startsWith(id + "/tutor-"))) continue;
  if (journal.ledger.stop) break;
  const row = {
    id,
    caseId: c.id,
    configuredModel: m.id,
    provider: m.provider,
    endpoint: m.endpoint,
    startedAt: new Date().toISOString(),
    status: "started",
    judgments: [],
    drafts: [],
    decision: null,
    phase: null,
    reason: null,
    selection: null,
    checks: [],
    public: null,
  };
  save(path, row);
  const { model, auth, apiKey } = refs.get(m.id),
    pending = [];
  let last = null,
    plan = null,
    judgeFailed = false,
    tutorFailed = false;
  const judge = async (request, signal) => {
    if (judgeFailed || journal.ledger.stop)
      return { ok: false, error: { code: "backend-unavailable", retryable: false } };
    const phase = request.questions.learning_task
      ? "plan"
      : request.questions.draft_choice
        ? "select"
        : "review";
    const observed = await recordedDecision({
      request,
      signal,
      label: id + "/judge-" + (row.judgments.length + 1),
      journal,
      apiKey: googleKey,
    });
    const r = observed.outcome;
    row.judgments.push({ ...observed, phase, answers: r.ok ? r.response.answers : null });
    if (!r.ok) judgeFailed = true;
    if (phase === "plan" && r.ok) {
      plan = projectTeachingPolicyDecision(request.state.turn, r);
      row.decision = {
        model: r.response.backend.model,
        source: "google",
        action: plan.interaction.action,
        targets: plan.interaction.families.flatMap((f) => f.components),
        signals: Object.fromEntries(
          [
            "learner_response_due",
            "hands_on_requested",
            "plain_reply_requested",
            "assessment_declined",
            "prediction_opportunity",
            "variable_relationship",
          ].map((k) => [k, r.response.answers[k]?.noul ?? null]),
        ),
        interactionDirectives: interactionDirectives(plan.interaction),
        planDirectives: plan.directives,
      };
    }
    save(path, row);
    return r;
  };
  const tutor = async (_model, ctx, opts) => {
    if (!plan || judgeFailed || tutorFailed || journal.ledger.stop)
      throw Error("No further tutor dispatch on an interrupted turn");
    const n = row.drafts.length + 1,
      directives =
        plan.interaction.action === "none" ? plan.directives : interactionDirectives(plan.interaction);
    const delivered = directives.length
      ? directives.every((s) => ctx.systemPrompt.split("\n\nResponse scope:")[0].includes("- " + s)) &&
        !ctx.systemPrompt.includes("Tools are disabled for this response.")
      : null;
    const d = {
      attempt: n,
      delivered,
      systemSha256: sha(ctx.systemPrompt),
      messagesSha256: sha(ctx.messages),
      toolsSha256: sha(ctx.tools),
      payloadSha256: null,
      status: "started",
      response: null,
    };
    row.drafts.push(d);
    save(path, row);
    const entry = journal.reserve("tutor", id + "/tutor-" + n, m.id, protocol.tutorReserveUsd);
    const work = journal.withWire(entry, m.endpoint, async () => {
      try {
        const stream = streamSimple(model, ctx, {
          ...opts,
          apiKey,
          headers: auth.headers,
          env: auth.env,
          maxTokens: cfg.maxOutputTokens,
          temperature: cfg.temperature,
          maxRetries: 0,
          maxRetryDelayMs: 0,
          timeoutMs: cfg.tutorTimeoutMs,
          cacheRetention: "none",
          onPayload: async (payload, pm) => {
            const v = (await opts?.onPayload?.(payload, pm)) ?? payload,
              wire = JSON.stringify(v);
            must(Buffer.byteLength(wire) <= 160000, "Tutor payload exceeds reserve");
            d.payloadSha256 = sha(wire);
            save(path, row);
            return v;
          },
        });
        const message = await stream.result(),
          u = safeUsage(message.usage);
        d.status =
          message.stopReason === "error"
            ? httpStatus(entry.http, String(message.errorMessage ?? ""))
            : message.stopReason;
        if (["error", "aborted"].includes(message.stopReason)) tutorFailed = true;
        d.response = {
          text: publicText(message),
          nativeTools: message.content.filter((p) => p.type === "toolCall").map((p) => p.name),
          provider: message.provider,
          model: message.model,
          responseModel: message.responseModel ?? null,
          stop: message.stopReason,
          usage: u,
        };
        const cost = u
          ? ((u.input + u.cacheRead + u.cacheWrite) * m.inputPerMillionUsd +
              u.output * m.outputPerMillionUsd) /
            1e6
          : null;
        journal.settle(entry, cost, d.status);
        save(path, row);
        return stream;
      } catch {
        tutorFailed = true;
        d.status = "uncertain";
        journal.settle(entry, null, "uncertain");
        save(path, row);
        throw Error("Tutor transport interrupted");
      }
    });
    pending.push(work);
    return work;
  };
  try {
    const gate = withTeachingDraftGate(tutor, {
      sessionId: id,
      basePrompt: () => base,
      makeCaller: () => judge,
      maxAttempts: cfg.maxDrafts,
      timeoutMs: cfg.turnTimeoutMs,
      refinement: "ordinary",
      judgementModel: {
        id: protocol.judge.model,
        requestTokens: protocol.judge.requestTokenBudgetForParity,
        stateQuestionTokens: protocol.judge.stateQuestionTokenBudgetForParity,
      },
      onProgress: (s) => {
        last = s;
      },
    });
    const stream = await gate(
        model,
        {
          systemPrompt: bundle.systemPrompt,
          messages: [{ role: "user", timestamp: 1, content: c.prompt }],
          tools,
        },
        {},
      ),
      msg = await stream.result();
    await Promise.allSettled(pending);
    const text = publicText(msg),
      notice = parseReviewNotice(text);
    row.phase = last?.phase ?? null;
    row.selection = last?.selectedAttempt ?? null;
    row.reason = last?.reason ?? null;
    row.checks = (last?.attempts ?? []).map((a) => ({
      attempt: a.attempt,
      status: a.status,
      variant: a.variant,
      trimmedCheckpointSuffix: !!a.trimmedCheckpointSuffix,
      findings: a.checks
        .filter((x) => x.status !== "pass")
        .map(({ id, status, probability }) => ({ id, status, probability })),
    }));
    row.public = {
      text: notice?.text ?? text,
      notice: notice?.kind ?? null,
      stop: msg.stopReason,
      tools: msg.content.filter((p) => p.type === "toolCall").map((p) => p.name),
    };
    row.status = judgeFailed ? "decision-unavailable" : journal.ledger.stop ? "interrupted" : "complete";
  } catch {
    row.status = "interrupted";
    await Promise.allSettled(pending);
  }
  row.finishedAt = new Date().toISOString();
  save(path, row);
  console.log(
    JSON.stringify({
      id,
      status: row.status,
      phase: row.phase,
      attempt: row.selection,
      drafts: row.drafts.map((d) => d.status),
      accountedUsd: total(journal.ledger.entries),
    }),
  );
  if (judgeFailed) break;
}
