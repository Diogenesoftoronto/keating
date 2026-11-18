// Rebuild locally with `rtk bun docs/benchmarks/openui-audit-2026-11-18/gemini-decision/preview/build.mjs`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeActivityPreview } from "../../policy-holdout/preview/build.mjs";
import { parseOpenUIMessageSegments } from "../../../../../web/src/keating/openui/segments.ts";
import { tryCompileOpenUISourceToSharedDocument } from "../../../../../packages/learner-contracts/src/openui-source.ts";

const directory = import.meta.dir;
const read = path => JSON.parse(readFileSync(resolve(directory, path), "utf8"));
const cohort = read("../../policy-holdout/cohort.json");
const adjudication = read("../adjudication.json");
const model = "MiniMax-M2.7-highspeed";
const judge = "gemini-decision-1";
const cases = [
  { key: "spinner", label: "Spinner prediction", kind: "question-group", guidance: "Question" },
  { key: "bus", label: "Bus frequency", kind: "simulation", guidance: "Simulation" },
];
const words = text => text.trim().split(/\s+/u).filter(Boolean).length;

function releasedSample({ key, label, kind, guidance }) {
  const id = `${model}--${key}`;
  const receipt = read(`../turn-receipts/${id}.json`);
  const { public: reply, decision } = receipt;
  const draft = receipt.drafts.find(d => d.attempt === receipt.selection);
  const check = receipt.checks.find(c => c.attempt === receipt.selection);
  const score = adjudication[id];
  const digest = createHash("sha256").update(reply.text, "utf8").digest("hex");
  if (receipt.id !== id || receipt.configuredModel !== model || receipt.status !== "complete"
    || receipt.phase !== "released" || reply.stop !== "stop" || reply.notice !== null || reply.tools.length
    || !draft?.delivered || check?.status !== "pass" || digest !== score?.publicTextSha256
    || decision.source !== "google" || decision.model !== judge || decision.action !== "create"
    || !decision.targets.includes(guidance)) throw Error(`Release evidence differs for ${id}`);
  const authored = draft.response.text;
  const trimmedWords = words(authored.slice(reply.text.length));
  if (check.trimmedCheckpointSuffix ? !authored.startsWith(reply.text) || !trimmedWords : authored !== reply.text) {
    throw Error(`Unexpected edit between the selected draft and release for ${id}`);
  }

  const segments = parseOpenUIMessageSegments(reply.text).map(segment => {
    if (segment.type === "text") return segment;
    if (!segment.complete || segment.format !== "source") throw Error(`Unexpected OpenUI format in ${id}`);
    const result = tryCompileOpenUISourceToSharedDocument(segment.rawProgram, {
      documentId: segment.metadata.id, revision: segment.metadata.revision,
      retention: segment.metadata.lifecycle, createdAt: receipt.finishedAt,
    });
    if (!result.ok || result.document.nodes.length !== 1 || result.document.nodes[0].type !== kind) {
      throw Error(`Expected one compiled ${kind} in ${id}`);
    }
    return { type: "document", document: result.document };
  });
  if (segments.filter(part => part.type === "document").length !== 1) throw Error(`Unexpected document count in ${id}`);
  const outsideWords = segments.filter(part => part.type === "text")
    .reduce((sum, part) => sum + words(part.content), 0);
  return { key, label, prompt: cohort.cases.find(c => c.id === key).prompt, targets: decision.targets,
    draft: receipt.selection, model, judge, text: reply.text, digest, segments, outsideWords, trimmedWords, note: score.note };
}

await writeActivityPreview(cases.map(releasedSample), { directory, title: "MiniMax with Gemini Decision · Keating" });
