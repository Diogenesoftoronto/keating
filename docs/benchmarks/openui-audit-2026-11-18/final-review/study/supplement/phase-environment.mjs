// All paid transport logic is reused byte-for-byte. Its journal and charged wires are scoped to this phase.
import assert from "node:assert/strict";
import {existsSync,readFileSync,mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,renameSync} from "node:fs";
import {join} from "node:path";
import {gzipSync,gunzipSync} from "node:zlib";
import {cohort as primary,read,sha,here as study} from "../common.mjs";
export {root,read,sha,fileSha,usd,total,save,credential,stableContext,sanitizeMessage} from "../common.mjs";
const phase=process.argv[2];
assert(["coding","prediction"].includes(phase));
export const here=join(import.meta.dir,phase);
const original=read(join(study,"summary.json"));
const previous=phase==="coding"?original:read(join(import.meta.dir,"coding","summary.json"));
export const cohort={...primary,priorBoundUsd:previous.totalBoundUsd,matrixAndClassroomTotalCeilingUsd:primary.allStudyLimitUsd};
export function inputBytes(wire){
  const bytes=Buffer.from(wire), hash=sha(bytes), folder=join(here,"wire"),file=join(folder,hash+".json.gz");
  mkdirSync(folder,{recursive:true});
  if(!existsSync(file)){const fd=openSync(file+".tmp","wx",0o600);try{writeFileSync(fd,gzipSync(bytes));fsyncSync(fd);}finally{closeSync(fd);}renameSync(file+".tmp",file);}
  assert.equal(sha(gunzipSync(readFileSync(file))),hash);return hash;
}
