import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { auditPath, hashFile, prepareTree, privatePath, restoreVersion21 } from "../replay-source/tree.mjs";

const here = import.meta.dir, audit = resolve(here,".."), root = resolve(audit,"../../..");
assert.equal(hashFile(join(here,"replay.json")),"dece99c90c7bc421dbe009700ab05c3d014652f96726388c7dfc1af041b1341d");
const scratch = mkdtempSync(join(tmpdir(),"keating-python-projection-"));
try {
  prepareTree(root,scratch);
  restoreVersion21(scratch);
  for (const [source,sha] of [
    ["policy-v2.3/source.json.gz","2221302bd7eb31bf629a67da4bf55b7d9423c373a571274531e8cf03f1c332d0"],
    ["policy-v2.3.1-replay/source-overlay.json.gz","be0f51ba61b367be836d4f099d137041304c010845b9077b5099938fbcc508a2"],
  ]) {
    const path = join(audit,source);
    assert.equal(hashFile(path),sha);
    for (const [file,bytes] of Object.entries(JSON.parse(gunzipSync(readFileSync(path))))) {
      const dest = privatePath(scratch,file);
      mkdirSync(dirname(dest),{recursive:true}); writeFileSync(dest,bytes);
    }
  }
  for (const file of ["policy-v2.3.1-replay/run.mjs","policy-v2.3.1-replay/replay.json","policy-v2.3/manifest.json",
    "policy-v2.3-completion/ledger.json",...["jev","google"].map(p=>"policy-v2.3-completion/receipts/python-practice--"+p+".json")]) {
    const dest = privatePath(scratch,join(auditPath,file));
    mkdirSync(dirname(dest),{recursive:true}); copyFileSync(join(audit,file),dest);
  }
  const child = Bun.spawnSync([process.execPath,join(scratch,auditPath,"policy-v2.3.1-replay/run.mjs"),"--verify"],{cwd:scratch,stdout:"inherit",stderr:"inherit"});
  assert.equal(child.exitCode,0);
} finally { rmSync(scratch,{recursive:true,force:true}); }
