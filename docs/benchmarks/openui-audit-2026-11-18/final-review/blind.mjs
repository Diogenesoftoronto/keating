// Prepare an identity-free review packet from the completed, sealed synthetic cases.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cohort, read, receiptFile, save, sha, studyCells } from "./study/common.mjs";
import { stripReviewNotice } from "../../../../web/src/keating/judgement/review-notice.ts";
import { inspectOpenUIDiagnosticText } from "../../../../web/src/keating/openui/diagnostic-components.ts";
import { inspectEditableCodeEvidence } from "../../../../web/src/keating/openui/editable-code-evidence.ts";
import { parseOpenUIMessageSegments } from "../../../../web/src/keating/openui/segments.ts";
import { tryCompileOpenUISourceToSharedDocument } from "../../../../packages/learner-contracts/src/openui-source.ts";

export function contents(reply) {
  if (!reply) return null;
  assert.equal(typeof reply.text, "string");
  assert(Array.isArray(reply.toolCalls));
  const text = stripReviewNotice(reply.text);
  const tools = reply.toolCalls.map(call => ({name:call.name, arguments:call.arguments}));
  return {text, tools};
}

export function taskFor(cell) {
  return [...cohort.cases, cohort.followup, cohort.classroom].find(task => task.id === cell.caseId || task.id === cell.id);
}

export function identity(task, output) {
  return sha(JSON.stringify([task.id, output.text, output.tools])).slice(0, 20);
}

export function segments(source) {
  return parseOpenUIMessageSegments(source).map(segment => {
    if (segment.type === "text") return {type:"text", content:segment.content};
    if (segment.complete && segment.format === "document") return {type:"document", document:segment.document};
    if (segment.complete && segment.format === "source") {
      const result = tryCompileOpenUISourceToSharedDocument(segment.rawProgram, {
        documentId:segment.metadata.id, revision:segment.metadata.revision,
        retention:segment.metadata.lifecycle, createdAt:"2026-11-18T00:00:00.000Z",
      });
      if (result.ok) return {type:"document", document:result.document};
    }
    return {type:"invalid", complete:segment.complete};
  });
}

export function inspected(task, reply) {
  const output = contents(reply);
  if (!output) return null;
  return {
    id:identity(task, output), ...output,
    ...inspectOpenUIDiagnosticText(output.text), ...inspectEditableCodeEvidence(output.text),
    segments:segments(output.text), nativeProposed:output.tools.some(call=>call.name==="interactive_page"),
  };
}

function packet() {
  const candidates = new Map();
  for (const cell of studyCells) {
    assert(existsSync(receiptFile(cell.id)), "Study has not closed " + cell.id);
    const row = read(receiptFile(cell.id)), task = taskFor(cell);
    assert.equal(row.id,cell.id);
    assert.equal(row.prompt,task.learner);
    for (const reply of [row.drafts?.[0], row.public]) {
      const output = contents(reply);
      if (!output || !["stop","toolUse"].includes(reply.message?.stopReason)) continue;
      const id = identity(task,output);
      const visible = {id, task:task.id, learner:task.learner, criterion:task.rubric, ...output};
      if (candidates.has(id)) assert.deepEqual(candidates.get(id),visible);
      candidates.set(id,visible);
    }
  }
  return [...candidates.values()].sort((left,right)=>left.id.localeCompare(right.id));
}

if (import.meta.main) {
  const filename = process.argv[2];
  assert(filename && process.argv.length === 3, "Supply the review packet output file.");
  const entries = packet();
  save(filename,{criteria:read(join(import.meta.dir,"study/cohort.json")).id, entries});
  console.log(JSON.stringify({uniqueBodies:entries.length, sha256:sha(entries)}));
}
