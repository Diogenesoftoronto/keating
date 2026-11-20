// Headless tour of Recess in the chat: seed a lesson, open Recess, fly it answering gates by number key,
// and capture each new gate kind, the target gate, the explain-it pause, the flight log and the "where we covered this" jump.
// Usage: node tour.mjs <cdpPort> <appPort> <fixtureName> [outDir]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const [cdpPort, appPort, fixture = "cells", outArg] = process.argv.slice(2);
const out = outArg ?? join(here, "frames");
mkdirSync(out, { recursive: true });
const lesson = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"))[fixture];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const waiting = new Map(); const errors = [];
ws.addEventListener("message", ev => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(out, `${fixture}-${name}.png`), Buffer.from(s.result.data, "base64")); console.log("shot", name); };
const key = async (k) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code: `Digit${k}`, text: type === "keyDown" ? k : undefined, windowsVirtualKeyCode: 48 + Number(k) }); };

await send("Runtime.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${appPort}/chat` });
await sleep(9000);
const sid = `tour-${fixture}`;
await evaluate(`(async()=>{localStorage['keating:onboarding:v1']=JSON.stringify({version:2,outcome:"completed",step:0});
const {sessions}=await import('/src/hooks/keating-storage.ts');const t=Date.now();const z={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const turns=${JSON.stringify(lesson)};
const messages=turns.map((x,i)=>x.role==='learner'?{role:'user',content:[{type:'text',text:x.text}],timestamp:t+i}:{role:'assistant',content:[{type:'text',text:x.text}],api:'x',provider:'x',model:'x',usage:z,stopReason:'stop',timestamp:t+i});
const now=new Date().toISOString();await sessions.save({id:'${sid}',title:'${fixture}',messages,createdAt:now,lastModified:now,thinkingLevel:'off'},{id:'${sid}',title:'${fixture}',createdAt:now,lastModified:now,messageCount:messages.length,usage:z,thinkingLevel:'off',preview:''});return 'ok'})()`);
await send("Page.navigate", { url: `http://127.0.0.1:${appPort}/chat?session=${sid}` });
await sleep(9000);
console.log("open:", await evaluate(`new Promise(r=>{const t0=Date.now();const f=()=>{const b=[...document.querySelectorAll('.ch-study-activity')].find(b=>b.textContent.includes('Recess'));if(b){b.click();r('clicked')}else if(Date.now()-t0>30000)r('no button');else setTimeout(f,500)};f()})`));
await sleep(5000);
console.log("strip:", JSON.stringify(await evaluate(`document.querySelector('.recess-strip')?.innerText`)));
await shot("01-strip");
console.log("start:", await evaluate(`(()=>{const b=document.querySelector('.recess-strip .recess-start');if(!b)return 'no start';if(b.disabled)return 'disabled: '+b.textContent;b.click();return 'started'})()`));
await sleep(1500);
const r = JSON.parse(await evaluate(`JSON.stringify(document.querySelector('.recess-field')?.getBoundingClientRect())`));
const seen = new Set(); let k = 0; const until = Date.now() + 240000; let explained = false;
while (Date.now() < until) {
  k++;
  // A gentle weave low in the arena, away from most fire.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.left + r.width / 2 + Math.sin(k / 18) * r.width * 0.3, y: r.top + r.height * 0.72 + Math.cos(k / 11) * 30, pointerType: "mouse" });
  await sleep(40);
  if (k % 8) continue;
  const state = await evaluate(`(()=>{if(!document.querySelector('.recess-chat-stage'))return {ended:true};
    const g=document.querySelector('.recess-gate');const e=document.querySelector('.recess-explain');const w=document.querySelector('.recess-wind:not(.recess-explain)');
    return {gate:g?(g.dataset.kind||'plain'):null,explain:e?(e.querySelector('textarea')?'write':'graded'):null,wind:!!w}})()`);
  if (state.ended) break;
  if (state.explain === "write" && !explained) {
    explained = true;
    await shot("05-explain");
    await evaluate(`(()=>{const t=document.querySelector('.recess-explain textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'Because meiosis halves the number of chromosomes, so two gametes make a full set again');t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.recess-explain .recess-key').click()})()`);
    await sleep(2500);
    await shot("06-explain-graded");
    await evaluate(`document.querySelector('.recess-explain-result .recess-key')?.click()`);
    continue;
  }
  if (state.wind) { await shot("07-second-wind"); await key("1"); await sleep(1500); continue; }
  if (state.gate && !seen.has(state.gate)) {
    seen.add(state.gate);
    await sleep(state.gate === "oddone" ? 1400 : 500);
    await shot(`03-gate-${state.gate}`);
    await key(String(1 + (seen.size % 2)));
    await sleep(700);
    await shot(`04-gate-${state.gate}-answered`);
  } else if (state.gate) await key("1");
}
await sleep(4000);
console.log("log:", JSON.stringify(await evaluate(`document.querySelector('.recess-log')?.innerText`)));
await shot("08-log");
console.log("cite:", await evaluate(`(()=>{const b=[...document.querySelectorAll('.recess-log-actions button')].find(b=>b.textContent.includes('Show me'));if(!b)return 'no miss to cite';b.click();return 'clicked'})()`));
await sleep(700);
console.log("cited:", await evaluate(`!!document.querySelector('.keating-bubble.recess-cited') || document.querySelector('.recess-strip')?.innerText.includes('loaded any more') || document.querySelector('.recess-strip')?.innerText.includes('point to one place')`));
await shot("09-cited");
console.log("errors:", errors.length ? [...new Set(errors.map(e => e.split("\n").slice(0, 2).join(" | ")))] : "none");
ws.close();
