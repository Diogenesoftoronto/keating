// From the repository: rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.2/preview/build.mjs
import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha, read, hashFile } from "../../replay-source/tree.mjs";
import { writeActivityPreview } from "../../policy-holdout/preview/build.mjs";
import { parseOpenUIMessageSegments } from "../../../../../web/src/keating/openui/segments.ts";
import { inspectOpenUIDiagnosticText } from "../../../../../web/src/keating/openui/diagnostic-components.ts";
import { inspectEditableCodeEvidence } from "../../../../../web/src/keating/openui/editable-code-evidence.ts";
import { tryCompileOpenUISourceToSharedDocument } from "../../../../../packages/learner-contracts/src/openui-source.ts";
import { createMediaTools } from "../../../../../web/src/keating/browser-tools/media.ts";
import { parseInteractiveSegments } from "../../../../../web/src/components/interactive-segments.ts";
import { parseTutorPagePayload } from "../../../../../web/src/keating/interactive-page/tutor-page.ts";
import { archivedOpening, chromium } from "./browser.mjs";
import { inspectPolicy } from "./policy.mjs";

const here = import.meta.dir, audit = resolve(here,"../.."), repo = resolve(here,"../../../../..");
const json = file => read(join(audit,file));
const hash = file => hashFile(join(audit,file));
const fixedTime = "2026-11-18T00:00:00.000Z";
function segments(text, createdAt = fixedTime) {
  return parseOpenUIMessageSegments(text).map(segment => {
    if (segment.type === "text") return segment;
    assert.ok(segment.complete && segment.format === "source");
    const result = tryCompileOpenUISourceToSharedDocument(segment.rawProgram,{
      documentId:segment.metadata.id,revision:segment.metadata.revision,retention:segment.metadata.lifecycle,createdAt,
    });
    assert.ok(result.ok, JSON.stringify(result));
    return {type:"document",document:result.document};
  });
}
const caseFiles = ["policy-holdout/segment-two--MiniMax-M2.7-highspeed--bus.json","gemini-decision/turn-receipts/MiniMax-M2.7-highspeed--bus.json","policy-v2.2/receipts/conveyor--google.json"];
const ledger = json("policy-v2.2/ledger.json");
const fresh = key => json("policy-v2.2/cohort.json").cases.find(c => c.id === key).learner;
const bus = json("policy-holdout/cohort.json").cases.find(c => c.id === "bus").prompt;
const browser = await chromium.launch({headless:true});
const samples = [];
try {
  for (const [i,source] of caseFiles.entries()) {
    const receipt = json(source), isBus = i < 2;
    assert.equal(isBus ? receipt.phase : receipt.status, "released");
    const attempt = receipt.selection ?? receipt.selectedAttempt, text = receipt.public.text;
    const draft = receipt.drafts[attempt - 1];
    assert.equal(text, isBus ? draft.response.text : draft.text);
    const parts = segments(text,receipt.finishedAt), node = parts.find(p => p.type === "document").document.nodes;
    assert.deepEqual(node.map(n => n.type),["simulation"]);
    const words = inspectOpenUIDiagnosticText(text).outsideWords;
    if (!isBus) assert.equal(words,receipt.public.outsideWords);
    const key = ["bus-jev","bus-google","conveyor"][i];
    const sample = {key,source,digest:sha(text),sourceSha256:hash(source),text,attempt,words,segments:parts,
      model:isBus ? receipt.configuredModel : ledger.entries.find(e => e.id === receipt.id + "/tutor/" + attempt).model,
      reviewer:i === 0 ? "Jev" : "Gemini Decision",prompt:isBus ? bus : fresh("conveyor")};
    if (isBus) {
      sample.archive = source.split("/")[0] + "/preview/minimax-interfaces.html";
      sample.archivedPlayerSha256 = hash(sample.archive);
      sample.old = await archivedOpening(browser,join(audit,sample.archive));
    }
    samples.push(sample);
  }
} finally { await browser.close(); }

const nativeSource = "policy-v2.2/receipts/conveyor--jev.json", native = json(nativeSource);
const entry = ledger.entries.find(e => e.id === native.id + "/tutor/" + native.selectedAttempt);
assert.equal(native.status,"released");
const calls = entry.message.content.filter(c => c.type === "toolCall");
assert.deepEqual(calls.map(c => c.name),native.public.tools);
assert.equal(native.public.text,entry.message.content.filter(c => c.type === "text").map(c => c.text).join(""));
const call = calls.find(c => c.name === "interactive_page");
assert.ok(call && !call.arguments.libraries?.length);
const tool = createMediaTools({}).find(t => t.name === "interactive_page");
const result = await tool.execute(call.id,call.arguments);
const tag = parseInteractiveSegments(result.content.map(x => x.text).join("")).find(p => p.type === "interactive");
assert.ok(tag,"Native tool did not produce an interactive transcript tag");
const payloadText = JSON.parse(tag.json), payload = parseTutorPagePayload(payloadText);
assert.equal(payload.html,call.arguments.html);
assert.equal(native.public.outsideWords,inspectOpenUIDiagnosticText(native.public.text).outsideWords);

