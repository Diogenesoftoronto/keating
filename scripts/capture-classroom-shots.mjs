#!/usr/bin/env bun
// Capture actual /chat UI restoring authored local history, without hosted inference.
// Uses the same isolated CDP/network boundary as capture-web-clips.mjs.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CDP, start, stop, record, until } from './capture-web-clips.mjs';
const root = resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:3000';
const out = join(root, 'scripts/docs-site/assets/screenshots');
await mkdir(join(root, '.keating/tmp'), { recursive: true });
await mkdir(join(root, '.keating/outputs/video/frames'), { recursive: true });
const profile = await mkdtemp(join(root, '.keating/tmp/classroom-shots-'));
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const model = { id: 'local-tutor', name: 'Local tutor', api: 'openai-completions', provider: 'Keating Demo', baseUrl: 'http://127.0.0.1:9/v1', reasoning: false, input: ['text'], cost: { input:0,output:0,cacheRead:0,cacheWrite:0 }, contextWindow: 32000, maxTokens: 4096 };
const now = new Date().toISOString();
const messages = [
  { role:'user', content:'Why do cities form where they do?', timestamp: Date.now()-60000 },
  { role:'assistant', content:[{type:'text',text:'A city often begins where people have a reason to stop, exchange goods, and stay.\n\nRivers supply water and transport, while sheltered harbours and crossing trade routes bring people together.\n\nIf you were choosing a site for a new city, which of those advantages would matter most, and why?'}], api:model.api, provider:model.provider, model:model.id, usage, stopReason:'stop', timestamp:Date.now()-50000 },
];
const fixture = { id:'documentation-classroom-fixture', title:'Why cities form', model, thinkingLevel:'off', messages, createdAt:now,lastModified:now };
const metadata = { id:fixture.id,title:fixture.title,createdAt:now,lastModified:now,messageCount:2,usage,thinkingLevel:'off',modelProvider:model.provider,modelId:model.id,modelName:model.name,modelApi:model.api,modelReasoning:false,preview:messages[0].content };
const seed = `
localStorage.setItem('keating:judgement-model',JSON.stringify({backend:'off'}));
localStorage.setItem('keating_ui_settings',JSON.stringify({schemaVersion:3,alternativeResponseChance:0}));
localStorage.setItem('keating:onboarding:v1',JSON.stringify({version:2,outcome:'completed',step:7}));
const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('keating',2);r.onupgradeneeded=()=>{for(const n of ['settings','provider-keys','custom-providers'])r.result.createObjectStore(n);for(const n of ['sessions','sessions-metadata']){const s=r.result.createObjectStore(n,{keyPath:'id'});s.createIndex('lastModified','lastModified');}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
await new Promise((resolve,reject)=>{const tx=db.transaction(['sessions','sessions-metadata'],'readwrite');tx.objectStore('sessions').put(${JSON.stringify(fixture)});tx.objectStore('sessions-metadata').put(${JSON.stringify(metadata)});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();`;
let chrome, cdp;
try {
  await mkdir(out,{recursive:true});
  chrome=start('google-chrome',['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--disable-extensions','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=localhost;127.0.0.1;[::1]','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1','about:blank']);
  let endpoint;
  await until(async()=>{if(chrome.exitCode!==null)throw new Error(`Chrome exited: ${chrome.output}`);const a=await readFile(join(profile,'DevToolsActivePort'),'utf8').catch(()=> '');const [port,path]=a.trim().split('\n');if(port&&path)endpoint=`ws://127.0.0.1:${port}${path}`;return !!endpoint;},15000,'Chrome startup');
  cdp=new CDP();await cdp.connect(endpoint);
  for(const [suffix,width,height] of [['desktop',1280,900],['mobile',390,844]]) {
    await record(cdp,{name:`current-classroom-${suffix}`,width,height,seed,steps:[{kind:'goto',path:'/chat'},{kind:'waitFor',text:'which of those advantages would matter most, and why?',timeout:30000},{kind:'wait',ms:1200}]},base,out,undefined,true);
  }
  await writeFile(join(root,'.keating/outputs/video/frames/current-classroom-metadata.json'),JSON.stringify({capturedAt:new Date().toISOString(),version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,source:'/chat',fixture:'Authored local history restored through production IndexedDB sessions; no model request or user data.',screenshots:['current-classroom-desktop.png','current-classroom-mobile.png']},null,2)+'\n');
} catch (error) {
  console.error(`capture-classroom-shots: ${error.message}`);
  process.exitCode = 1;
} finally {
  cdp?.socket.close();await stop(chrome);await rm(profile,{recursive:true,force:true});
}
