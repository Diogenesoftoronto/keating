// Verify both the first dispatch and the selective completion using the same application sources.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { auditPath, hashFile, prepareTree, privatePath, read, restoreVersion21 } from "../replay-source/tree.mjs";

assert.equal(process.argv.length, 2);
const hashes = join(import.meta.dir,"evidence-sha256.json");
assert.equal(hashFile(hashes),"60c3e368411e0cdcde6732aafb54cd22c73a41e4b3bb3caf431fc5f28d0bd754");
const archive = resolve(import.meta.dir,".."), scratch = mkdtempSync(join(tmpdir(),"keating-final-policy-"));
try {
  prepareTree(resolve(archive,"../../.."),scratch);
  // The neighboring operator decoder, aggregator and observers were saved in
  // the earlier hash-verified bundle. Overlay this phase's 116 teaching sources next.
  restoreVersion21(scratch);
  for (const [file,digest] of Object.entries(read(hashes))) {
    const source = join(archive,file), dest = privatePath(scratch,join(auditPath,file));
    assert.equal(hashFile(source),digest,file);
    mkdirSync(dirname(dest),{recursive:true});
    copyFileSync(source,dest);
  }
  const sources = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir,"source.json.gz"))));
  // The original runner enumerates the entire judgement directory. Newer files in
  // the scratch checkout must not become part of the archived policy.
  const judgement = "packages/learner-contracts/src/judgement";
  const original = read(privatePath(scratch,join(auditPath,"policy-v2.3","manifest.json"))).policyHashes;
  const judgementFiles = keys => Object.keys(keys).filter(name => name.startsWith(judgement + "/")).sort();
  assert.deepEqual(judgementFiles(sources),judgementFiles(original));
  rmSync(privatePath(scratch,judgement),{recursive:true});
  for (const [file, data] of Object.entries(sources)) {
    const dest = privatePath(scratch,file);
    mkdirSync(dirname(dest),{recursive:true});
    writeFileSync(dest,data);
  }
  for (const name of ["policy-v2.3","policy-v2.3-completion"]) {
    const result = Bun.spawnSync([process.execPath,join(scratch,auditPath,name,"run.mjs"),"--verify"],
      {cwd:scratch,stdout:"inherit",stderr:"inherit"});
    assert.equal(result.exitCode,0,name);
  }
} finally {
  rmSync(scratch,{recursive:true,force:true});
}
