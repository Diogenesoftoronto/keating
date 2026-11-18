import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, writeFileSync, renameSync, fsyncSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const here=import.meta.dir, audit=resolve(here,"../.."), root=resolve(here,"../../../../..");
export const read=file=>JSON.parse(readFileSync(file,"utf8"));
export const sha=value=>createHash("sha256").update(Buffer.isBuffer(value)||typeof value==="string"?value:JSON.stringify(value)).digest("hex");
export const fileSha=f=>sha(readFileSync(f)), usd=x=>Number(x.toFixed(9)), total=rows=>usd(rows.reduce((n,e)=>n+e.accountedUsd,0));
export const cohort=read(join(here,"cohort.json"));
export function save(path, value) {
  const folder=dirname(path); mkdirSync(folder,{recursive:true});
  const fd=openSync(path+".tmp","w",0o600); try {writeFileSync(fd,JSON.stringify(value,null,2)+"\n");fsyncSync(fd);} finally {closeSync(fd);}
  renameSync(path+".tmp",path);
  const d=openSync(folder,"r"); try{fsyncSync(d);}finally{closeSync(d);}
}
export function inputBytes(body) {
  const bytes=Buffer.from(body), hash=sha(bytes), folder=join(here,"wire"), path=join(folder,hash+".json.gz");
  mkdirSync(folder,{recursive:true});
  if(!existsSync(path)) {const f=openSync(path+".tmp","wx",0o600);try{writeFileSync(f,gzipSync(bytes));fsyncSync(f);}finally{closeSync(f);}renameSync(path+".tmp",path);}
  assert.equal(sha(gunzipSync(readFileSync(path))),hash);
  return hash;
}
export function verifyPrior() {
  const l=join(audit,"policy-v2.3.2-review/ledger.json"), summary=read(join(audit,"policy-v2.3.2-review/summary.json"));
  assert.equal(fileSha(l),"b7de2d03ab9f47928f534747cbd7fe3203d109474da65baf87fc89ba4af6ed9a");
  assert.equal(total(read(l).entries),summary.extraUsd);
  assert.equal(usd(read(join(audit,"policy-v2.3.2-review/protocol.json")).previousBoundUsd+summary.extraUsd),cohort.priorBoundUsd);
  assert.equal(summary.totalBoundUsd,cohort.priorBoundUsd);
}
export const studyCells = [];
for(let b=0;b<6;b++) for(let p=0;p<4;p++) {
  const caseIndex=(b+p)%4, c=cohort.cases[caseIndex], [tutor,arm]=cohort.armCycle[(b+caseIndex)%6];
  studyCells.push({id:[c.id,tutor,arm].join("--"),caseId:c.id,tutor,arm,kind:"primary",prompt:c.learner});
}
for(const [tutor,arm] of [...cohort.armCycle].reverse()) studyCells.push({id:["paper-followup",tutor,arm].join("--"),caseId:"paper-followup",
  tutor,arm,kind:"followup",prompt:cohort.followup.learner,parent:["paper-fold",tutor,arm].join("--")});
assert.equal(new Set(studyCells.map(c=>c.id)).size,30);
export function sourceRoot() {
  const r=Bun.spawnSync(["rtk","proxy","python3","-I",join(here,"source.py"),"restore"],{stdout:"pipe",stderr:"pipe"});
  assert.equal(r.exitCode,0,r.stderr.toString().slice(-1000));return r.stdout.toString().trim();
}
export function lock() {
  if(process.env.KEATING_FINAL_REVIEW_LOCK==="1") return;
  const lockPath=join(root,".keating/benchmarks/openui-audit-2026-11-18/.budget.lock");
  const child=Bun.spawnSync(["rtk","proxy","flock","-n","-E","75",lockPath,process.execPath,...process.argv.slice(1)],
    {env:{...process.env,KEATING_FINAL_REVIEW_LOCK:"1"},stdin:"inherit",stdout:"inherit",stderr:"inherit"});
  process.exit(child.exitCode??1);
}
export function credential(env,skate) {
  if(process.env[env]) return process.env[env];
  const p=Bun.spawnSync(["rtk","proxy","skate","get",skate+"@secrets"],{stdout:"pipe",stderr:"pipe"});
  return p.exitCode===0?p.stdout.toString().trim():null;
}
export const displayMessage=message=>({message,text:message.content.filter(p=>p.type==="text").map(p=>p.text).join("\n"),
  toolCalls:message.content.filter(p=>p.type==="toolCall").map(({name,arguments:args,id})=>({id,name,arguments:args}))});
export function sanitizeMessage(m) {
  return {role:"assistant",api:m.api,provider:m.provider,model:m.model,stopReason:m.stopReason,timestamp:1,usage:m.usage,
    content:m.content.filter(p=>["text","toolCall"].includes(p.type)).map(p=>p.type==="text"?{type:"text",text:p.text}:
      {type:"toolCall",id:p.id,name:p.name,arguments:p.arguments})};
}
export const receiptFile=id=>join(here,"receipts",id+".json");
export function sealReceipt(row) {const file=receiptFile(row.id); assert(!existsSync(file));save(file,row);return fileSha(file);}
export const stableContext=ctx=>({systemPrompt:ctx.systemPrompt,messages:ctx.messages.map(({timestamp,...m})=>m),tools:ctx.tools??[]});
