/** Synthetic long sessions; real tool implementations execute against isolated memory only. */
import { createAssessmentTools } from "../../web/src/keating/browser-tools/assessment";
import { createTeachingTools } from "../../web/src/keating/browser-tools/teaching";
import { createQuestionLearnerResponse, createOpenUIActionLearnerResponse, serializeLearnerResponse } from "../../web/src/keating/learner-response";
import type { KeatingStorage } from "../../web/src/keating/storage";
import { compileOpenUISourceToSharedDocument } from "../../packages/learner-contracts/src/index.js";
import { dispatchSharedUiAction } from "../../web/src/keating/openui/shared-actions";
import { applyReview, initialSrsState } from "../../web/src/keating/srs";
import { mkdir } from "node:fs/promises";

const j = JSON.stringify;
const AT = "2026-09-06T20:00:00.000Z";
type Q = { question: string; correctAnswer: string; explanation: string; type?: string; level?: string; options?: string[]; rubric?: string };
type Topic = { id: string; split: "train" | "validation"; title: string; lesson: string; diagnostic: string; wrong: string; correction: string; transfer: string; transferAnswer: string; facts: [string, string][]; problem: (n: number) => Q; simulation: string };
const topics: Topic[] = [
  { id:"fractions",split:"train",title:"Equivalent fractions",lesson:"A fraction names part of a whole. Equivalent fractions keep that amount unchanged: multiplying both numerator and denominator by the same nonzero factor gives another name for it. One half equals two quarters. The pieces change size, but the total share does not.",diagnostic:"Does multiplying only the numerator of 1/2 by two preserve the fraction? Explain.",wrong:"Yes, because doubling any part makes an equivalent fraction.",correction:"Doubling only the numerator changes 1/2 into 2/2, which is one whole. Both parts must scale together to preserve the ratio.",transfer:"A recipe needs 1/2 cup of milk, but you have only a quarter-cup measure. How many full measures do you need, and why?",transferAnswer:"Two quarter-cup measures; 2/4 is the same amount as 1/2.",facts:[["What changes when 1/2 becomes 2/4?","The partition becomes finer; the amount stays the same."],["Why scale both parts of a fraction?","The ratio stays fixed when both are multiplied by the same nonzero factor."],["Is 2/2 equivalent to 1/2?","No. 2/2 is one whole; 1/2 is half a whole."],["How can you check equivalence visually?","Shade both fractions on equal-sized wholes and compare the shaded amounts."]],problem:n=>({question:`Write an equivalent fraction to 1/2 with denominator ${n*2}.`,correctAnswer:`${n}/${n*2}`,explanation:`Multiply both parts of 1/2 by ${n}.`}),simulation:'Simulation("fraction-ratio", "Scale both parts", [{id:"factor",label:"Scale factor",min:1,max:10,step:1,value:2}], [{id:"numerator",label:"Numerator",expr:"factor"},{id:"denominator",label:"Denominator",expr:"2 * factor"},{id:"ratio",label:"Value",expr:"factor / (2 * factor)",precision:2}], "workspace", "Predict whether the value changes when the scale factor changes.")' },
  { id:"discounts",split:"train",title:"Percentage discounts",lesson:"Percent means parts per hundred. A 10% discount on $80 saves $8, leaving $72. The saving is original price times percentage divided by 100; the sale price subtracts that saving. Equal dollar savings can be different percentage savings when original prices differ.",diagnostic:"A $100 item is 20% off. Is the sale price $20? Explain.",wrong:"Yes, 20% means the item now costs $20.",correction:"The $20 is the saving. Subtract it from $100 to get a sale price of $80.",transfer:"Shop A takes $10 off a $50 item; shop B takes $10 off a $100 item. Which offers the larger percentage saving, and why?",transferAnswer:"Shop A: 10/50 is 20%, while 10/100 is 10%.",facts:[["How do you calculate a percentage saving?","Original price × percentage / 100."],["How do you find the sale price?","Subtract the saving from the original price."],["Can equal dollar savings have different percentages?","Yes; divide each saving by its own original price."],["Does 20% off followed by 20% up restore a price?","No. $100 becomes $80 and then $96 because the second percentage uses $80."]],problem:n=>({question:`An item costs $${n*10} before a 10% discount. What is its sale price?`,correctAnswer:`$${n*9}`,explanation:`The saving is $${n}; subtract it from $${n*10}.`}),simulation:'Simulation("discount-lab", "Change the discount", [{id:"discount",label:"Discount",unit:"%",min:0,max:80,step:5,value:20}], [{id:"sale",label:"Sale price on $100",unit:"$",expr:"100 * (1 - discount / 100)",precision:2}], "workspace", "Predict the sale price before moving the slider.")' },
  { id:"loops",split:"train",title:"Loop boundaries",lesson:"For an array of length three, valid indices are 0, 1 and 2. A loop starting at i = 0, increasing i by one and continuing while i < length visits each valid index once. Using <= length adds an invalid index. An empty array should produce no iterations.",diagnostic:"An array has length 3. Is index 3 a valid element? Explain.",wrong:"Yes, length 3 means index 3 is the last element.",correction:"The last index is 2 because counting starts at zero. Index 3 is one past the last element.",transfer:"You are rendering four menu items with a zero-based loop. State a safe condition and the visited indices.",transferAnswer:"Use i < 4 with i starting at 0 and increasing by one; visit 0, 1, 2 and 3.",facts:[["What is the last index of a nonempty array of length n?","n - 1."],["Which loop guard avoids visiting index length?","i < items.length, starting at zero and incrementing by one."],["How often should this loop run on an empty array?","Zero times."],["What causes the extra undefined in a <= length loop?","It reads one index beyond the array’s valid range."]],problem:n=>({question:`An array has ${n} elements. What is its last valid zero-based index?`,correctAnswer:String(n-1),explanation:`The indices run from 0 through ${n-1}.`}),simulation:'Simulation("loop-count", "An extra iteration", [{id:"length",label:"Array length",min:0,max:10,step:1,value:3}], [{id:"safe",label:"Iterations with i < length",expr:"length"},{id:"unsafe",label:"Iterations with i <= length",expr:"length + 1"}], "workspace", "Assume i starts at zero and increments by one. Compare the guards at length zero.")' },
  { id:"unit-price",split:"train",title:"Unit prices",lesson:"To compare pack prices, use the same unit. A $4 pack containing 500 g costs $0.80 per 100 g: 4 / 500 × 100. A smaller sticker price does not guarantee a lower unit price. Check quantity, units, and whether you can use the whole pack.",diagnostic:"A $3 pack must be better value than a $4 pack. Is that enough information?",wrong:"Yes, the cheaper sticker price always wins.",correction:"You also need the quantity. Divide each price by its quantity in the same unit before comparing value.",transfer:"Compare 500 g for $4 with 750 g for $5. Which has the lower price per 100 g?",transferAnswer:"The 750 g pack: about $0.67 per 100 g, compared with $0.80 per 100 g.",facts:[["How do you calculate price per 100 g?","Price / grams × 100."],["What must stay consistent when comparing unit prices?","The measurement unit and quantity basis."],["Does lower sticker price prove better value?","No. The amount of product may be smaller."],["What can make the larger pack a poor choice despite its unit price?","Waste, storage limits or needing less than the full pack."]],problem:n=>({question:`A 500 g pack costs $${n}. What is its price per 100 g?`,correctAnswer:`$${(n/5).toFixed(2)}`,explanation:`Divide $${n} by five because 500 g contains five 100 g units.`}),simulation:'Simulation("pack-price", "Compare pack sizes", [{id:"grams",label:"Pack size",unit:"g",min:100,max:1000,step:50,value:500}], [{id:"unit",label:"Price per 100 g for a $4 pack",unit:"$",expr:"400 / grams",precision:2}], "workspace", "Predict how a larger pack changes unit price when the total price stays $4.")' },
  { id:"area",split:"validation",title:"Rectangle area",lesson:"Area measures a surface in square units. A rectangle’s area is length times width. Perimeter measures its boundary and equals twice the sum of length and width. A 4 m by 3 m floor covers 12 square metres and has a perimeter of 14 metres. Tile coverage uses area, not perimeter.",diagnostic:"For a 4 m by 3 m floor, is 4 + 3 = 7 square metres its area? Explain.",wrong:"Yes, adding the sides measures how much floor there is.",correction:"Multiplying counts the rows of unit squares: 4 × 3 = 12 square metres. Adding the sides does not count the surface.",transfer:"A 4 m by 3 m floor uses tiles covering 0.25 square metres each. How many whole tiles cover it before allowing for cuts?",transferAnswer:"48 tiles: the floor covers 12 square metres, and 12 / 0.25 is 48.",facts:[["How do you find a rectangle’s area?","Multiply length by width, using consistent units."],["Which units describe area?","Square units, such as square metres."],["How does perimeter differ from area?","Perimeter measures the boundary; area measures the covered surface."],["What happens to area if both dimensions double?","It becomes four times as large."]],problem:n=>({question:`A rectangle is ${n} m long and 3 m wide. What is its area?`,correctAnswer:`${n*3} square metres`,explanation:`Multiply ${n} by 3 to count the square metres.`}),simulation:'Simulation("rectangle-lab", "Change one dimension", [{id:"length",label:"Length",unit:"m",min:1,max:12,step:1,value:4}], [{id:"area",label:"Area at width 3 m",unit:"square metres",expr:"length * 3"},{id:"perimeter",label:"Perimeter",unit:"m",expr:"2 * (length + 3)"}], "workspace", "Predict how area and perimeter respond to one extra metre of length.")' },
  { id:"mean",split:"validation",title:"Arithmetic mean",lesson:"The arithmetic mean is the sum of the values divided by how many values there are. For 2, 4 and 6, the sum is 12 and the mean is 4. It is an equal-share summary. An extreme value can pull the mean far from most observations, so inspect the data as well as the average.",diagnostic:"The mean of 2, 4 and 6 is 12 because their sum is 12. Is that complete?",wrong:"Yes, the mean is just all the values added together.",correction:"After summing, divide by the number of values. There are three values, so 12 / 3 = 4.",transfer:"Delivery times are 2, 2 and 20 minutes. What is the mean, and why might it poorly describe a typical delivery?",transferAnswer:"The mean is 8 minutes. The 20-minute outlier pulls it above the two 2-minute deliveries.",facts:[["How do you calculate the arithmetic mean?","Add all values and divide by the number of values."],["What does the mean represent as an equal share?","The value each observation would have if the total were redistributed equally."],["Can a mean exceed most observations?","Yes, a large outlier can pull it upward."],["Why inspect individual observations too?","The mean can hide spread, clusters and outliers."]],problem:n=>({question:`Find the mean of ${n}, ${n+2} and ${n+4}.`,correctAnswer:String(n+2),explanation:`Their sum is ${3*n+6}; divide by three to get ${n+2}.`}),simulation:'Simulation("mean-lab", "Move one observation", [{id:"third",label:"Third observation",min:2,max:30,step:1,value:20}], [{id:"mean",label:"Mean of 2, 2 and the observation",expr:"(4 + third) / 3",precision:2}], "workspace", "Predict how one unusually large observation changes the mean.")' },
];

