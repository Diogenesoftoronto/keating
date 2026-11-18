import assert from "node:assert/strict";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { cohort as primary, read, sha, usd } from "../common.mjs";
export { root, read, sha, fileSha, usd, total, save, credential, stableContext, sanitizeMessage } from "../common.mjs";
export const here = import.meta.dir;
const protocol = read(join(here, "cohort.json"));
export const cohort = {...primary, priorBoundUsd:protocol.priorBoundUsd,
  matrixAndClassroomTotalCeilingUsd:Math.min(protocol.globalCapUsd,usd(protocol.priorBoundUsd+protocol.phaseMaximumAdditionalUsd))};

export function inputBytes(body) {
  const bytes=Buffer.from(body), hash=sha(bytes), folder=join(here,"wire"), path=join(folder,hash+".json.gz");
  mkdirSync(folder,{recursive:true});
  if (!existsSync(path)) {
    const fd=openSync(path+".tmp","wx",0o600);
    try {writeFileSync(fd,gzipSync(bytes));fsyncSync(fd);} finally {closeSync(fd);}
    renameSync(path+".tmp",path);
    const d=openSync(folder,"r");try { fsyncSync(d); } finally { closeSync(d); }
  }
  assert.equal(sha(gunzipSync(readFileSync(path))),hash);
  return hash;
}
