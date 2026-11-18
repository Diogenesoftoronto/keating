import type { DebuggingExerciseReview } from "./debugging-exercise.js";
import type { TeachingPolicyCheck, TeachingPolicyReply, TeachingPolicyTurn } from "./teaching-policy-types.js";
import { blocksRelease } from "./teaching-drafts/policy.js";

// A closed arithmetic subset. No Python, learner code or native tool is executed here.
const listPattern = String.raw`\[\s*(?:-?(?:0|[1-9]\d{0,5})(?:\s*,\s*-?(?:0|[1-9]\d{0,5})){0,63})?\s*\]`;
const integerList = new RegExp("^" + listPattern + "$", "u");
const goal = /\b(?:collect|return|print|display|keep|output|list|include)\s+(?:every|all|each)\s+(odd|even)\s+(?:numbers?|integers?|values?|items?)/iu;
const reference = new RegExp(goal.source + String.raw`\s+(?:in|from|of)\s+(?:(?:the|this)\s+(?:list|input)\s*)?(${listPattern})`, "iu");
const expected = new RegExp(String.raw`^(?:expected|intended)(?:\s+(?:output|result))?(?:\s+(?:for|on)\s+(${listPattern}))?\s*[:=]\s*(${listPattern})[.]?$`, "iu");
const inputLabel = new RegExp(String.raw`^(?:input|example input)\s*[:=]\s*(${listPattern})[.]?$`, "iu");
const name = "[A-Za-z_][A-Za-z0-9_]{0,34}";
const reserved = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield __debug__ print range len".split(" "));
type Example = {input:number[]; odd:boolean; answer:number[]};
const same = (a:number[], b:number[]) => a.length===b.length && a.every((value,i)=>value===b[i]);
function numbers(value:string): number[] | null {
  if (!integerList.test(value)) return null;
  const inner = value.slice(1,-1).trim();
  return inner ? inner.split(",").map(Number) : [];
}