function ui(id: string, component: string, life="ephemeral", title="Think it through") {
  return `\`\`\`openui lifecycle=${life} id=${id} revision=0\nroot = LearningSurface([activity], ${j(title)}, "", ${j(life)})\nactivity = ${component}\n\`\`\``;
}
function question(id: string, prompt: string, topic: string, choice=false) {
  return ui(id, `Question(${j([{header:"Your reasoning",question:prompt,type:choice?"choice":"text",...(choice?{choices:["A worked example","A visual model","A short explanation"],allowText:true}:{})}])}, "ephemeral", ${j(topic)})`);
}
function examQuestions(t:Topic, offset:number) {
  const examples:Record<string,string[]>={
    fractions:["One half of a pizza covers the same area as two quarters of the same pizza.","Multiplying 1/2 by 2/2 gives 2/4 without changing its value.","Two halves cover the whole pizza; one half does not.","Draw two equal rectangles: shade one of two equal parts in one and two of four in the other."],
    discounts:["For $80 at 10% off, the saving is $8.","A $100 item with a $20 saving costs $80.","Saving $10 on $50 is 20%; saving $10 on $100 is 10%.","After $100 falls to $80, adding 20% of $80 adds $16, ending at $96."],
    loops:["An array with three elements ends at index 2.","With length 3, i < 3 visits 0, 1 and 2.","At length 0, the initial check 0 < 0 is false.","With length 3, i <= 3 also visits index 3, which is invalid."],
    "unit-price":["A $4, 500 g pack costs $0.80 per 100 g.","Convert 1 kg to 1000 g before comparing it with a 500 g pack.","A $3, 100 g pack costs more per gram than a $4, 500 g pack.","If half of a large pack spoils, its low price per gram may not translate into low cost per usable gram."],
    area:["A 4 m by 3 m floor has area 12 square metres.","A one-metre by one-metre tile covers one square metre.","A 4 m by 3 m rectangle has area 12 square metres and perimeter 14 metres.","Doubling 4 by 3 to 8 by 6 changes area from 12 to 48 square units."],
    mean:["For 2, 4 and 6, divide the sum 12 by the count 3 to get 4.","Redistributing 12 counters among three people gives each person four.","For 2, 2 and 20, the mean 8 exceeds two of the three observations.","Both 4, 4, 4 and 2, 4, 6 have mean 4, but their spread differs."],
  };
  // Twenty distinct prompts: retrieval, explanations, true/false, calculation, transfer.
  const factual=t.facts.flatMap(([front,back],i)=>[
    {id:`fact-${i}`,question:front,correctAnswer:back,explanation:back,type:"short_answer",level:"recall"},
    {id:`explain-${i}`,question:`Explain with an example: ${front}`,correctAnswer:`${back} ${examples[t.id][i]}`,explanation:`${back} ${examples[t.id][i]}`,type:"transfer",level:"transfer",rubric:"A correct principle and a consistent example earn full credit; the principle alone is partial."},
  ]);
  const calculations=Array.from({length:10},(_,i)=>{
    const p=t.problem(i+2+offset);
    const type=i%3===0?"multiple_choice":i%3===1?"short_answer":"fill_in";
    return {id:`apply-${i}`,...p,type,level:"application",...(type==="multiple_choice"?{options:[p.correctAnswer,t.problem(i+3+offset).correctAnswer,t.problem(i+4+offset).correctAnswer]}:{}),...(type==="fill_in"?{question:`${p.question} Answer: ___`}:{})};
  });
  return [...factual,...calculations,{id:"misconception",question:t.diagnostic,correctAnswer:t.correction,explanation:t.correction,type:"short_answer",level:"analysis"},{id:"real-world",question:t.transfer,correctAnswer:t.transferAnswer,explanation:t.transferAnswer,type:"transfer",level:"transfer"}];
}

