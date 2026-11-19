import type { Meta, StoryObj } from "@storybook/react-vite";
import { LessonCallout, LessonFrame, LessonScore } from "./LessonFrame";
import { SharedUiDocumentRenderer } from "../../keating/openui/shared-renderer";
import type { UiDocumentNode } from "@keating/learner-contracts";

const meta = {title:"Learning/Lesson components",component:LessonFrame,parameters:{layout:"padded"}} satisfies Meta<typeof LessonFrame>;
export default meta;
type Story = StoryObj;
const nodes: UiDocumentNode[] = [
  {type:"question",id:"evidence",prompt:"What changes a posterior?",choices:[{id:"a",label:"Observed evidence"},{id:"b",label:"New notation"}]},
  {type:"quiz",id:"check",title:"Bayes",timeLimit:120,questions:[{id:"prior",kind:"multiple_choice",prompt:"Which is the prior?",choices:[{id:"before",label:"Belief before the test"},{id:"after",label:"Belief after the test"}],correctAnswer:"before",explanation:"The prior precedes the evidence."}]},
  {type:"deck",id:"terms",title:"Retrieval cards",topic:"Bayes",cards:[{id:"card-prior",front:"What does the prior describe?",back:"Belief before the evidence."}]},
  {type:"study-plan",id:"plan",title:"Bayes study plan",items:[{id:"terms",title:"Retrieve the terms",estimatedMinutes:10,children:[{id:"retrieve",title:"Explain the prior without notes"}]}]},
  {type:"task",kind:"assignment",id:"assignment",title:"Find the base rate",brief:"Choose a story about a screening test.",items:[{id:"claim",title:"Name the claim and its source"}],submission:{format:"text"}},
  {type:"callout",id:"warning",tone:"warning",title:"Common slip",markdown:"A positive test and a diagnosis are different events."},
];
export const InsideAReply: Story = {render:()=> <SharedUiDocumentRenderer document={{schemaVersion:1,id:"lesson-sheet",revision:0,lifecycle:"ready",supportedSurfaces:["web"],nodes,createdAt:"2026-11-19T00:00:00Z",updatedAt:"2026-11-19T00:00:00Z"}} onAction={()=>true}/>};
export const Result: Story = {render:()=> <LessonFrame glyph="quiz" title="Bayes" kind="Quiz result"><LessonScore score="6.5 of 8" percent={81} time="3:12" correct={6} partly={1} missed={1}/></LessonFrame>};
export const CalloutTones: Story = {render:()=> <>{["info","warning","success","danger"].map(tone=><LessonCallout key={tone} tone={tone} title={tone}>Check the source before using this number.</LessonCallout>)}</>};
