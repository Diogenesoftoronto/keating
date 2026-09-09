/** Contract feedback only. Teaching quality stays unscored for human review. */
import { compileOpenUISourceToSharedDocument, validateUiDocument } from '../../packages/learner-contracts/src/index.js';
import { parseOpenUIMessageSegments } from '../../web/src/keating/openui/segments';
import { createTool } from '../../web/src/keating/browser-tools/shared';

export async function checkRestart(input:any) {
  const { response, tools, expected } = input;
  const content=response.content??''; const calls=response.tool_calls??[];
  const observations={empty:!content.trim()&&!calls.length,characters:content.length,
    question_marks:(content.match(/\?/g)??[]).length,tool_calls:calls.length};
  try {
    if(observations.empty)throw Error('No visible answer or tool call was returned.');
    if(expected.tool) {
      if(calls.length!==1||calls[0].function.name!==expected.tool)throw Error(`This submitted request requires ${expected.tool}.`);
      const call=calls[0],args=JSON.parse(call.function.arguments);
      const schema=tools.find((t:any)=>t.function.name===expected.tool)?.function.parameters;
      if(!schema)throw Error('Tool is not available in this application context.');
      const validator=createTool(expected.tool,'Validate offline contract',schema.properties,async()=> 'validated',schema.required??[]);
      await (validator.execute as any)(call.id,args);
      // These values identify submitted work, not the desired natural-language answer.
      for(const [key,value] of Object.entries(expected.identifiers??{}))if(args[key]!==value)throw Error(`Use the actual submitted ${key}.`);
      if(expected.question_ids && (args.grades.length!==expected.question_ids.length ||
        new Set(args.grades.map((g:any)=>g.question_id)).size!==expected.question_ids.length ||
        args.grades.some((g:any)=>!expected.question_ids.includes(g.question_id))))throw Error('Grade only the actual submitted open-ended question IDs, each once.');
      if(expected.questions && (args.results.length!==expected.questions.length || new Set(args.results.map((r:any)=>r.question)).size!==expected.questions.length || args.results.some((r:any)=>!expected.questions.includes(r.question))))throw Error('Use the actual pending diagnostic questions once each.');
    } else {
      if(calls.length)throw Error('This turn needs a visible teaching response or inline OpenUI, not a native tool call.');
      const surfaces=parseOpenUIMessageSegments(content,'restart-check').filter(s=>s.type==='openui');
      if(!surfaces.length && /<openui|```openui/i.test(content))throw Error('OpenUI markup was not recognized by the application.');
      const documents=surfaces.map(s=>{
        if(!s.complete)throw Error('The OpenUI surface is incomplete.');
        const d=s.format==='source'?compileOpenUISourceToSharedDocument(s.program,{documentId:s.metadata.id}):s.document;
        if(!validateUiDocument(d))throw Error('The OpenUI document is invalid.');
        return d;
      });
      if(expected.component && !documents.some(d=>d.nodes.some((n:any)=>n.type===expected.component)))throw Error(`Return a complete inline OpenUI ${expected.component} activity.`);
    }
    return {contract_passed:true,feedback:'The response satisfies the checked output contract. This does not score explanation, correctness of teaching, or learner benefit.',observations,teaching_quality:null};
  } catch(error) {
    return {contract_passed:false,feedback:String((error as Error).message),observations,teaching_quality:null};
  }
}
if(import.meta.main){const rows=await Bun.file(process.argv[2]).json();await Bun.write(process.argv[3],JSON.stringify(await Promise.all(rows.map(checkRestart)),null,2));}
