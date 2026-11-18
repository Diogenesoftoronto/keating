import { createElement, createRef, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createAssistantMessageEventStream, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { AssistantChatPanel } from "classroom-src/components/AssistantChatPanel";
import { OpenUiDiagnosticsPanel } from "classroom-src/components/settings/OpenUiDiagnosticsPanel";
import { useConversationRuntime } from "classroom-src/hooks/agent/useConversationRuntime";
import { useSessionPersistence } from "classroom-src/hooks/agent/useSessionPersistence";
import { buildAgentSystemPrompt } from "classroom-src/hooks/agent/system-prompt";
import { teachingDraftEvidence } from "classroom-src/keating/judgement/draft-evidence";
import { loadActiveWork } from "classroom-src/keating/judgement/active-work-host";
import { loadCompleteLearnerStartupContext } from "classroom-src/keating/session-start-hooks";
import { sessions, keatingStorage } from "classroom-src/hooks/keating-storage";
import { FlueConversation } from "classroom-src/keating/flue/conversation";
import { toModelMessagesWithTime } from "classroom-src/keating/flue/model-messages";
import { createKeatingTools, KEATING_SYSTEM_PROMPT } from "classroom-src/keating/browser-tools";
import { DEFAULT_AGENT_RUNTIME_CONFIG } from "classroom-src/keating/agent-runtime-config";
import { filterAvailableKeatingTools } from "classroom-src/keating/capabilities";
import { shouldExposeClientWebSearch } from "classroom-src/keating/provider-web-search";
import { appendKeatingPortableCatalog } from "classroom-src/keating/portable-agent";
import { withTeachingDraftGate } from "classroom-src/keating/judgement/draft-gate";
import { publishTeachingDraftStatus, projectTeachingDraftSnapshot } from "classroom-src/keating/judgement/draft-status";
import { observeOpenUITurns } from "classroom-src/keating/openui/turn-observer";
import { diagnosticConversationId, openUIDiagnosticStore } from "classroom-src/keating/openui/turn-diagnostics";
import { registerKeatingWebMcp } from "classroom-src/keating/webmcp";
import flueRuntime from "virtual:keating-flue-runtime";
import "classroom-src/base.css";
import "classroom-styles/styles.css";
import "classroom-src/components/keating-kit.css";
import "classroom-src/learner-accessibility.css";

// This test host injects only a synthetic conversation and model transports.
// The application supplies its normal composer, turn lifecycle, controls and storage.
const panel = createRef<any>();
const root = createRoot(document.getElementById("app")!);
const options = await (await fetch("/case.json")).json();
const exhibit = options.readOnly ? await (await fetch("/observation.json")).json() : null;
const sessionId = crypto.randomUUID();
const rows = async () => {
  await openUIDiagnosticStore.settled();
  return openUIDiagnosticStore.getRows().filter(row => row.conversationId === diagnosticConversationId(sessionId));
};
const isInspector = new URLSearchParams(location.search).has("inspector");
let chat: FlueConversation;
let lastGateReceipt: any = null;
let stored: Promise<unknown> = Promise.resolve();
let transportCalls = 0;
let stoppedFollowups = 0;
let plannedFollowup: any = null;
const execution: string[] = [];
const localActions: unknown[] = [];
const progress: string[] = [];

async function post(path: string, body: unknown, signal?: AbortSignal) {
  const result = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body), signal});
  if (!result.ok) throw Error("Classroom transport returned HTTP " + result.status);
  return result.json();
}

// Pi's public stream carries the exact final provider message. Browser wall-clock
// and presentation are measured here; provider token streaming is not replayed.
function asStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({type: "error", reason: message.stopReason, error: message});
  } else {
    stream.push({type:"start", partial:{...message, content:[]}});
    for (const [contentIndex, part] of message.content.entries()) {
      if (part.type === "text") {
        stream.push({type:"text_start", contentIndex, partial:message});
        stream.push({type:"text_delta", contentIndex, delta:part.text, partial:message});
        stream.push({type:"text_end", contentIndex, content:part.text, partial:message});
      } else if (part.type === "toolCall") {
        stream.push({type:"toolcall_start", contentIndex, partial:message});
        stream.push({type:"toolcall_delta", contentIndex, delta:JSON.stringify(part.arguments), partial:message});
        stream.push({type:"toolcall_end", contentIndex, toolCall:part, partial:message});
      }
    }
    stream.push({type:"done", reason:message.stopReason, message});
  }
  stream.end(message);
  return stream;
}

async function queryWebMcp(args: Record<string, unknown> = {}) {
  await registerKeatingWebMcp(keatingStorage, []);
  const tool = (window.webMCP as any)?.availableTools?.get("keating.openui_diagnostics");
  if (!tool) throw Error("Diagnostic tool was not registered by the app");
  const result = await tool.execute(args);
  if (result.isError) throw Error("WebMCP diagnostic query failed");
  return JSON.parse(result.content[0].text);
}

