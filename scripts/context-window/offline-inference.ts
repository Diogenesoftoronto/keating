#!/usr/bin/env bun
/** Export gold-free model inputs and score saved native inference through the same strict decoder. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { digest } from "./cases.js";
import { encodeSystemOneRequest } from "../../packages/learner-contracts/src/judgement/wire.js";
import { createSystemOneProvider } from "./providers.js";
import { completeSchedule, type Receipt } from "./benchmark.js";
import { writeReports } from "./report.js";

const [mode, planPath, input, output, providerId, model] = process.argv.slice(2);
if (!planPath || !input) throw Error("requires mode plan-path input-or-export-path [output provider-id expected-model]");
const plan = JSON.parse(await readFile(resolve(planPath), "utf8"));
const { sha256, ...body } = plan;
if (sha256 !== digest(body) || plan.trials.some((t: any) => t.requestSha256 !== digest(t.request))) throw Error("plan-integrity-failed");
if (mode === "export") {
  const exported = { parentPlanSha256: sha256, trials: plan.trials.map((t: any) => ({
    id: t.id, requestSha256: t.requestSha256, request: encodeSystemOneRequest(t.request, "kev-latest"),
  })) };
  await writeFile(resolve(input), JSON.stringify(exported), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ trials: exported.trials.length, sha256: digest(exported) }));
} else if (mode === "import") {
  if (!output || !providerId || !model) throw Error("import-requires-output-provider-model");
  const entries = (await readFile(resolve(input), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(row => row.providerId === providerId);
  const byId = new Map();
  const trials = new Map(plan.trials.map((t: any) => [t.id, t]));
  for (const row of entries) {
    const t: any = trials.get(row.trialId);
    if (!t || t.requestSha256 !== row.requestSha256 || byId.has(row.trialId)) throw Error("raw-identity-mismatch-or-duplicate");
    if (!row.error && row.contextProof && (row.contextProof.fullContext === false || row.contextProof.truncated === true)) throw Error("raw-context-was-truncated");
    byId.set(row.trialId, row);
  }
  const receipts: Receipt[] = [];
  const pinnedProvider = plan.providers.find((p: any) => p.id === providerId);
  const revisionManifest = pinnedProvider?.headRevision && pinnedProvider?.encoderRevision
    ? { headRevision: pinnedProvider.headRevision, encoderRevision: pinnedProvider.encoderRevision } : undefined;
  for (const t of plan.trials) {
    const row = byId.get(t.id);
    if (!row) continue;
    if (revisionManifest && (!row.identity || row.identity.headRevision !== revisionManifest.headRevision
      || row.identity.encoderRevision !== revisionManifest.encoderRevision)) throw Error("raw-pinned-revision-mismatch");
    if (!Number.isFinite(row.latencyMs) || row.latencyMs < 0) throw Error("invalid-latency");
    const provider = createSystemOneProvider({ id: providerId, endpoint: "http://127.0.0.1:8008/v1/systemone", model, expectedModel: model, revisionManifest,
      fetch: async () => new Response(JSON.stringify(row.raw), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const outcome = row.error
      ? { status: "error" as const, error: typeof row.error === "string" ? row.error : JSON.stringify(row.error), latencyMs: row.latencyMs }
      : { ...await provider.evaluate(t.request), latencyMs: row.latencyMs };
    receipts.push({ version: 1, trialId: t.id, providerId, providerKind: "system-one", requestedModel: model,
      requestSha256: t.requestSha256, outcome, status: outcome.status === "ok" ? "completed" : "provider-error", repetition: 0 });
  }
  const providers = [{ ...pinnedProvider, id: providerId, kind: "system-one" as const, model, expectedModel: model, endpoint: "http://127.0.0.1:8008/v1/systemone", ...revisionManifest }];
  const all = completeSchedule(plan.trials, providers, 1, receipts);
  const derived = { ...body, providers, parentPlanSha256: sha256, executionNote: "Native local inference on temporary GPU; saved raw outputs decoded offline. No model calls during import." };
  const dir = resolve(output);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(dir, "plan.json"), JSON.stringify({ ...derived, sha256: digest(derived) }, null, 2), { flag: "wx", mode: 0o600 });
  await writeFile(resolve(dir, "receipts.jsonl"), all.map(row => JSON.stringify(row)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  await writeReports(dir, plan.trials, all);
  await writeFile(resolve(dir, "import-provenance.json"), JSON.stringify({ parentPlanSha256: sha256,
    rawSha256: digest(await readFile(resolve(input), "utf8")), decoderSha256: digest(await readFile(new URL("./providers.ts", import.meta.url), "utf8")),
    hashMethod: "sha256(JSON.stringify(UTF8 source text))", modelCalls: 0,
    identities: entries.length ? { first: entries[0].identity ?? entries[0].provenance, last: entries.at(-1).identity ?? entries.at(-1).provenance } : null,
  }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ providerId, completed: all.filter(row => row.status === "completed").length, errors: all.filter(row => row.status === "provider-error").length, missing: all.filter(row => row.status === "not-dispatched").length }));
} else throw Error("mode-must-be-export-or-import");