// Outside the verified source, allow only neutral task/instruction vocabulary. Any operator,
// number, code identifier, implementation detail, quoted answer, or interrogative abstains.
const neutralWords = new Set(("a about actually against all an and are as at be before below broken bug buggy but can case changed check code collect compare corrected could data different does each edit elsewhere even every exact example exercise expected fault find finding fix fixed for from get given go have here here's how i i'll in independently input intended is it it's job just keep line list locate located make match me my myself no number numbers odd of on once one or order ought output please print printed prints program real repair repaired result return right run running same see send should shown small so some something starter supplied task tell than that the them then these things this those to try version visible want what when where which will with without wrong you your you've").split(" "));
const cleanGoal = new RegExp(goal.source + String.raw`(?:\s+(?:in|from|of) (?:the |this )?(?:given |supplied )?(?:list|input))?(?:,?\s+in (?:the given )?order)?(?:\s+and print them)?`, "giu");
function neutral(text:string, example:Example): boolean {
  const stripped = text.replace(cleanGoal, (phrase:string) => {
    const kind = goal.exec(phrase)?.[1]?.toLowerCase();
    return (kind==="odd") === example.odd ? " task " : " unsupported ";
  }).replace(/\btwo things\b/giu,"things").replace(/\bno (?:hints?|clues?|spoilers?)\b/giu," ")
    .replace(/\bsomething else\b/giu,"different").replace(/[’]/gu,"'");
  // A numeric result, predicate, index, repaired expression or separately authored checkpoint requires ordinary review.
  if (/[^a-zA-Z\s.,:;!'—–-]|\b(?:odd|even|line (?:to|is)|(?:bug|fault|fix) (?:is|lies)(?! real\b| visible\b)|(?:it|this|you) (?:should|ought to) (?:skip|use|start)|(?:give|show|tell) (?:you|the answer))\b/iu.test(stripped)) return false;
  return (stripped.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/gu) ?? []).every(word=>neutralWords.has(word));
}

function task(turn:TeachingPolicyTurn): Example | null {
  const learner=turn.learnerMessage;
  if (learner.length>1200 || (turn.assessment!=="none" && turn.assessment!=="unknown") || turn.conversation.length || turn.learnerEvidence.length ||
    turn.toolResults.length || turn.sources.length || turn.pendingSubmissions?.length || turn.activeWork?.truncated || turn.activeWork?.plan
    || turn.activeWork?.focus || turn.activeWork?.openInteractions.length) return null;
  const match=reference.exec(learner);
  if (!match || /[?`>]|\b(?:quiz|exam|graded?|assess\w*|homework|assignment|predict\w*|guess|checkpoint|puzzle|previous|earlier|before|instead|except|excluding|only if|second task|answer key)\b/iu.test(learner)
    || !/\b(?:give|make|create|write|provide|send)\s+(?:me|us|a|an)\b/iu.test(learner)
    || !/\b(?:buggy|broken|faulty|debugging)\s+python\s+(?:loop|program|function|exercise|example|script)\b/iu.test(learner)
    || !/\b(?:fix|repair|debug)\s+(?:myself|ourselves|independently|on my own)|\b(?:i|we) (?:can|want to) (?:fix|debug|repair)\b/iu.test(learner)
    || /\b(?:without|no|hide|withhold|don['’]t (?:give|show|tell)|do not (?:give|show|tell))\b[^.!?\n]{0,36}\b(?:output|answer|result|expectation)\b/iu.test(learner)) return null;
  if ((learner.match(/\[/gu) ?? []).length!==1 || (learner.match(new RegExp(goal.source,"giu")) ?? []).length!==1) return null;
  // Any additional free-form subject, code, numeric puzzle or task instruction makes the scope unresolved.
  const remaining = learner.replace(match[0],"task").replace(/\b(?:give|make|create|write|provide|send|us|python|loop|function|script|debugging|debug|faulty|hints?|clues?|spoilers?)\b/giu," ");
  const input=numbers(match[2]!);
  if (!input?.length) return null;
  const odd = match[1]!.toLowerCase()==="odd";
  const example={input, odd, answer:input.filter(n=>(Math.abs(n%2)===1)===odd)};
  return neutral(remaining,example) ? example : null;
}

function starter(source:string, example:Example): boolean {
  if (!/^[\x20-\x7e\r\n]+$/u.test(source) || /\r(?!\n)/u.test(source)) return false;
  const lines=source.split(/\r?\n/u).map(line=>line.trimEnd()).filter(Boolean);
  const statements:string[]=[];
  let hasExpected=false, docOpen=false, docIndent:string | undefined;
  for (const line of lines) {
    const text=line.trimStart();
    if (text.startsWith("#") || docOpen || text.startsWith('"""')) {
      let note=text;
      if (text.startsWith("#") && !docOpen) note=text.slice(1).trim();
      else {
        if (!docOpen) {
          if (statements.length>1 || (statements.length===1 && !statements[0]!.startsWith("def "))) return false;
          if (docIndent!==undefined) return false;
          docIndent=line.slice(0,line.length-text.length);
          note=note.slice(3);
          docOpen=true;
        }
        if (note.endsWith('"""')) {note=note.slice(0,-3);docOpen=false;}
        if (note.includes('"""')) return false;
        note=note.trim();
      }
      if (!note) continue;
      const out=expected.exec(note), input=inputLabel.exec(note);
      if (out) {
        if ((out[1] && !same(numbers(out[1])!,example.input)) || !same(numbers(out[2]!)!,example.answer)) return false;
        hasExpected=true;
      } else if (input) {if (!same(numbers(input[1]!)!,example.input)) return false;}
      else if (!neutral(note,example)) return false;
    } else statements.push(line);
  }
  if (docOpen || !hasExpected) return false;
  const signature=new RegExp("^def ("+name+")\\(("+name+")\\):$","u").exec(statements[0] ?? "");
  const inputAssignment=new RegExp("^("+name+")\\s*=\\s*("+listPattern+")$","u").exec(statements[0] ?? "");
  const array=signature?.[2] ?? inputAssignment?.[1];
  if (!array || (inputAssignment && !same(numbers(inputAssignment[2]!)!,example.input)) || statements.length!==(signature ? 7 : 6)) return false;
  const initialized=new RegExp("^( *)("+name+")\\s*=\\s*\\[\\s*\\]$","u").exec(statements[1]!);
  if (!initialized) return false;
  const [base,result]=[initialized[1]!, initialized[2]!];
  if ((signature ? !base.length : !!base.length) || (docIndent!==undefined && docIndent!==base)) return false;
  const loop=new RegExp("^"+base+"for ("+name+") in (.+):$","u").exec(statements[2]!);
  if (!loop) return false;
  const item=loop[1]!, seq=loop[2]!.replace(/\s*([(),-])\s*/gu,"$1");
  const names=[array,result,item,...(signature ? [signature[1]!] : [])];
  if (new Set(names).size!==names.length || names.some(n=>reserved.has(n))) return false;
  const span = seq===array || seq==="range(len("+array+"))" ? example.input
    : seq==="range(1,len("+array+"))" ? example.input.slice(1) : seq==="range(len("+array+")-1)" ? example.input.slice(0,-1) : null;
  if (!span) return false;
  const value=seq===array ? item : array+"\\["+item+"\\]";
  const predicate=new RegExp("^("+base+" +)if "+value+"\\s*%\\s*2\\s*(==|!=)\\s*([01])\\s*:$","u").exec(statements[3]!);
  if (!predicate || !new RegExp("^"+predicate[1]+" +"+result+"\\.append\\("+value+"\\)$","u").test(statements[4]!)) return false;
  if (signature) {
    const print=new RegExp("^print\\("+signature[1]+"\\(("+listPattern+")\\)\\)$","u").exec(statements[6]!);
    if (statements[5]!==base+"return "+result || !print || !same(numbers(print[1]!)!,example.input)) return false;
  } else if (statements[5]!=="print("+result+")") return false;
  const wanted=Number(predicate[3]);
  const actual=span.filter(n=>(Math.abs(n%2)===wanted)===(predicate[2]==="=="));
  return !same(actual,example.answer);
}

/** A target output for a visibly broken independent starter is a test oracle, while the learner still owns the repair. */
export function independentlyVerifiedExpectedOutput(turn:TeachingPolicyTurn, reply:TeachingPolicyReply): boolean {
  if (reply.toolCalls.length || reply.text.length>6000) return false;
  const example=task(turn);
  const block=/^(.*?)^\x60\x60\x60python[ \t]*\r?\n([\s\S]+?)^\x60\x60\x60[ \t]*\r?$(.*)$/imsu.exec(reply.text);
  if (!example || !block || !neutral(block[1]!+" "+block[3]!,example)) return false;
  return starter(block[2]!,example);
}

export function scopeDebuggingExpectedOutput(checks:TeachingPolicyCheck[], review:DebuggingExerciseReview, turn:TeachingPolicyTurn, reply:TeachingPolicyReply): void {
  if (review.example?.choice!=="observable" || review.disclosure?.choice!=="independent") return;
  const specific=["debug_example_unwitnessed","debug_fix_disclosed","debug_location_hint"];
  if (!specific.every(id=>checks.some(c=>c.id===id && c.source==="jev" && c.status==="pass" && c.probability!==null))) return;
  const index=checks.findIndex(c=>c.id==="checkpoint_answer_leaked" && c.source==="jev" && c.severity!=="critical" &&
    c.status==="fail" && c.probability!==null && Number.isFinite(c.probability) && c.probability>=0 && c.probability<=1);
  if (index>=0 && !checks.some((check,i)=>i!==index && blocksRelease(check)) && independentlyVerifiedExpectedOutput(turn,reply)) {
    checks[index]={...checks[index]!,applicability:"debugging-expected-output"};
  }
}