const practicePrompt = json("scenarios.json").find(s => s.id === "code").prompt;
const codeFiles = ["evidence/gemini-3.1-flash-lite--code.json","evidence/MiniMax-M2.7-highspeed--code.json"];
const code = codeFiles.map(source => {
  const row = json(source), text = row.drafts[row.selection-1].response.text;
  assert.equal(row.release.text,text);
  assert.equal(row.publicText,"<!--keating:review=unverified-->\n"+text);
  return {source,model:row.model,text,digest:sha(text),attempt:row.selection,
    words:inspectOpenUIDiagnosticText(text).outsideWords};
});
const challenge = segments(code[0].text).find(p => p.type === "document").document.nodes.find(n => n.type === "coding-challenge");
assert.equal(challenge.language,"javascript");
const python = code[1].text.match(/^`{3}python\s*\n([\s\S]*?)\n`{3}/m)?.[1];
assert.ok(python);
const policy = await inspectPolicy(audit,repo,practicePrompt,code.map(c => c.text));
assert.deepEqual(policy.languages,["fail","pass"]);
const finalCase = id => json("policy-v2.3/cohort.json").cases.find(c => c.id === id);
const finalDir = "policy-v2.3-completion";
const finalLedger = json(finalDir + "/ledger.json").entries;
const final = [];
for (const task of ["filling-line","python-practice"]) {
  for (const provider of ["jev","google"]) {
    const source = finalDir + "/receipts/" + task + "--" + provider + ".json";
    const receipt = json(source), base = {task,source,sourceSha256:hash(source),reviewer:provider === "jev" ? "Jev" : "Gemini Decision",
      status:receipt.status,notice:receipt.notice,prompt:finalCase(task).learner,public:null};
    assert.ok(Object.hasOwn(receipt,"public"),source+" has no terminal public disposition");
    if (receipt.public === null) {
      base.disposition = task === "filling-line" && receipt.status === "provider-error" ? "The tutor request timed out. No public reply was observed." :
        receipt.status === "withheld" ? "The release gate withheld the available drafts." : "No public tutor response was captured.";
    } else {
      assert.equal(receipt.status,"released");
      const attempt = receipt.selectedAttempt, text = receipt.public.text;
      const entry = finalLedger.find(e => e.id === receipt.id + "/tutor/" + attempt);
      assert.ok(entry && attempt);
      assert.equal(receipt.drafts[attempt-1].text,text);
      const words = inspectOpenUIDiagnosticText(text).outsideWords;
      assert.equal(words,receipt.public.outsideWords);
      const parts = segments(text,entry.finishedAt);
      base.public = {source,text,words,digest:sha(text),model:entry.model,attempt,segments:parts};
      if (task === "python-practice") {
        const fence = text.match(/^`{3}(?:python|py)[^\n]*\n([\s\S]*?)\n`{3}/mi);
        if (fence) {
          const editor = inspectEditableCodeEvidence(text);
          assert.deepEqual(editor.editableCode,["python"]);
          assert.ok(Number.isSafeInteger(editor.editorOutsideWords));
          base.public.editorOutsideWords = editor.editorOutsideWords;
          base.public.python = fence[1];
          base.public.pythonProse = text.replace(fence[0],"").replace(/^<!--keating:review=[^>]+-->\s*/,"").trim();
        }
      }
      if (task === "filling-line") {
        const sim = parts.flatMap(p => p.type === "document" ? p.document.nodes : []);
        assert.deepEqual(sim.map(s => s.type),["simulation"]);
      }
    }
    final.push(base);
  }
}
samples[2].evidence = {
  native:{source:nativeSource,text:native.public.text,digest:sha(native.public.text),words:native.public.outsideWords,
    model:entry.model,reviewer:"Jev",attempt:native.selectedAttempt,ledgerEntry:entry.id,tools:native.public.tools,
    payloadText,htmlSha256:sha(call.arguments.html),argumentsSha256:sha(JSON.stringify(call.arguments))},
  perimeter:policy.perimeter,final,
  practice:{prompt:practicePrompt,rows:code.map((s,i) => ({...s,language:i === 0 ? challenge.language : "python",
    starter:i === 0 ? challenge.starterCode : python,check:policy.languages[i]}))},
};
await writeActivityPreview(samples,{directory:here,title:"The tutor’s response · Keating"});
const temporary = join(here,"minimax-interfaces.html"), css = readFileSync(join(here,"preview.css"),"utf8");
// The self-contained native page is served as a sandboxed local blob. Both host and page block connections.
const html = readFileSync(temporary,"utf8").replace("connect-src 'none';","frame-src blob:; connect-src 'none';")
  .replace("</head>","<style>" + css + "</style></head>");
writeFileSync(temporary,html);
renameSync(temporary,join(here,"index.html"));