function Classroom() {
  const sessionRef = useRef(sessionId);
  const agentRef = useRef<FlueConversation | null>(null);
  const runtime = useConversationRuntime({sessionIdRef:sessionRef});
  const persistence = useSessionPersistence({sessionIdRef:sessionRef, sessionParentIdRef:useRef(null),
    sessionForkedAtRef:useRef(null), agentRef} as any);
  useEffect(() => { void (async () => {
    const model = getModel(options.provider, options.model) ?? options.classroomModel;
    if (model?.provider !== options.provider || model.id !== options.model) throw Error("The classroom cannot resolve the requested tutor");
    const tools = filterAvailableKeatingTools(await createKeatingTools(keatingStorage), {
      coursesAvailable:false, runtime:DEFAULT_AGENT_RUNTIME_CONFIG, speechEnabled:false,
      clientWebSearch:shouldExposeClientWebSearch(model),
    });
    const systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(false,
      KEATING_SYSTEM_PROMPT, "", "", DEFAULT_AGENT_RUNTIME_CONFIG));
    const transport = async (_model:unknown, context:Context, streamOptions:any) => {
      transportCalls++;
      return asStream(await post(options.live ? "/classroom/tutor" : "/classroom/replay",
        {context, reasoning:streamOptions?.reasoning}, streamOptions?.signal));
    };
    const gated = options.live || options.followup ? withTeachingDraftGate(options.followup && !options.live
      ? async () => { throw Error("Offline planning probe has no tutor transport"); } : transport, {
      sessionId, basePrompt:() => KEATING_SYSTEM_PROMPT,
      ...(options.useGateDefaults ? {} : {maxAttempts:options.followup && !options.live ? 1 : 3, timeoutMs:180_000}),
      judgementModel:{id:"jev-1.14.0", requestTokens:64000, stateQuestionTokens:32000},
      ...(options.followup ? {evidence:async()=>({
        ...teachingDraftEvidence(await loadCompleteLearnerStartupContext(keatingStorage)),
        activeWork:await loadActiveWork(keatingStorage,sessionId),
      })} : {}),
      makeCaller:() => (request, signal) => {
        const turn=(request.state as any)?.turn;
        if (options.followup && turn && !plannedFollowup) plannedFollowup={
          previousQuestionPresentation:turn.previousQuestionPresentation??null,
          openInteractions:turn.activeWork?.openInteractions??[],pendingSubmissions:turn.pendingSubmissions?.length??0,
          conversationTurns:turn.conversation.length, previousRole:turn.conversation.at(-1)?.role,
        };
        if (options.followup && !options.live) return Promise.resolve({ok:false,error:{code:"backend-unavailable",retryable:false}});
        return post("/classroom/decision", {request}, signal);
      },
      onProgress:snapshot => {
        if (progress.at(-1) !== snapshot.phase) progress.push(snapshot.phase);
        publishTeachingDraftStatus(sessionId, snapshot);
      },
      onReceipt:receipt => {
        lastGateReceipt = receipt;
        stored = keatingStorage.recordTeachingDraftReceipt({id:sessionId+":"+receipt.messageTimestamp,
          sessionId, messageTimestamp:receipt.messageTimestamp, createdAt:Date.now(),
          snapshot:projectTeachingDraftSnapshot(receipt.snapshot)});
      },
    }) : transport;
    const history = exhibit ? [...(exhibit.priorMessages ?? []),{role:"user",content:exhibit.learner},exhibit.message] : [];
    chat = new FlueConversation({sessionId, initialState:{model, tools, messages:history, systemPrompt},
      convertToLlm:toModelMessagesWithTime, getApiKey:() => "localhost-transport",
      streamFn:(model, context, streamOptions) => {
        if (exhibit) throw Error("Read-only classroom");
        if (options.followup && !context.messages.some(m=>m.role==="assistant")) {
          return post("/classroom/replay",{context},streamOptions?.signal).then(asStream);
        }
        if (context.messages.some(message => message.role === "toolResult")) {
          // A released native proposal may execute its local tool. Its tool result
          // cannot consume a second model turn under this single-conversation lease.
          chat.cancel();
          throw Error("Classroom model lease ended after the local tool result");
        }
        return gated(model, context, streamOptions);
      }}, flueRuntime);
    agentRef.current = chat;
    const observer = observeOpenUITurns({sessionId, messages:() => chat.context.messages,
      // The authenticated decision result supplies guided mode. Release-only replays
      // cannot independently observe the historical planning stage inside this session.
      mode:() => "unknown", capture:() => {}});
    if (!exhibit) chat.observeExecution(event => { execution.push(event.type); observer.observe(event); });
    await panel.current.setConversation(chat, {
      sessionId,
      onBeforeSend:() => {
        if (exhibit) { chat.cancel(); return; }
        if (chat.context.messages.filter(message => message.role === "user").length > (options.followup ? 2 : 1)) {
          // Preserve the learner's actual submitted action without opening another model lease.
          stoppedFollowups++;
          chat.cancel();
        }
      },
      onLocalMessagesChanged:() => persistence.saveSessionSnapshot(chat, sessionId, new Date().toISOString()),
      getPendingLearnerResponses:() => runtime()?.pendingLearnerResponses() ?? [],
      onLearnerResponseDelivered:response => {
        runtime()?.resolveLearnerResponse(response.receiptId);
        runtime()?.resolveAction(response.uiActionId);
      },
    });
    window.addEventListener("keating:openui-action", (event:any) => {
      const action = event.detail?.action;
      if (action?.kind === "canonical") localActions.push({type:action.action.type,
        nodeId:action.action.nodeId, status:action.receipt.state, result:action.receipt.result?.status});
    });
    (window as any).classroom.ready = true;
  })().catch(error => { (window as any).classroom.startupError = String(error) }); }, []);
  return createElement(AssistantChatPanel, {ref:panel});
}

