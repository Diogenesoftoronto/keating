import { useState } from "react";
import { QuestionRenderer, type AnsweredQuestion, type QuestionFormData } from "./QuestionRenderer";
import { KeatingBot } from "./KeatingBot";
import { LANDING_EXAMPLES, type LandingExample, type LandingExampleId } from "./landing-examples";
import "./landing-practice.css";

const STEP_PROMPTS: Record<LandingExampleId, string[]> = {
  recursion: ["What does the base case return?", "With that result, what can sum(1) return?", "Now what can sum(2) return?"],
  photosynthesis: ["Where do the carbon atoms go?", "What happens to oxygen from water?", "Does sunlight supply matter or energy?"],
  probability: ["What is the chance of rolling exactly 6?", "Count the even faces. What is the chance?", "What is the chance of rolling less than 5?"],
};

/** Keep each topic's local attempt separate, even when the parent reuses this component. */
export function LandingPractice({ exampleId = "recursion" }: { exampleId?: LandingExampleId }) {
  const example = LANDING_EXAMPLES.find(item => item.id === exampleId) ?? LANDING_EXAMPLES[0]!;
  return <PracticeLesson key={example.id} example={example} />;
}

function PracticeLesson({ example }: { example: LandingExample }) {
  const practice = example.practice;
  const reconstruction: QuestionFormData = { questions: practice.items.map((item, index) => ({ type: "matching", question: STEP_PROMPTS[example.id][index], choices: practice.choices, items: [item], correctMatches: [practice.correctMatches[index]], requireReasons: false, uniqueMatches: true, choiceLabel: example.id === "photosynthesis" ? "Choose a destination" : example.id === "probability" ? "Choose the probability" : "Choose the return value" })) };
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<AnsweredQuestion[] | null>(null);
  const correct = result?.filter(answer => answer.score === 1).length;
  const complete = correct === practice.items.length;
  return <section className="landing-practice" aria-labelledby="landing-practice-title">
    <header className="landing-practice__header"><div><h2 id="landing-practice-title">Try it yourself.</h2></div><KeatingBot state={complete ? "success" : "idle"} size={56} label="" /></header>
    {practice.stimulusKind === "code" ? <pre className="landing-practice__code"><code>{practice.stimulus}</code></pre> : <p className="landing-practice__stimulus">{practice.stimulus}</p>}
    <details key={round} className="landing-practice__hint"><summary>Need a starting point?</summary><p>{practice.context}. {practice.hint}</p></details>
    <div className="landing-practice__exercise" data-question-count={reconstruction.questions.length}><QuestionRenderer key={round} data={reconstruction} submitLabel="Check answers" onSubmit={setResult} /></div>
    {result && <div className="landing-practice__feedback" role="status"><p>{complete ? practice.success : `${correct} of ${practice.items.length} correct. ${practice.retry}`}</p><details><summary>Why it works</summary><p>{practice.feedback}</p></details></div>}
    <footer className="landing-practice__footer"><p>Example lesson</p><button type="button" className="landing-practice__reset" onClick={() => { setResult(null); setRound(previous => previous + 1); }}>{result ? "Try again" : "Reset"}</button></footer>
  </section>;
}
