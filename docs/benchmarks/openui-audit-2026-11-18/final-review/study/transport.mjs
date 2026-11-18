import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cohort, here, root, read, sha, fileSha, usd, total, inputBytes, save, credential, stableContext, sanitizeMessage } from "./common.mjs";

export async function makeTransport(product, models, live, verifyOnly=false) {
  const {createSystemOneCaller} = await import(join(product,"packages/learner-contracts/src/judgement/system-one.ts"));
  const {createGeminiDecisionCaller,readGeminiDecisionUsage} = await import(join(product,"scripts/openui-diagnostics/gemini-decision.ts"));
  const {streamSimple} = await import(join(product,"node_modules/@earendil-works/pi-ai/dist/compat.js"));
  const logFile=join(here,"ledger.json"), manifestSha256=fileSha(join(here,"manifest.json"));
  const ledger=existsSync(logFile)?read(logFile):{version:1,manifestSha256,priorBoundUsd:cohort.priorBoundUsd,capUsd:cohort.allStudyLimitUsd,hardStop:null,entries:[]};
  assert.equal(ledger.manifestSha256,manifestSha256);
  const persist=()=>save(logFile,ledger);
  const originalFetch=globalThis.fetch.bind(globalThis), route=new AsyncLocalStorage();
  let queue=Promise.resolve();
  const serialize=fn=>{const run=queue.then(fn);queue=run.catch(()=>{});return run;};
  const keys={}; const auth={};
  if(live) {
    const {createBenchmarkRegistry}=await import(join(product,"scripts/prompt-adherence/providers.ts"));
    const registry=await createBenchmarkRegistry(join(root,".keating/pi-config"));
    for(const [name,cfg] of Object.entries(cohort.tutors)) {
      const found=registry.find(cfg.provider,cfg.id);assert(found && found.id===models[name].id && found.baseUrl===cfg.endpoint);
      const a=await registry.getApiKeyAndHeaders(found);
      const key=a.apiKey||credential(name==="flash"?"GEMINI_API_KEY":"MINIMAX_API_KEY",name==="flash"?"gemini":"minimax");
      assert(key,"Missing tutor credential for "+name);auth[name]={...a,apiKey:key};
    }
    keys.jev=credential("TYPESAFE_API_KEY","typesafe_api_key");keys.google=auth.flash.apiKey;
    assert(keys.jev && keys.google,"Decision credentials unavailable");
  }
  function reserve(id, kind, cfg, requestSha256, wire, url) {
    assert(live && !ledger.hardStop && !ledger.entries.some(e=>e.id===id),"Repeated or closed transport");
    assert(usd(cohort.priorBoundUsd+total(ledger.entries)+cfg.reserve)<=cohort.matrixAndClassroomTotalCeilingUsd,"Insufficient remaining segment budget");
    for(const key of [...Object.values(keys),...Object.values(auth).map(a=>a.apiKey)]) assert(!key || !wire.includes(key),"Credential found in request body");
    const wireSha256=inputBytes(wire);
    assert(!ledger.entries.some(e=>e.kind===kind && e.model===cfg.id && e.wireSha256===wireSha256 &&
      (!e.finishedAt || !e.http || e.http>=400 || e.status==="transport-uncertain")),"Ambiguous prior wire is never repeated");
    const entry={id,kind,model:cfg.id,requestSha256,wireSha256,host:url.host,path:url.pathname,
      startedAt:new Date().toISOString(),finishedAt:null,reservedUsd:cfg.reserve,accountedUsd:cfg.reserve,http:null,status:"reserved",usage:null};
    ledger.entries.push(entry);persist();return entry;
  }
  function settle(e, cfg, usage, status) {
    if(e.finishedAt) return;
    const cost=usage ? usd((usage.inputTokens*cfg.input+usage.outputTokens*cfg.output)/1e6) : null;
    if(cost!==null) {assert(Number.isFinite(cost)&&cost>=0);e.accountedUsd=cost;if(cost>e.reservedUsd) ledger.hardStop="usage-over-reservation";}
    Object.assign(e,{finishedAt:new Date().toISOString(),usage,status});
    if([401,402,403].includes(e.http) || e.providerError==="billing") ledger.hardStop="auth-or-billing";
    persist();
  }
  function errorTag(text) {
    if(/insufficient[_ ](?:balance|credit|fund)|billing[_ ](?:error|disabled)|balance[_ ]not[_ ]enough/iu.test(text)) return "billing";
    return null;
  }
  // SDK code only gets one bounded POST. The complete actual body is saved before dispatch, with all credential-bearing headers/URL params excluded.
  globalThis.fetch=async(input,init={})=>{
    const s=route.getStore(),url=new URL(input instanceof Request?input.url:String(input));
    assert(live&&s&&!s.dispatched&&url.origin===new URL(s.cfg.endpoint).origin&&
      (init.method??(input instanceof Request?input.method:"GET")).toUpperCase()==="POST","Unreserved network access");
    assert(s.name==="minimax" ? /^\/anthropic\/v1\/messages\/?$/u.test(url.pathname) : /\/models\/gemini-3\.1-flash-lite:streamGenerateContent$/u.test(url.pathname),"Unexpected tutor HTTP path "+url.pathname);
    s.dispatched=true;
    const wire=typeof init.body==="string"?init.body:input instanceof Request?await input.clone().text():Buffer.from(init.body).toString("utf8");
    assert(Buffer.byteLength(wire)<=cohort.maxTutorBytes,"Tutor body over budget");
    const payload=JSON.parse(wire);
    if(s.name==="minimax") {assert.equal(payload.model,s.cfg.id);assert(payload.max_tokens>0 && payload.max_tokens<=cohort.maxOutputTokens);}
    else {assert(payload.generationConfig.maxOutputTokens>0 && payload.generationConfig.maxOutputTokens<=cohort.maxOutputTokens);}
    const e=s.entry=reserve(s.id,"tutor",s.cfg,s.requestSha256,wire,url);
    const response=await originalFetch(input,{...init,redirect:"error"});
    e.http=response.status;persist();
    const copy=response.clone();
    s.bodyObservation=copy.text().then(raw=>{
      e.responseSha256=sha(raw);
      e.providerError=response.ok?null:errorTag(raw);
      const reported=new Set();
      for(const line of raw.split(/\r?\n/u)) {
        if(!line.startsWith("data:")) continue;
        let frame;try{frame=JSON.parse(line.slice(5).trim());}catch{continue;}
        for(const model of [frame.message?.model,frame.modelVersion,frame.model]) if(typeof model==="string" && /^[\w.:\-/]{1,96}$/u.test(model)) reported.add(model);
      }
      e.reportedModels=[...reported];persist();
    }).catch(()=>{e.reportedModels=[];persist();});
    return response;
  };
  async function decision(name,request,label,signal) {
    const cfg=cohort.judges[name],stageSha=sha(request);
    let entryId=null,source=null,metadata=null;
    const fetcher=async(endpoint,init)=>{
      assert.equal(endpoint,cfg.endpoint);assert.equal(init.method,"POST");
      const wire=init.body,wireSha=sha(wire);
      assert(typeof wire==="string" && Buffer.byteLength(wire)<=200000 && JSON.parse(wire).model===cfg.id);
      return serialize(async()=>{
        let e=ledger.entries.find(row=>row.kind==="decision" && row.model===cfg.id && row.wireSha256===wireSha);
        if(e) {
          assert.equal(e.requestSha256,stageSha);
          entryId=e.id;source=e.id===label?"recorded":"wire-cache";
          if(!e.finishedAt||!e.http||!e.response) throw Error("Decision dispatch unavailable without retry");
          return Response.json(e.response,{status:e.http});
        }
        assert(live&&!verifyOnly,"Missing recorded decision "+label);
        if(name==="google") {
          const prior=ledger.entries.findLast(row=>row.model===cfg.id);
          const delay=prior?14000-(Date.now()-Date.parse(prior.startedAt)):0;
          if(delay>0) await Bun.sleep(delay);
        }
        signal?.throwIfAborted();
        e=reserve(label,"decision",cfg,stageSha,wire,new URL(endpoint));e.request=request;entryId=e.id;source="live";persist();
        try {
          const r=await originalFetch(endpoint,{...init,signal,redirect:"error"});e.http=r.status;persist();
          const raw=await r.text();e.responseSha256=sha(raw);
          let parsed={};try{parsed=JSON.parse(raw);}catch{}
          const allowed=["answers","usage","model","model_version","modelVersion"];
          e.response=r.ok?Object.fromEntries(Object.entries(parsed).filter(([k])=>allowed.includes(k))):{};
          e.reportedModels=[parsed.model,parsed.model_version,parsed.modelVersion].filter(x=>typeof x==="string"&&/^[\w.:\-/]{1,96}$/u.test(x));
          e.providerError=r.ok?null:errorTag(raw);
          const u=name==="google"?readGeminiDecisionUsage(parsed):Number.isSafeInteger(parsed.usage?.input_tokens)&&parsed.usage.input_tokens>0
            &&Number.isSafeInteger(parsed.usage.output_tokens)?{inputTokens:parsed.usage.input_tokens,outputTokens:parsed.usage.output_tokens}:null;
          settle(e,cfg,u,r.ok?"received":"http-error");return Response.json(e.response,{status:e.http});
        } catch {settle(e,cfg,null,"transport-uncertain");throw Error("Decision transport unavailable");}
      });
    };
    const caller=name==="jev"?createSystemOneCaller({model:cfg.id,endpoint:cfg.endpoint,apiKey:keys.jev??"offline",requireResolvedModel:true,
      fetch:fetcher,retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0}})
      :createGeminiDecisionCaller({apiKey:keys.google??"offline",fetch:fetcher,onReceipt:r=>{metadata=r;}});
    const outcome=await caller(request,signal);
    return {outcome,ref:{label,entryId,source,requestSha256:stageSha,ok:outcome.ok,model:outcome.ok?outcome.response.backend.model:null,
      error:outcome.ok?null:outcome.error.code,...(metadata?{provenance:metadata.modelProvenance}:{})}};
  }
  async function tutor(name,ctx,reasoning,label,signal) {
    const cfg=cohort.tutors[name],requestSha256=sha([stableContext(ctx),reasoning??null]);
    return serialize(async()=>{
      const prior=ledger.entries.find(row=>row.id===label);
      if(prior) {
        assert.equal(prior.requestSha256,requestSha256,"Restored tutor context differs: "+label);
        if(!prior.message||!prior.finishedAt) throw Error("Uncertain tutor outcome cannot be repeated");
        return {message:prior.message,entry:prior};
      }
      assert(live && !verifyOnly,"Unexpected tutor call "+label);signal?.throwIfAborted();
      const s={name,cfg,id:label,requestSha256,entry:null,dispatched:false};
      try {
        const msg=await route.run(s,async()=>{
          const stream=streamSimple(models[name],ctx,{...auth[name],signal,temperature:cohort.temperature,maxTokens:cohort.maxOutputTokens,
            maxRetries:0,maxRetryDelayMs:0,timeoutMs:cohort.individualTutorTimeoutMs,cacheRetention:"none",...(reasoning && reasoning!=="off"?{reasoning}:{})});
          return await stream.result();
        });
        await s.bodyObservation;
        assert(s.entry,"Tutor SDK stopped before HTTP dispatch");
        const e=s.entry,m=sanitizeMessage(msg);assert.equal(m.model,cfg.id);e.message=m;
        const u=m.usage,good=u?.totalTokens>0 && [u.input,u.output,u.cacheRead,u.cacheWrite].every(x=>Number.isSafeInteger(x)&&x>=0);
        settle(e,cfg,good?{inputTokens:u.input+u.cacheRead+u.cacheWrite,outputTokens:u.output}:null,m.stopReason);
        return {message:m,entry:e};
      } catch(error) {
        if(s.entry) {await s.bodyObservation;settle(s.entry,cfg,null,"transport-uncertain");}
        throw error;
      }
    });
  }
  return {ledger,decision,tutor,drain:()=>queue,rawFetch:originalFetch};
}
