import { useState, type ReactNode } from "react";
import { usePostHog } from "@posthog/react";
import { AppLink as Link } from "./AppLink";
import { Card, DefinitionList, Eyebrow, Prose } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { KeatingBot } from "./KeatingBot";
import { DOCUMENTATION_URL } from "../lib/tutorial-links";

const FOUNDATION = ["Hear what an oscillator does", "Shape a sound with filters"];
const PROJECT = ["Make it move with envelopes", "Build a patch of your own"];

function Pair({ id, section, pain, context, answer, detail, children, link }: {
  id: string; section: string; pain: string; context: string; answer: string; detail: string; children: ReactNode; link?: ReactNode;
}) {
  return <article className="lp-pair" id={id}><div className="lp-say">
    <h3 className="lp-pain" data-landing-section={section}>{pain}</h3><p className="lp-painp">{context}</p>
    <p className="lp-fix">{answer}</p><p className="lp-fixp">{detail}</p>{link}
  </div>{children}</article>;
}

function ReviewExample() {
  const cards = [
    ["What does the base case do?", "It returns without making a smaller call."],
    ["What happens to the outer call?", "It waits for the inner call to return."],
    ["Which call returns first in sum(2)?", "sum(0), the base case."],
  ];
  const [index, setIndex] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  function showCard(next: number | null) {
    setIndex(next);
    setRevealed(false);
  }
  return <Card className="lp-vig" tone="hard"><h4>Coming up · example</h4>
    {index === null ? <>
      <DefinitionList items={[
        { term: "Today", detail: "Base case and return path · 3 cards" },
        { term: "Thursday", detail: "The call stack · 2 cards" },
        { term: "In 6 days", detail: "Recursion on trees · 1 card" },
      ]}/>
      <button type="button" className="k-button k-primary" onClick={() => showCard(0)}>Review 3 cards</button>
    </> : <div aria-live="polite">
      <Eyebrow muted>Card {index + 1} of {cards.length}</Eyebrow><Prose><p>{cards[index][0]}</p>
        {revealed && <p>{cards[index][1]}</p>}</Prose>
      {revealed ? <button type="button" onClick={() => showCard(index + 1 < cards.length ? index + 1 : null)}>
        {index + 1 < cards.length ? "Next card" : "Finish review"}
      </button> : <button type="button" onClick={() => setRevealed(true)}>Show answer</button>}
      <button type="button" onClick={() => showCard(null)}>Back to schedule</button>
    </div>}
  </Card>;
}

function CourseExample() {
  const posthog = usePostHog();
  const [view, setView] = useState<"lessons" | "discussion">("lessons");
  const [depth, setDepth] = useState<"explore" | "build">("build");
  const [method, setMethod] = useState<"experiments" | "questions">("experiments");
  const [swapped, setSwapped] = useState(false);
  const foundation = swapped ? [...FOUNDATION].reverse() : FOUNDATION;
  const lessons = depth === "build" ? [...foundation, ...PROJECT] : foundation;
  const ask = `Help me design a learning plan about how synthesizers make sound. I am a beginner. My goal is to ${depth === "build" ? "build my own patch" : "understand the basics"}. Teach through ${method}. Begin with this lesson: ${foundation[0]}. Ask me what I want to change before we begin.`;

  return <Card className="lp-vig" tone="hard"><h4 data-landing-section="courses">Make your first synth patch · you + 3 studying · example</h4>
    <div className="landing-course__switch" role="group" aria-label="Preview the shared course">{(["lessons", "discussion"] as const).map(value => <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value); posthog?.capture("landing_course_preview_changed", { view: value }); }}>{value === "lessons" ? "The learning path" : "The conversation"}</button>)}</div>
    <div aria-live="polite">{view === "lessons" ? <div className="lp-path">{lessons.map((lesson, i) =>
      <div key={lesson}><span><b>{lesson}</b><small>{["Done · 12 min", method === "experiments" ? "Try this: change the cutoff. Describe what you hear." : "Why does closing a filter make a sound less bright?", "Next", "Share it with the room"][i]}</small></span></div>)}</div> :
      <Prose><p><b>Maya</b> “My patch sounds dull. What should I try changing?”</p><p><b>Sam</b> “Try opening the cutoff, then compare it with your original.”</p></Prose>}</div>
    <details><summary>Shape this plan</summary>              <fieldset><legend>How far do you want to go?</legend><div className="landing-plan__options">
                <button type="button" aria-pressed={depth === "explore"} onClick={() => { setDepth("explore"); posthog?.capture("landing_plan_changed", { control: "depth", value: "explore" }); }}>Get the big picture</button>
                <button type="button" aria-pressed={depth === "build"} onClick={() => { setDepth("build"); posthog?.capture("landing_plan_changed", { control: "depth", value: "build" }); }}>Build my own patch</button>
              </div></fieldset>
              <fieldset><legend>How would you like to practise?</legend><div className="landing-plan__options">
                <button type="button" aria-pressed={method === "experiments"} onClick={() => { setMethod("experiments"); posthog?.capture("landing_plan_changed", { control: "method", value: "experiments" }); }}>Try experiments</button>
                <button type="button" aria-pressed={method === "questions"} onClick={() => { setMethod("questions"); posthog?.capture("landing_plan_changed", { control: "method", value: "questions" }); }}>Work through questions</button>
              </div></fieldset>
              <Link to={`/chat?ask=${encodeURIComponent(ask)}`} className="landing-learning__button" onClick={() => posthog?.capture("start_session_clicked", { source: "landing_direction", depth, method })}>Shape this plan with Keating <KeatingGlyph name="right" size={18} /></Link>
              <p className="landing-plan__note">Opens this request in chat. You can edit it before sending.</p>
              <button type="button" className="landing-plan__reorder" onClick={() => { setSwapped(value => !value); posthog?.capture("landing_plan_changed", { control: "order", value: swapped ? "original" : "filters_first" }); }}><KeatingGlyph name="rise" size={16} />{swapped ? "Start with oscillators instead" : "Start with filters instead"}</button></details>
    <footer className="landing-course__actions"><Link to="/chat?courseMode=create" className="landing-learning__button" onClick={() => { posthog?.capture("start_session_clicked", { source: "landing_courses", intent: "create_course" }); posthog?.capture("landing_cta_clicked", { section: "courses", action: "create_course", destination: "chat" }); }}>Build a course <KeatingGlyph name="right" size={18} /></Link><div><Link to="/courses" className="landing-learning__link" onClick={() => posthog?.capture("landing_cta_clicked", { section: "courses", action: "open_courses", destination: "courses" })}>Open your courses <KeatingGlyph name="right" size={18} /></Link><p>Have an invitation? Follow its link to join.</p></div></footer>
  </Card>;
}

