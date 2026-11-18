import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createMediaTools } from "../keating/browser-tools/media";
import { createTutorPage } from "../keating/interactive-page/tutor-page";
import { nativeOriginKey, nativeRowOrigins, readNativeTurn, savedNativePageRefs, type NativeMessage } from "../keating/openui/native-page-evidence";
import { createOpenUIDiagnosticStore, diagnosticConversationId } from "../keating/openui/turn-diagnostics";
import { observeOpenUITurns } from "../keating/openui/turn-observer";
import type { KeatingStorage } from "../keating/storage";

const args = { title:"PRIVATE rate control", description:"A range control changes the number of seats per hour shown in an output.",
  html:'<label>Rate <input type="range"></label><output>320</output><script>keating.ready()</script>' };
const tutor = "local";
const learner = { role:"user", content:"Give me an interactive activity." };
const author = (id: string, call: string, model = tutor) => ({ role:"assistant", id, model, stopReason:"toolUse",
  content:[{type:"toolCall",name:"interactive_page",id:call,arguments:args}] });
const final = (model = tutor) => ({ role:"assistant", model, stopReason:"stop", content:[{type:"text",text:"Explore it."}] });
const output = (id: string, result: {content:unknown}) => ({role:"toolResult",toolName:"interactive_page",toolCallId:id,content:result.content,isError:false});
const tool = createMediaTools({} as KeatingStorage).find(t => t.name === "interactive_page")!;

test("the actual native tool joins validation, published result, confirmed save, viewport and opens to one original turn", async () => {
  const db = new IDBFactory(), store = createOpenUIDiagnosticStore(() => db);
  const messages: NativeMessage[] = [];
  const events: Record<string, unknown>[] = [];
  const sessionId = "PRIVATE session";
  const conversation = diagnosticConversationId(sessionId);
  const observer = observeOpenUITurns({ sessionId, store, messages:()=>messages, mode:()=>"baseline", capture:(_,e)=>events.push(e) });
  const call = "PRIVATE-tool-id", source = "PRIVATE-source";
  const valid = await tool.execute(call, args);
  const page = createTutorPage(args);
  if (!page.ok) throw new Error("test page must validate");
  const ref = nativeOriginKey(source, call, page.payload.id);
  messages.push(learner); observer.observe({type:"agent_start"});
  messages.push(author(source, call)); observer.observe({type:"tool_execution_end",toolName:"interactive_page",toolCallId:call,result:valid,isError:false});
  const result = output(call,valid);
  messages.push(result,final());
  // This ready card disappeared before the final tutor response was settled.
  store.nativeObservation(conversation,[ref],{mounted:true,ready:true,visible:false,opened:false,frameFailed:false});
  observer.observe({type:"agent_end"}); await store.settled();
  expect(store.getRows()[0]).toMatchObject({nativePageRequested:true,selected:[],rendered:null,nativePage:{
    succeeded:true,failed:false,attached:true,saved:null,mounted:true,ready:true,visible:false,opened:false,frameFailed:false}});
  expect(savedNativePageRefs(messages)).toEqual([ref]);
  expect(savedNativePageRefs(messages)).toEqual([]);
  store.nativeObservation(conversation,[ref],{saved:true});
  store.nativeObservation("another-conversation",[ref],{opened:true});
  store.nativeObservation(conversation,["unknown"],{opened:true});
  await store.settled();
  expect(store.getRows()[0]!.nativePage).toMatchObject({saved:true,opened:false});
  store.nativeObservation(conversation,[ref],{visible:true,opened:true}); await store.settled();
  const revisions = events.length;
  store.nativeObservation(conversation,[ref],{visible:false,opened:false,ready:true}); await store.settled();
  expect(events).toHaveLength(revisions);
  const restored = createOpenUIDiagnosticStore(()=>db); await restored.settled();
  expect(restored.getRows()[0]!.nativePage).toMatchObject({visible:true,opened:true,saved:true});
  expect(JSON.stringify([events, store.getRows()])).not.toMatch(/PRIVATE|<script>|Explore it|page-[a-f0-9]{8}/);
  observer.dispose();
});

test("ordinary tool rejections, missing execution, orphaned output, reused IDs and tutor changes have distinct outcomes", async () => {
  const rejected = output("reject",await tool.execute("reject",{...args,description:"short"}));
  const valid = output("valid",await tool.execute("valid",args));
  const store = createOpenUIDiagnosticStore(()=>undefined);
  const history: NativeMessage[] = [];
  const observer = observeOpenUITurns({sessionId:"local",store,messages:()=>history,mode:()=>"baseline",capture:()=>{}});
  const run = (messages: NativeMessage[]) => {
    history.push(learner); observer.observe({type:"agent_start"}); history.push(...messages); observer.observe({type:"agent_end"});
  };
  run([author("r","reject"),rejected,final()]);
  run([author("p","unexecuted"),final()]);
  run([author("p1","repeat"),author("p2","repeat"),{...valid,toolCallId:"repeat"},final()]);
  run([author("other","valid","other-tutor"),valid,final()]);
  run([valid,final()]);
  run([author("r2","reject"),rejected,author("v2","valid"),valid,final()]);
  run([author("v3","valid"),valid,author("p3","unobserved"),final()]);
  await store.settled();
  const rows = store.getRows();
  expect(rows.map(r => [r.nativePageRequested,r.nativePage?.succeeded,r.nativePage?.failed,r.nativePage?.attached])).toEqual([
    [true,false,true,false], [true,null,null,null], [true,null,null,null], [null,null,null,null], [false,false,false,false], [true,true,true,true],
    [true,true,null,true],
  ]);
  expect(rows[0]!.nativePage).toMatchObject({mounted:false,opened:false,saved:false});
  expect(rows[5]!.nativePage).toMatchObject({saved:null,ready:null});
  const event = new Map([["a",true]]);
  expect(readNativeTurn([author("s","a")],0,1,event,()=>true,true).evidence).toMatchObject({succeeded:true,attached:null,saved:null});
  expect(readNativeTurn([author("s","a"),{role:"toolResult",toolName:"interactive_page",toolCallId:"a"}],0,2,new Map(),()=>true,true).evidence.succeeded).toBeNull();
  const page = createTutorPage(args);
  if (!page.ok) throw new Error("test page must validate");
  store.nativeObservation(diagnosticConversationId("local"),[nativeOriginKey("v3","valid",page.payload.id)],{mounted:true,ready:true,opened:false});
  await store.settled();
  expect(store.getRows()[6]!.nativePage).toMatchObject({mounted:true,ready:true,opened:null});
  observer.dispose();
});

test("coalesced display rows correlate through a unique exact native tool identity", () => {
  const call = {type:"tool-call",toolName:"interactive_page",toolCallId:"call"};
  const visible = {content:[{type:"text",text:"Merged assistant rounds."},call]};
  const raw = [learner,author("original","call"),final()];
  expect([...nativeRowOrigins([visible],raw)]).toEqual([["call","original"]]);
  expect(nativeRowOrigins([visible,visible],raw).size).toBe(0);
  expect(nativeRowOrigins([visible],[...raw,learner,author("new","call")]).size).toBe(0);
  expect(nativeRowOrigins([{content:[{...call,toolName:"different"}]}],raw).size).toBe(0);
});