function ReadOnlyInspector() {
  const wrapper=useRef<HTMLElement>(null);
  useEffect(() => {
    const input=wrapper.current?.querySelector<HTMLInputElement>('input[aria-label="Import diagnostic trace"]');
    if (!input) return;
    const transfer=new DataTransfer();
    transfer.items.add(new File([JSON.stringify(exhibit.trace)],"settings-export.json",{type:"application/json"}));
    input.files=transfer.files;
    input.dispatchEvent(new Event("change",{bubbles:true}));
  },[]);
  return createElement("section",{ref:wrapper,"data-inspector":""},createElement(OpenUiDiagnosticsPanel));
}

function Exhibit() {
  return createElement("div",{className:"readonly-classroom"},
    createElement("style",{},'.readonly-classroom{height:100%;display:flex;flex-direction:column}.readonly-top{padding:.6rem 1rem;border-bottom:1px solid var(--border);background:var(--background);font:500 .85rem system-ui;display:flex;align-items:center;justify-content:space-between;gap:1rem}.readonly-top a{text-decoration:underline}.readonly-thread{min-height:0;flex:1}.readonly-thread .composer-root{display:none!important}.readonly-classroom>[data-inspector]{box-sizing:border-box;width:100%;min-width:0;min-height:0;margin:0 auto;overflow:auto}'),
    createElement("header",{className:"readonly-top"},createElement("span",{},"Recorded classroom · "+exhibit.label),
      createElement("a",{href:isInspector?"/":"/?inspector"},isInspector?"Open classroom":"Inspect recorded turn")),
    isInspector ? createElement(ReadOnlyInspector) : createElement("div",{className:"readonly-thread"},createElement(Classroom)));
}

(window as any).classroom = {
  ready:isInspector, sessionId, rows, queryWebMcp,
  async readQuestionState() {
    const [work, profile] = await Promise.all([
      loadActiveWork(keatingStorage,sessionId), loadCompleteLearnerStartupContext(keatingStorage),
    ]);
    return {open:work.openInteractions,pending:(teachingDraftEvidence(profile).pendingSubmissions??[]).length};
  },
  async readSavedAnswers() {
    return (await keatingStorage.getQuestionChecks()).map(item => ({
      answer: item.answer, question: item.question, grading: item.grading, score: item.score ?? null,
    }));
  },
  async checkSavedPaperAnswer() {
    if (exhibit || options.live || options.gradeDemo !== true) throw Error("Local grading demonstration disabled");
    const saved=await keatingStorage.getQuestionChecks();
    if (saved.length!==1 || saved[0].answer!=="4" || !saved[0].question.toLowerCase().includes("layers of paper"))
      throw Error("Expected the actual saved four-layer choice");
    const record=saved[0];
    const pending=async()=>teachingDraftEvidence(await loadCompleteLearnerStartupContext(keatingStorage)).pendingSubmissions??[];
    const before=await pending();
    if (!before.some(check=>check.id===record.id && check.kind==="comprehension")) throw Error("The saved choice is not pending");
    const tool=(await createKeatingTools(keatingStorage)).find(t=>t.name==="grade_question_checks")!;
    // Supply the known arithmetic verdict independently. This is the real local
    // persistence operation; no tutor/judge generated or approved a grade here.
    await tool.execute("classroom-grade-verification", {topic:record.topic,
      results:[{question:record.question,verdict:"correct"}]});
    const after=await pending();
    const graded=(await keatingStorage.getQuestionChecks()).find(c=>c.id===record.id);
    if (after.some(item=>item.id===record.id) || graded?.score!==1) throw Error("Grade did not settle the matching record");
    return {topic:record.topic,question:record.question,answered:record.answer,
      before:{grading:record.grading,score:record.score??null,pendingComprehension:before.length},
      after:{grading:graded.grading,score:graded.score,pendingComprehension:after.length},
      verdictSource:"Predetermined four-layer arithmetic in the offline verification",modelCalls:0};
  },
  async report() {
    await stored;
    const persisted = await sessions.loadSession(sessionId);
    return {sessionId, rows:await rows(), gateReceipt:lastGateReceipt, progress, plannedFollowup, execution,
      transportCalls, stoppedFollowups, localActions, savedMessages:persisted?.messages ?? [],
      transcript:chat?.context.messages, isStreaming:chat?.context.isStreaming};
  },
};
root.render(exhibit ? createElement(Exhibit) : isInspector ? createElement(OpenUiDiagnosticsPanel) : createElement(Classroom));