export function LandingLearning() {
  const posthog = usePostHog();
  return <section className="lp-pairs"><Eyebrow muted>Four more things a chatbot leaves to you</Eyebrow>
    <Pair id="short-reviews" section="reviews" pain={'You said "got it." Nobody checked.'}
      context="The chat ends when you stop typing. Whether it stuck is your problem, a week later, in the exam."
      answer="Keating comes back for it." detail="Save flashcards from a lesson. Coming up shows when they are due for another review.">
      <ReviewExample/>
    </Pair>
    <Pair id="your-continuity" section="continuity" pain="Explaining where you’re at. Again."
      context="Every new chat starts from nothing. You rebuild the context: what you tried, what clicked, where you got stuck."
      answer="Pick up with a teacher that has your history." detail="Keating can draw on your goals and recent practice. You can read and edit the goals and notes in your learner profile."
      link={<a href={`${DOCUMENTATION_URL}learning-with-keating/`} className="landing-learning__link" onClick={() => posthog?.capture("landing_cta_clicked", { section: "continuity", action: "setup_guide", destination: "docs" })}>See how to make it yours <KeatingGlyph name="ext" size={18} /></a>}>
      <Card className="lp-vig"><h4>What Keating is told · example</h4><DefinitionList items={[
        { term: "Working toward", detail: "Explain recursion to someone else" }, { term: "Last practice", detail: "Traced sum(2) by hand" }, { term: "Still shaky", detail: "Why the return steps run backwards" },
      ]}/><div className="lp-recall"><KeatingBot state="thinking" size={30} label=""/><Prose>“Last time the return order tripped you up. Let’s start there, with a smaller example.”</Prose></div></Card>
    </Pair>
    <Pair id="reply-review" section="reply_review" pain="It sounded sure. Was it right?"
      context="Fluent and confident look the same whether the answer is correct or not. You are the one learning; you cannot be the one checking."
      answer="Look inside the reply." detail="Keating reviews the draft before releasing it. A best-effort reply is marked unverified. Checks against available sources can follow.">
      <Card className="lp-vig"><h4>How this reply was made · example</h4><Eyebrow>Draft → Review → Reply</Eyebrow><DefinitionList items={[
        { term: "Changed", detail: "Removed the answer to the question it had just asked" }, { term: "Source", detail: "Your notes, p. 4" }, { term: "Unverified", detail: "One claim about stack depth limits" },
      ]}/></Card>
    </Pair>
    <Pair id="your-direction" section="direction" pain="You know what you want to learn. Figuring out how is another job."
      context="Tutorials, saved links, a hundred questions. You still decide where to start and whether any of it is getting you there."
      answer="Build your way through it, alone or together." detail="Shape a plan with Keating, follow it at your own pace, or build a course and invite others to a study room.">
      <div id="learn-together"><CourseExample/></div>
    </Pair>
  </section>;
}
