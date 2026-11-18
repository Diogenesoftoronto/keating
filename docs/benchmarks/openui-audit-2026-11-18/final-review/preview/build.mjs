import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { study } from "../analysis.mjs";
import { inspected } from "../blind.mjs";
import { sha } from "../study/common.mjs";
import { writeActivityPreview } from "../../policy-holdout/preview/build.mjs";

const here=import.meta.dir, unique=new Map();
const finalFile=join(here,"../final.json");
if(existsSync(finalFile)){
  const summary=JSON.parse(readFileSync(finalFile));
  const previous=summary.additional.filter(row=>row.phase.endsWith("/prediction") || row.phase.endsWith("/addendum"));
  study.latest=[...previous,...summary.feedback.generated,summary.feedback.mounted,summary.feedback.postCorrection].map(row=>{
    const receipt=JSON.parse(readFileSync(join(here,"..",row.receipt)));
    const reply=receipt.public?inspected({id:row.caseId},receipt.public):null;
    if(reply) {
      reply.words=reply.editorOutsideWords??(reply.components.length?reply.outsideWords:null);
      reply.fit=null;reply.note=null;
      for(const segment of reply.segments.filter(s=>s.type==="document")){
        const digest=sha(segment.document);unique.set(digest,{key:row.id,digest:digest.slice(0,8),segments:[segment]});
      }
    }
    let classroomNotice=null,privateDrafts=[];
    if(row.caseId==="classroom-confirmation") {
      const dir=row.id===summary.feedback.mounted.id?"live-tile-confirm":"linked-tile-confirm";
      const readLocal=name=>JSON.parse(readFileSync(join(here,"..","classroom",dir,name)));
      classroomNotice=readLocal("evidence.json").visibleAssistant?.text??readLocal("read-only-replay.json").visibleNotice;
      privateDrafts=receipt.drafts.map((draft,index)=>({
        number:index+1,text:draft.text,complete:draft.completed,stop:draft.message.stopReason,
        status:receipt.attempts[index]?.status,tools:draft.toolCalls.map(t=>t.name),
        checks:(receipt.attempts[index]?.checks??[]).filter(c=>c.status!=="pass").map(c=>({name:c.id,status:c.status,probability:c.probability})),
      }));
    }
    return {key:row.id,caseId:row.caseId,version:row.policy.split("/").at(-1),decision:row.decision,prompt:receipt.prompt??receipt.learner??row.learner,
      reply,receipt:row.receipt,status:row.disposition,notice:row.notice,attempt:row.selectedAttempt,classroomNotice,privateDrafts};
  });
}
const liveDocument=study.classroom.document;
unique.set(sha(liveDocument),{key:"classroom-stage-light",digest:sha(liveDocument).slice(0,8),segments:[{type:"document",document:liveDocument}]});
for (const cell of study.cells) for (const reply of [cell.first,cell.final,cell.replay]) {
  for (const segment of reply?.segments??[]) {
    if (segment.type !== "document") continue;
    const digest=sha(segment.document);
    unique.set(digest,{key:cell.id,digest:digest.slice(0,8),segments:[segment]});
  }
}
const samples=[...unique.values()];
if (!samples.length) throw new Error("Expected at least one captured OpenUI document to reproduce.");
samples[0].study=study;
await writeActivityPreview(samples,{directory:here,title:"What reached the learner? · Keating"});
const temp=join(here,"minimax-interfaces.html"), html=readFileSync(temp,"utf8");
const css=readFileSync(join(here,"preview.css"),"utf8");
writeFileSync(join(here,"../index.html"),html.replace("</head>","<style>"+css+"</style></head>"));
unlinkSync(temp);
await import("./report.mjs");
