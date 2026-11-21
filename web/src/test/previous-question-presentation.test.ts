import { expect, test } from "bun:test";
import type { Context } from "@earendil-works/pi-ai";
import type { ActiveWork } from "@keating/learner-contracts";
import { learningMessageId } from "../keating/learning-intelligence/source-navigation";
import { presentationsFromAssistantText } from "../keating/judgement/active-work-host";
import { openCardPresentation, previousQuestionPresentation, registerQuestionSourceRow } from "../keating/judgement/previous-question-presentation";

const text = 'Guess first.\n\n```openui lifecycle=ephemeral id=draw\nroot = LearningSurface([guess], "Draw", "", "ephemeral")\nguess = Question([{ question: "Which?", type: "choice", choices: ["A", "B"] }], "ephemeral", "Prediction", "Choose.")\n```';
const session = "test-session", display = "actual-flue-id";
const messages = [{role:"user",content:"Let me guess.",timestamp:1},{role:"assistant",content:[{type:"text",text}],timestamp:2},
  {role:"user",content:"B.",timestamp:3}] as Context["messages"];
const sourceId = learningMessageId(messages[1],1);
const node = presentationsFromAssistantText(text,{sessionId:session,messageId:display},null)[0]!;
const active = {truncated:false,plan:null,focus:null,openInteractions:[{documentId:node.documentId,nodeId:node.nodeId,
  component:node.component,state:"awaiting",itemId:null,presentedAt:1}]} satisfies ActiveWork;

function committed(documentId = node.documentId, kind = node.component, connected = true) {
  const shared = {getAttribute:(name:string)=>name==="data-shared-openui-document" ? documentId : kind};
  const document = {getAttribute:()=>documentId,querySelector:()=>shared};
  const part = {getAttribute:()=>"ready",querySelectorAll:()=>[document]};
  return {isConnected:connected,querySelectorAll:()=>[part]} as unknown as Element;
}

test("binds the immediately preceding exact message to its true Flue scope and mounted awaiting Question", () => {
  const release = registerQuestionSourceRow(session,committed(),sourceId,display,text)!;
  try {
    expect(previousQuestionPresentation(session,messages,active)).toEqual({assistantTurnIndex:1,documentId:node.documentId,nodeId:"guess"});
    expect(previousQuestionPresentation("another-session",messages,active)).toBeUndefined();
    expect(previousQuestionPresentation(session,[...messages,messages[2]!],active)).toBeUndefined();
    expect(previousQuestionPresentation(session,messages,{...active,truncated:true})).toBeUndefined();
    expect(previousQuestionPresentation(session,messages,{...active,openInteractions:[active.openInteractions[0]!,active.openInteractions[0]!]})).toBeUndefined();
    for (const patch of [{state:"pending-grade"},{state:"graded"},{nodeId:"other"},{documentId:"unrelated"}] as const) {
      expect(previousQuestionPresentation(session,messages,{...active,openInteractions:[{...active.openInteractions[0]!,...patch}]})).toBeUndefined();
    }
    const duplicate=registerQuestionSourceRow(session,committed(),sourceId,"another-flue-row",text)!;
    expect(previousQuestionPresentation(session,messages,active)).toBeUndefined(); duplicate();
  } finally { release(); }
  expect(previousQuestionPresentation(session,messages,active)).toBeUndefined();
});

test("omits a changed or grouped reply, a detached row, a different node, or the wrong renderer scope", () => {
  for (const [element,id,flue,body] of [
    [committed(),sourceId,display,text+" extra"],[committed(),sourceId,sourceId,text],
    [committed(node.documentId,"simulation"),sourceId,display,text],[committed(node.documentId,node.component,false),sourceId,display,text],
    [committed(),"group-of-two",display,text],[committed("other"),sourceId,display,text],
  ] as const) {
    const release=registerQuestionSourceRow(session,element,id,flue,body)!;
    try { expect(previousQuestionPresentation(session,messages,active)).toBeUndefined(); } finally { release(); }
  }
});

test("a typed answer can reach the awaiting card past replies that asked nothing new", () => {
  const release = registerQuestionSourceRow(session,committed(),sourceId,display,text)!;
  const reply = (body: string, timestamp: number) => ({role:"assistant",content:[{type:"text",text:body}],timestamp}) as Context["messages"][number];
  const later = [...messages.slice(0,2),{role:"user",content:"let me think",timestamp:3},reply("Take your time.",4),{role:"user",content:"B",timestamp:5}] as Context["messages"];
  try {
    expect(openCardPresentation(session,later,active)).toEqual({assistantTurnIndex:1,documentId:node.documentId,nodeId:"guess"});
    // The review path still binds only the immediately preceding question.
    expect(previousQuestionPresentation(session,later,active)).toBeUndefined();
    const asked = [...later.slice(0,3),reply("Do you want a hint?",4),later[4]!] as Context["messages"];
    expect(openCardPresentation(session,asked,active)).toBeUndefined();
    expect(openCardPresentation(session,later,active,0)).toBeUndefined();
    expect(openCardPresentation(session,later,{...active,openInteractions:[{...active.openInteractions[0]!,state:"graded"}]})).toBeUndefined();
  } finally { release(); }
});
