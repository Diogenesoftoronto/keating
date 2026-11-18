import assert from "node:assert/strict";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {mkdtempSync,writeFileSync,chmodSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {cohort,displayMessage,sanitizeMessage,sealReceipt,receiptFile,sha} from "./common.mjs";

export function classroomBridge(transport, project, inspect, parseNotice) {
  const lease=cohort.classroom, secret=randomBytes(32).toString("hex"), directory=mkdtempSync(join(tmpdir(),"keating-classroom-lease-"));
  chmodSync(directory,0o700);
  const refs=[], drafts=[], progress={finished:existsSync(receiptFile(lease.id)),plan:null,reviews:0,selects:0,failed:false};
  let inFlight=false;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:255,maxRequestBodySize:1_100_000,async fetch(req) {
    const path=new URL(req.url).pathname, received=(req.headers.get("authorization")??"").replace(/^Bearer /u,"");
    if(received.length!==secret.length || !timingSafeEqual(Buffer.from(received),Buffer.from(secret))) return new Response("Unauthorized",{status:401});
    if(path==="/health" && req.method==="GET") return Response.json({id:lease.id,finished:progress.finished,pending:inFlight,networkOwner:"shared-study-ledger"});
    if(!["/decision","/tutor","/receipt"].includes(path)||req.method!=="POST"||progress.finished||inFlight) return new Response("Outside single-turn lease",{status:409});
    inFlight=true;
    try {
      const body=await req.json();
      if(path==="/decision"){
        assert(!progress.failed);const request=body.request;
        const phase=request.questions.learning_task?"plan":request.questions.draft_choice?"selection":"review";
        assert(JSON.stringify(request.state).includes(lease.learner));
        if(phase==="plan") assert(!refs.length);
        else if(phase==="selection"){assert(drafts.length>=2 && progress.selects++===0);}
        else {assert(drafts.length>0 && ++progress.reviews<=drafts.length);}
        const label=lease.id+"/"+phase+(phase==="review"?"/"+progress.reviews:"");
        const {outcome,ref}=await transport.decision(lease.arm,request,label,req.signal);
        refs.push(ref);
        if(!outcome.ok) progress.failed=true;
        if(phase==="plan" && outcome.ok) progress.plan=project(request.state.turn,outcome);
        return Response.json(outcome);
      }
      if(path==="/tutor"){
        assert(!progress.failed && progress.plan && drafts.length<cohort.maxDrafts && progress.reviews===drafts.length);
        const ctx=body.context;assert(ctx && Array.isArray(ctx.messages) && Array.isArray(ctx.tools) && typeof ctx.systemPrompt==="string");
        assert(ctx.messages.some(m=>m.role==="user" && (typeof m.content==="string"?m.content:m.content.map(p=>p.text??"").join("\n")).includes(lease.learner)));
        const reasoning=body.reasoning??null;assert([null,"off","minimal","low","medium","high","xhigh"].includes(reasoning));
        const {message,entry}=await transport.tutor(lease.tutor,ctx,reasoning,lease.id+"/tutor/"+(drafts.length+1),req.signal);
        if(!["stop","toolUse"].includes(message.stopReason)) progress.failed=true;
        const visible=displayMessage(message);
        drafts.push({...visible,...inspect(visible.text),entryId:entry.id,completed:!progress.failed,
          providedDirectives:progress.plan.directives.every(d=>ctx.systemPrompt.includes("- "+d)),systemSha256:sha(ctx.systemPrompt)});
        return Response.json(message);
      }
      const snap=body.snapshot, m=sanitizeMessage(body.message);assert(snap && ["released","withheld","cancelled"].includes(snap.phase));
      const publicMessage=displayMessage(m),notice=parseNotice(publicMessage.text);
      if(snap.phase==="released"&&!notice) assert(drafts.some(d=>d.completed && d.text===publicMessage.text));
      const row={id:lease.id,kind:"classroom",caseId:"classroom-stage-light",tutor:lease.tutor,arm:lease.arm,prompt:lease.learner,
        originalHistory:[],plan:progress.plan,refs,drafts,attempts:snap.attempts,selectedAttempt:snap.selectedAttempt??null,
        disposition:snap.phase,public:snap.phase==="released"?{...publicMessage,...inspect(notice?.text??publicMessage.text)}:null,
        publicEnvelope:publicMessage,notice:notice?.kind??null,completedAt:new Date().toISOString(),
        classroomContext:{conversationId:typeof body.conversationId==="string"?body.conversationId.slice(0,128):null,
          turnId:typeof body.turnId==="string"?body.turnId.slice(0,128):null}};
      const seal=sealReceipt(row);progress.finished=true;return Response.json({sealed:true,sha256:seal});
    }catch(error){return Response.json({error:String(error?.message??error).slice(0,250)},{status:422});}
    finally{inFlight=false;}
  }});
  const config=join(directory,"bridge.json");
  writeFileSync(config,JSON.stringify({baseUrl:server.url.href.replace(/\/$/u,""),token:secret,cellId:lease.id}),{mode:0o600,flag:"wx"});
  console.log("CLASSROOM_BRIDGE_CONFIG "+config);
  return {progress,close(){server.stop(true);rmSync(directory,{recursive:true,force:true});}};
}
