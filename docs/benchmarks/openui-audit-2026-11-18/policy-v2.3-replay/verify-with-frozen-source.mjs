// The dated projector and review request must still reproduce after later planning changes.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { auditPath, hashFile, prepareTree, privatePath, restoreVersion21 } from "../replay-source/tree.mjs";

const here = import.meta.dir, audit = resolve(here, ".."), root = resolve(audit,"../../..");
const archive = join(audit,"policy-v2.3/source.json.gz");
assert.equal(hashFile(archive),"2221302bd7eb31bf629a67da4bf55b7d9423c373a571274531e8cf03f1c332d0");
assert.equal(hashFile(join(here,"replay.json")),"00915f353b4808c1517e9a8f9917acf7be98de078a290ab198fd5145b0fe331c");
const scratch = mkdtempSync(join(tmpdir(),"keating-conveyor-projection-"));
try {
  prepareTree(root,scratch);
  restoreVersion21(scratch);
  const sources = JSON.parse(gunzipSync(readFileSync(archive)));
  for (const [file,bytes] of Object.entries(sources)) {
    const dest = privatePath(scratch,file);
    mkdirSync(dirname(dest),{recursive:true});
    writeFileSync(dest,bytes);
  }
  const files = ["policy-v2.3-replay/run.mjs","policy-v2.3-replay/replay.json",
    ...["manifest.json","inputs.json.gz","ledger.json","transport.mjs","cohort.json"].map(file => "policy-v2.2/" + file)];
  for (const name of ["conveyor","direct-label","account-seats"]) for (const provider of ["jev","google"]) {
    files.push("policy-v2.2/receipts/"+name+"--"+provider+".json");
  }
  for (const file of files) {
    const dest = privatePath(scratch,join(auditPath,file));
    mkdirSync(dirname(dest),{recursive:true});
    copyFileSync(join(audit,file),dest);
  }
  const child = Bun.spawnSync([process.execPath,join(scratch,auditPath,"policy-v2.3-replay/run.mjs"),"--verify"],
    {cwd:scratch,stdout:"inherit",stderr:"inherit"});
  assert.equal(child.exitCode,0);
} finally {
  rmSync(scratch,{recursive:true,force:true});
}
