import { validateUiActionAgainstDocument, validateUiActionReceipt } from "../../packages/learner-contracts/src/index.js";
import { validateAnswer } from "./validate_openui_sft";
import { parseLearnerResponse } from "../../web/src/keating/learner-response";
import { createTool } from "../../web/src/keating/browser-tools/shared";

export async function validateConversations(catalog:any, declarations:any[]) {
  const tools=new Map(declarations.map(d=>[d.function.name,d.function.parameters]));
  const families=new Map<string,string>(); const ids=new Set<string>();
  const counts={conversations:0,messages:0,assistant_targets:0,tool_calls:0,learner_responses:0,openui:0,exams:0,quizzes:0,flashcards:0};
  const toolCounts:Record<string,number>={};
  for(const c of catalog.conversations) {
    if(ids.has(c.id)||!['train','validation'].includes(c.split))throw Error("Duplicate conversation or invalid split");
    ids.add(c.id);
    if(families.has(c.family)&&families.get(c.family)!==c.split)throw Error("Topic family leaks across splits");
    families.set(c.family,c.split);
    if(c.messages.length<20||c.messages[0].role!=="user"||c.messages.at(-1).role!=="assistant")throw Error("Expected a complete long conversation");
    const pending=new Map<string,string>(); const usedCalls=new Set<string>(); const pendingChecks=new Map<string,string>(); const quizResults=new Map<string,any>(); const surfaces=new Map<string,any>();
    for(const [i,m] of c.messages.entries()) {
      counts.messages++;
      if(typeof m.content!=="string"||!['user','assistant','tool'].includes(m.role))throw Error("Invalid message");
      if(pending.size&&m.role!=="tool")throw Error("Missing tool result before continuation");
      if(m.role==='tool') {
        if(pending.get(m.tool_call_id)!==m.name)throw Error("Orphan or mismatched tool result");
        pending.delete(m.tool_call_id);continue;
      }
      if(m.role==='user') {
        if(m.content.includes('<keating-learner-response')) {
          const e=parseLearnerResponse(m.content);if(!e)throw Error("Invalid learner response");
          counts.learner_responses++;
          if(e.kind==='openui-action'&&e.payload.kind==='canonical'){
            const p=e.payload;
            if(!validateUiActionAgainstDocument(p.action,p.sourceDocument)||!validateUiActionReceipt(p.receipt))throw Error("Invalid canonical completion");
            for(const node of p.sourceDocument.nodes)if(JSON.stringify(surfaces.get(node.id))!==JSON.stringify(node))throw Error("Submission differs from the authored surface");
          }
          if(e.kind==='openui-action'&&e.payload.kind==='canonical'&&e.payload.action.type==='complete-quiz'){
            const action=e.payload.action;
            const quiz=e.payload.sourceDocument.nodes.find(n=>n.id===action.nodeId&&n.type==='quiz');
            if(!quiz||quiz.type!=='quiz')throw Error("Unknown submitted OpenUI quiz");
            quizResults.set(action.resultId,{quiz:{questions:quiz.questions.map(q=>({...q,type:q.kind}))}});
          }
          if(e.kind==='question')for(const a of e.payload.answers)if(a.grading==='pending')pendingChecks.set(a.question,e.payload.topic??'');
        }
        const match=m.content.match(/<keating-quiz-result json=("(?:\\.|[^"\\])*") \/>/);
        if(match){const result=JSON.parse(JSON.parse(match[1]));quizResults.set(result.id,result);}
        continue;
      }
      counts.assistant_targets++;
      if(m.tool_calls?.length) {
        if(m.content.trim())throw Error("Tool-only target has duplicate prose");
        for(const call of m.tool_calls) {
          const name=call.function.name; const schema=tools.get(name);
          if(name==="quiz"||name==="deck")throw Error("Create activities with OpenUI Quiz and Flashcards, not native tools");
          if(!schema||usedCalls.has(call.id))throw Error("Undeclared tool or duplicate call id");
          const args=JSON.parse(call.function.arguments);
          const validator=createTool(name,"Validate an offline fixture",schema.properties,async()=>"valid",schema.required??[]);
          await (validator.execute as any)(call.id,args);
          if(name==='grade_question_checks')for(const r of args.results){if(pendingChecks.get(r.question)!==args.topic)throw Error("Grading a preference, unseen question or duplicate response");pendingChecks.delete(r.question);}
          if(name==='grade_quiz') {
            const result=quizResults.get(args.result_id);if(!result)throw Error("Unknown quiz submission");
            for(const g of args.grades){const q=result.quiz.questions.find((q:any)=>q.id===g.question_id);if(!q||!['short_answer','transfer','fill_in'].includes(q.type))throw Error("Grading an objective or unknown question");}
          }
          usedCalls.add(call.id);pending.set(call.id,name);counts.tool_calls++;toolCounts[name]=(toolCounts[name]??0)+1;
        }
      } else {
        const result=validateAnswer(m.content,`${c.id}-${i}`,true);
        if(result.mode==='openui'){counts.openui++;for(const node of result.document!.nodes)surfaces.set(node.id,node);}
        counts.exams+=result.exams??0; counts.quizzes+=result.quizzes??0; counts.flashcards+=result.flashcards??0;
      }
    }
    if(pending.size||pendingChecks.size)throw Error("Unresolved tool call or diagnostic response");
    counts.conversations++;
  }
  if(new Set(families.values()).size!==2)throw Error("Missing validation or training split");
  return {...counts,tool_counts:toolCounts,split_counts:Object.fromEntries(['train','validation'].map(s=>[s,catalog.conversations.filter((c:any)=>c.split===s).length])),message_range:[Math.min(...catalog.conversations.map((c:any)=>c.messages.length)),Math.max(...catalog.conversations.map((c:any)=>c.messages.length))]};
}

if(import.meta.main){
  const catalog=await Bun.file(process.argv[2]).json();
  const tools=await Bun.file(process.argv[3]).json();
  console.log(JSON.stringify(await validateConversations(catalog,tools)));
}
