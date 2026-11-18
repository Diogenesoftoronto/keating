import { createElement, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import runtimeUrl from "virtual:keating-flue-runtime";
import { AssistantChatPanel } from "../../components/AssistantChatPanel";
import { useAgentHostRefs } from "../../hooks/agent/host-refs";
import { useSessionPersistence, type SessionPersistence } from "../../hooks/agent/useSessionPersistence";
import { sessions } from "../../hooks/keating-storage";
import { createMediaTools } from "../../keating/browser-tools/media";
import { FlueConversation } from "../../keating/flue/conversation";
import { openUIDiagnosticStore as store } from "../../keating/openui/turn-diagnostics";
import { observeOpenUITurns } from "../../keating/openui/turn-observer";
import { KeatingStorage } from "../../keating/storage";
import type { ChatPanelHandle } from "../../types/chat-panel";
import { model, response } from "./flue-chat";

/** Only the tutor stream is synthetic. The page tool, host, chat projection and session save are the application paths. */
export async function runNativePageFixture() {
  const sessionId = "local-native-page-fixture";
  const host = document.body.appendChild(document.createElement("main"));
  host.style.paddingTop = "1700px";
  const panel = createRef<ChatPanelHandle>();
  const storage = new KeatingStorage("keating-eval-native-page");
  const tool = createMediaTools(storage).find(t => t.name === "interactive_page")!;
  let calls = 0, revisions = 0;
  const args = { title:"Bus seats",description:"A frequency slider changes the number of bus seats offered each hour.",
    html:'<label>Frequency <input id="n" type="range" min="1" max="24" value="8"></label><output id="seats">320</output><script>n.oninput=()=>seats.value=n.value*40; keating.ready()</script>' };
  const chat = new FlueConversation({ sessionId, initialState:{ model, tools:[tool], messages:[] },
    getApiKey:()=>"local-fixture", streamFn:()=> {
      calls++;
      if (calls === 1) return response([{type:"toolCall",id:"native-call",name:"interactive_page",arguments:args}],"toolUse");
      if (calls === 3) return response([{type:"toolCall",id:"crashed-page",name:"interactive_page",
        arguments:{...args,title:"Broken example",html:'<p>Local failure fixture</p><script>throw Error("Expected local frame error")</script>'}}],"toolUse");
      if (calls === 5) return response([{type:"text",text:["Try the loop.","```python","for i in range(3):","    print(i + 1)","```"].join("\n")}]);
      return response([{type:"text",text:"Inspect the example."}]);
    } },runtimeUrl);
  let persistence: SessionPersistence | undefined;
  let showPanel: (shown: boolean) => void = () => {};
  function Fixture() {
    const [shown, setShown] = useState(true);
    showPanel = setShown;
    const refs = useAgentHostRefs(undefined,false);
    refs.sessionIdRef.current = sessionId;
    refs.agentRef.current = chat;
    persistence = useSessionPersistence(refs);
    return shown ? createElement(AssistantChatPanel,{ref:panel}) : null;
  }
  const root = createRoot(host);
  root.render(createElement(Fixture));
  const wait = () => new Promise(resolve=>setTimeout(resolve,15));
  const observation = observeOpenUITurns({ sessionId, messages:()=>chat.context.messages, mode:()=>"baseline", capture:()=>{revisions++;} });
  const unsubscribe = chat.observeExecution(event=>observation.observe(event));
  const getRows = async () => { await store.settled(); return store.getRows(); };
  Object.assign(window,{nativePageFixture:{getRows,revisions:()=>revisions, async codeReply() { await chat.send("Give me a Python loop I can fix."); }, async brokenPage() {
    await chat.send("Give me a second interactive activity.");
    await persistence!.saveSessionSnapshot(chat,sessionId,new Date().toISOString());
  }, async remount(){
    showPanel(false);
    while (host.querySelector("[data-interactive-page]")) await wait();
    showPanel(true);
    while (!panel.current) await wait();
    await panel.current!.setConversation(chat,{sessionId});
  }}});
  try {
    for (let i=0; i<150 && !panel.current; i++) await wait();
    if (!panel.current || !persistence) throw new Error("Chat panel did not mount");
    await panel.current.setConversation(chat,{sessionId});
    await chat.send("Give me an interactive activity to try.");
    if (chat.context.errorMessage) throw new Error(chat.context.errorMessage);
    await persistence.saveSessionSnapshot(chat,sessionId,new Date().toISOString());
    if (!JSON.stringify((await sessions.loadSession(sessionId))?.messages).includes("<keating-interactive")) throw new Error("Session save omitted the native tool result");
    if (calls !== 2) throw new Error("The fixture expected one tool round and one final reply");
    await new Promise<void>(resolve=>Object.assign(window,{finishNativePageFixture:resolve}));
    return {calls, revisions, rows:await getRows()};
  } finally {
    observation.dispose(); unsubscribe(); root.unmount(); await chat.dispose(); await storage.destroyIsolatedDatabase();
  }
}