export async function buildConversations() {
  const declarations=await Bun.file(new URL("../../.keating/outputs/training/openui-context/tool-schemas.json",import.meta.url)).json();
  const declared=new Set(declarations.map((d:any)=>d.function.name));
  const conversations:any[]=[];
  let toolExecutions=0;
  for(const t of topics) for(const variant of ["guided","independent"]) {
    const id=`${t.id}-${variant}`; const messages:any[]=[]; const checks:any[]=[]; const decks:any[]=[]; const plans:any[]=[];
    const storage={
      getDeckBySlug:async(slug:string)=>decks.find(d=>d.slug===slug),
      saveDeck:async(d:any)=>{const saved={...d,id:d.id??`${id}-deck`,createdAt:Date.parse(AT),updatedAt:Date.parse(AT)};decks.push(saved);return saved;},
      saveLessonPlan:async(topic:string,markdown:string,metadata:any)=>{const saved={id:`${id}-quiz-${plans.length}`,topic,markdown,metadata};plans.push(saved);return saved;},
      getQuestionChecks:async(topic:string)=>checks.filter(c=>c.topic===topic),
      gradeQuestionCheck:async(checkId:string,g:any)=>{const c=checks.find(c=>c.id===checkId);if(!c)throw Error("Unknown check");Object.assign(c,g,{grading:"graded"});},
      recordFeedback:async()=>{},
      rememberLearnerProfileBelief:async(d:any)=>({...d,confidence:1}),
    } as unknown as KeatingStorage;
    const tools=[...createAssessmentTools(storage,async()=>[]),...createTeachingTools(storage)];
    const user=(content:string)=>messages.push({role:"user",content});
    const assistant=(content:string)=>messages.push({role:"assistant",content});
    async function call(name:string,args:any) {
      if(!declared.has(name))throw Error(`Undeclared tool ${name}`);
      const callId=`${id}-call-${messages.length}`;
      messages.push({role:"assistant",content:"",tool_calls:[{id:callId,type:"function",function:{name,arguments:j(args)}}]});
      const tool=tools.find(t=>t.name===name)!;
      const result=await (tool.execute as any)(callId,args);
      const content=result.content.map((c:any)=>c.text??"").join("\n");
      messages.push({role:"tool",name,tool_call_id:callId,content});toolExecutions++;
      return content;
    }
    function answer(prompt:string,value:string,pending=true) {
      const checkId=`${id}-response-${messages.length}`;
      if(pending)checks.push({id:checkId,topic:t.title,question:prompt,grading:"pending",createdAt:Date.parse(AT)+messages.length});
      user(serializeLearnerResponse(createQuestionLearnerResponse({topic:t.title,source:"openui",answers:[{header:"Your reasoning",question:prompt,answer:value,...(pending?{grading:"pending" as const}:{})}]},{id:checkId,submittedAt:AT})));
    }
    user(`I want to understand ${t.title.toLowerCase()} and use it outside this chat. ${variant==="guided"?"Please help me when I get stuck.":"Let me try before giving me an explanation."}`);
    assistant(question(`${id}-preference`,"How would you like to begin?",t.title,true));
    answer("How would you like to begin?",variant==="guided"?"A worked example":"A short explanation",false);
    assistant(t.lesson);
    user("I think I understand. Can you check my reasoning before moving on?");
    assistant(question(`${id}-diagnostic`,t.diagnostic,t.title));
    answer(t.diagnostic,t.wrong);
    await call("grade_question_checks",{topic:t.title,results:[{question:t.diagnostic,verdict:"incorrect",misconception:t.wrong}]});
    assistant(t.correction);
    user("Let me try an application now.");
    assistant(question(`${id}-transfer`,t.transfer,t.title));
    answer(t.transfer,t.transferAnswer);
    await call("grade_question_checks",{topic:t.title,results:[{question:t.transfer,verdict:"correct"}]});
    assistant(`That reasoning works: ${t.transferAnswer} This shows you can use the idea in this example; we still need a later check to know what you retain.`);
    user("Before an activity, remind me why you keep asking for explanations.");
    assistant("Generative learning theory informs this approach. Explaining an idea connects it to what you already know. We work at the edge of your understanding, compare alternatives, justify reasoning, and apply it to a real-world scenario. I can give hints and worked examples when you need them.");
    user("Please remember that I prefer a short explanation followed by a concrete example.");
    await call("remember_learner_profile",{category:"learning-preference",value:"Prefers a short explanation followed by a concrete example.",source:"explicit",evidence:"Please remember that I prefer a short explanation followed by a concrete example."});
    assistant("I saved that preference.");
    function documentFor(source:string, docId:string) {
      return compileOpenUISourceToSharedDocument(source.split("\n").slice(1,-1).join("\n"),{documentId:docId,createdAt:AT,updatedAt:AT});
    }
    function submit(document:any,intent:any,humanFriendlyMessage:string) {
      const memory=new Map<string,string>();
      const dispatched=dispatchSharedUiAction({getItem:k=>memory.get(k)??null,setItem:(k,v)=>{memory.set(k,v);}},document,intent,AT);
      const {schemaVersion,documentId,documentRevision,idempotencyKey,...params}=dispatched.action;
      user(serializeLearnerResponse(createOpenUIActionLearnerResponse({kind:"canonical",type:dispatched.action.type,humanFriendlyMessage,params,document:{id:document.id,lifecycle:document.retention,revision:document.revision},action:dispatched.action,sourceDocument:dispatched.sourceDocument,receipt:dispatched.receipt},{id:`${id}-submission-${messages.length}`,submittedAt:AT})));
    }
    const makeDeck=async()=>{
      user("Make a saved flashcard deck from what we covered, with concrete prompts I can review later.");
      const source=ui(`${id}-deck`,`Flashcards(${j(`${id}-deck`)}, ${j(t.title)}, ${j(`${t.title}: explain and retrieve`)}, ${j(t.facts.map(([front,back])=>({front,back})))}, "resumable", "Recall the principle before turning over each card.")`,"resumable",t.title);
      assistant(source);
      const document=documentFor(source,`${id}-deck`);
      const deck=document.nodes.find(n=>n.type==="deck")!;
      const ratings=deck.cards.map((card:any,i:number)=>{const rating=variant==="guided"&&i<2?0:2;const outcome=applyReview(initialSrsState(Date.parse(AT)),rating,Date.parse(AT));return {cardId:card.id,rating,appliedIntervalDays:outcome.appliedIntervalDays,easeAfter:outcome.next.ease};});
      submit(document,{type:"complete-deck",nodeId:deck.id,ratings,summary:{reviewed:4,lapses:variant==="guided"?2:0}},`Completed 4 flashcards on ${t.title}${variant==="guided"?" with 2 difficult recalls":""}`);
      assistant(variant==="guided"?question(`${id}-review-choice`,"Which concept felt least clear during the flashcard review?",t.title):"You reported no difficult recalls in this review. A later retrieval check and a new application will give us more evidence than this one session.");
      user(`The idea I want to revisit is: ${t.facts[0][0]}`);
      assistant(t.facts[0][1]);
    };
    const makeQuiz=async()=>{
      user("We have covered the lesson. Save a four-question quiz with different question formats; let me submit before discussing the answers.");
      const p=t.problem(variant==="guided"?3:7);
      const qs=[{...p,type:"multiple_choice",level:"application",options:[p.correctAnswer,t.problem(4+(variant==="guided"?0:4)).correctAnswer,t.problem(5+(variant==="guided"?0:4)).correctAnswer]},
        {question:`True or false: ${t.wrong}`,correctAnswer:"False",explanation:t.correction,type:"true_false",level:"comprehension"},
        {question:t.facts[0][0],correctAnswer:t.facts[0][1],explanation:t.facts[0][1],type:"short_answer",level:"recall"},
        {question:t.transfer,correctAnswer:t.transferAnswer,explanation:t.transferAnswer,type:"transfer",level:"transfer",rubric:"Correct comparison or calculation with the reason earns full credit; a method without a supported result is partial."}];
      const source=ui(`${id}-quiz`,`Quiz(${j(`${id}-quiz`)}, ${j(t.title)}, ${j(qs.map((q,i)=>({...q,id:`q-${i+1}`})))}, "resumable")`,"resumable",t.title);
      assistant(source);
      const document=documentFor(source,`${id}-quiz`);
      const quiz=document.nodes.find(n=>n.type==="quiz")!;
      const answers=quiz.questions.map((q:any,i:number)=>({questionId:q.id,answer:i===3?"I know I should compare the quantities, but I have not finished the calculation.":q.correctAnswer}));
      const resultId=`${quiz.id}-result`;
      submit(document,{type:"complete-quiz",nodeId:quiz.id,resultId,answers,score:2,partialCreditPoints:2,partialCredits:Object.fromEntries(quiz.questions.slice(0,2).map(q=>[q.id,1])),flaggedQuestionIds:[quiz.questions[3].id],pendingGradeQuestionIds:quiz.questions.slice(2).map(q=>q.id),skippedQuestionIds:[],timing:{totalMs:180000,perQuestionMs:Object.fromEntries(quiz.questions.map(q=>[q.id,45000]))}},"I submitted my quiz. Please grade the open-ended answers and help me finish the transfer problem.");
      await call("grade_quiz",{result_id:resultId,grades:[{question_id:quiz.questions[2].id,verdict:"correct",note:"The principle is stated correctly."},{question_id:quiz.questions[3].id,verdict:"partial",note:"You identified a comparison, but need the calculation and a justified conclusion."}]});
      assistant(question(`${id}-retry`,t.transfer,t.title));
      answer(t.transfer,t.transferAnswer);
      await call("grade_question_checks",{topic:t.title,results:[{question:t.transfer,verdict:"correct"}]});
      assistant("That completes the reasoning for this practice attempt. The original quiz submission remains distinct from this supported retry.");
    };
    if(variant==="guided"){await makeDeck();await makeQuiz();}else{await makeQuiz();await makeDeck();}
    user("This helped. Please record a thumbs up for this topic.");
    await call("feedback",{signal:"up",topic:t.title});
    assistant("Feedback saved. It can guide a later improvement run; recording it does not itself change my weights.");
    if(variant==="independent") {
      user("Give me a 20-question exam on this material, with 30 minutes total. Mix retrieval, calculations, explanations and transfer. Do not reveal solutions in the chat before I submit.");
      const qs=examQuestions(t,0);
      assistant(ui(`${id}-exam`,`Exam(${j(`${id}-exam`)}, ${j(t.title)}, ${j(qs)}, "resumable", 1800)`,"resumable",`${t.title}: exam`));
      user("I have not submitted yet. Can you tell me which answer to pick for the first question?");
      assistant(ui(`${id}-assistance`, 'Question([{header:"Exam mode",question:"Continue independently or switch to assisted practice?",type:"choice",choices:["Continue independently","Switch to assisted practice"],allowText:true}], "ephemeral", "Exam preference", "A supported attempt will be treated as assisted practice.")'));
      user("Switch to supported practice. Explain the first one.");
      assistant(`We will treat this as assisted practice. ${t.facts[0][1]} A supported answer here is not evidence of independent exam performance.`);
    } else {
      user("Instead of an exam, give me an interactive model where I can change a value and see what follows.");
      assistant(ui(`${id}-simulation`,t.simulation,"workspace",t.title));
      user("I changed the value. Give me a shared place to write my prediction and what I observed.");
      assistant(ui(`${id}-notes`,`SharedNotes(${j(`${id}-notes`)}, "Prediction and evidence", "workspace", "## My prediction\\n\\n## What I observed\\n\\n## Why they agree or disagree\\n\\n## Another real-world use", "Write your own explanation before comparing it with a worked example.")`,"workspace","Revise your explanation"));
    }
    user("Which version of the bot is this, and does finishing these activities prove I mastered the topic?");
    assistant("I’m the latest version of Keating Bot, built on Inkling-Small. Completing activities is useful practice, but mastery needs evidence from independent answers, later recall and transfer to new situations.");
    conversations.push({id,family:t.id,split:t.split,variant,sources:["protocol","assessment","teaching","learner-response","quiz-submission","grammar"],messages});
  }
  return {schema_version:2,dataset_id:"keating-openui-long-conversations-v2",base_model:"thinkingmachines/Inkling-Small",authorship:"Synthetic learner conversations and authored tutor targets. Tool outputs come from real Keating implementations using isolated in-memory storage; no live learner records or provider calls.",sources:{protocol:{path:"web/src/keating/prompts/operational-protocol.md"},assessment:{path:"web/src/keating/browser-tools/assessment.ts"},teaching:{path:"web/src/keating/browser-tools/teaching.ts"},"learner-response":{path:"web/src/keating/learner-response.ts"},"quiz-submission":{path:"web/src/components/AssistantChatPanel.tsx"},grammar:{path:"packages/learner-contracts/src/openui-source.ts"}},tool_executions_in_memory:toolExecutions,conversations};
}

if(import.meta.main){
  const out=process.argv[2]??"scripts/training/data/openui-conversations.json";
  const data=await buildConversations();
  await mkdir(new URL("./data/",import.meta.url),{recursive:true});
  await Bun.write(out,j(data,null,2)+"\n");
  console.log(j({path:out,conversations:data.conversations.length,turns:data.conversations.map(c=>c.messages.length),toolExecutions:data.tool_executions_in_memory,providerCalls:0}));
}
