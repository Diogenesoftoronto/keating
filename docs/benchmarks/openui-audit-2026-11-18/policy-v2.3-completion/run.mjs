// Continue the two tutor requests that demonstrably never left the final-policy harness.
// The dated source and first ledger are immutable. This directory holds the continuation.
import assert from "node:assert/strict";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { plugin } from "bun";
import { fileHash, read, save, total, usd } from "../gemini-decision/journal.mjs";

const here = import.meta.dir, original = resolve(here, "../policy-v2.3");
const mode = process.argv[2];
assert(["--prepare", "--execute", "--verify"].includes(mode) && process.argv.length === 3);
const first = read(join(original, "ledger.json")), manifest = read(join(original, "manifest.json"));
assert.equal(fileHash(join(original,"ledger.json")), "229b670e4d90a91b436d1110150236c600c048f8e083c96b370b3331f66be932");
assert.equal(fileHash(join(original,"manifest.json")), "a6216700eb457098c20867308bd9d1f7a3b304977c48543daa1902d5545561c4");
assert.equal(fileHash(join(original,"run.mjs")), manifest.runnerSha256);
assert.equal(fileHash(join(original,"transport.mjs")), manifest.transportSha256);
assert.equal(usd(1.733468526 + total(first.entries)),1.867477158);
assert.equal(first.entries.filter(e => e.id.startsWith("python-practice--") && e.id.includes("/tutor/")).length, 0);
assert.equal(first.entries.filter(e => e.label?.startsWith("python-practice--") && e.label.endsWith("/plan") && e.http === 200).length, 2);
const path = name => join(here,name);
if (mode === "--prepare") {
  assert(!existsSync(path("ledger.json")) && !existsSync(path("protocol.json")));
  mkdirSync(path("receipts"), {recursive:true});
  for (const name of ["cohort.json","manifest.json","inputs.json.gz","receipts/filling-line--jev.json","receipts/filling-line--google.json","ledger.json"]) {
    copyFileSync(join(original,name), path(name), constants.COPYFILE_EXCL);
  }
  save(path("protocol.json"), { originalLedger:fileHash(join(original,"ledger.json")), runnerSha256:fileHash(import.meta.path),
    originalBoundUsd:1.867477158, allStudyCapUsd:2, allowedCases:["python-practice--jev","python-practice--google"],
    maxTutorPayloadBytes:130000, maxCompletionTokens:3072, tutorReserveUsd:.09, tutorTimeoutMs:90000,
    accounting:"This ledger starts with the seven original entries. Count them once. The previous timeout retains its full reservation." });
  process.exit(0);
}
const protocol = read(path("protocol.json"));
assert.equal(protocol.runnerSha256,fileHash(import.meta.path));
assert.deepEqual(read(path("ledger.json")).entries.slice(0,first.entries.length),first.entries);
assert(usd((130000 + 7000) * .6 / 1e6 + 3072 * 2.4 / 1e6) <= protocol.tutorReserveUsd);
function replaceOnce(source, old, replacement) {
  assert.equal(source.split(old).length,2,"The frozen runner changed: "+old);
  return source.replace(old,replacement);
}
await plugin({ name:"finish-only-never-dispatched-python", setup(build) {
  build.onLoad({filter:/\/(run|transport)\.mjs$/}, args => {
    if (![join(original,"run.mjs"),join(original,"transport.mjs")].includes(args.path)) return;
    let source = readFileSync(args.path,"utf8");
    source = replaceOnce(source,"const here = import.meta.dir;", "const here = join(import.meta.dir, '../policy-v2.3-completion');");
    if (args.path === join(original,"run.mjs")) {
      source = source.replaceAll('fileHash(join(here, "transport.mjs"))', 'fileHash(join(import.meta.dir, "transport.mjs"))');
      source = replaceOnce(source,"timeoutMs: 60000","timeoutMs: 90000");
      source = replaceOnce(source,"Buffer.byteLength(JSON.stringify(payload)) <= 160000","Buffer.byteLength(JSON.stringify(payload)) <= 130000");
    } else {
      source = replaceOnce(source, "total(ledger.entries) + upper > cohort.additionalCapUsd",
        "usd(cohort.previousBoundUsd + total(ledger.entries) + upper) > cohort.studyCapUsd");
      source = replaceOnce(source, 'assert(live, "No recorded decision for " + label);',
        'assert(live && /^python-practice--(jev|google)\\/(review|select)$/.test(label), "Only a new Python draft may need review");');
      source = replaceOnce(source, "const entry = reserve(id, actor.id, 0.12, requestSha256);",
        'assert(/^python-practice--(jev|google)\\/tutor\\/[12]$/.test(id), "Only the undispatched Python tutor cells may run");\n    const entry = reserve(id, actor.id, 0.09, requestSha256);');
    }
    return {contents:source,loader:"js"};
  });
} });
await import(join(original,"run.mjs"));
