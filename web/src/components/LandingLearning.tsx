import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { ArrowRight, ArrowUp, Check, MessageSquare } from "lucide-react";
import { KeatingBot } from "./KeatingBot";
import { DOCUMENTATION_URL } from "../lib/tutorial-links";
import "./landing-learning.css";

const FOUNDATION = ["Hear what an oscillator does", "Shape a sound with filters"];
const PROJECT = ["Make it move with envelopes", "Build a patch of your own"];

export function LandingLearning() {
  const posthog = usePostHog();
  const [depth, setDepth] = useState<"explore" | "build">("build");
  const [method, setMethod] = useState<"experiments" | "questions">("experiments");
  const [swapped, setSwapped] = useState(false);
  const foundation = swapped ? [...FOUNDATION].reverse() : FOUNDATION;
  const lessons = depth === "build" ? [...foundation, ...PROJECT] : foundation;
  const ask = `Help me design a learning plan about how synthesizers make sound. I am a beginner. My goal is to ${depth === "build" ? "build my own patch" : "understand the basics"}. Teach through ${method}. Begin with this lesson: ${foundation[0]}. Ask me what I want to change before we begin.`;

  return <>
    <section id="your-direction" className="landing-learning" aria-labelledby="landing-direction-title">
      <div className="landing-wrap">
        <div className="landing-learning__problem">
          <h2 id="landing-direction-title" data-landing-section="direction">You know what you want to learn.<br />Figuring out how is another job.</h2>
          <p>You collect tutorials, save links, and ask questions. You’re still left deciding where to start, what you’re missing, and whether any of it is taking you where you want to go.</p>
        </div>
        <div className="landing-learning__answer">
          <h3>Build your way through it with Keating.</h3>
          <p>Bring your curiosity, what you already know, and what you want to be able to do. Shape a plan together, then change the depth, direction, and practice as you go.</p>
        </div>
        <div className="landing-plan">
          <header className="landing-plan__bar"><span>Design your learning</span><span>Interactive example</span></header>
          <div className="landing-plan__grid">
            <div className="landing-plan__choices">
              <p className="landing-plan__subject">How synthesizers make sound</p>
              <p className="landing-plan__starting">Starting from scratch. Curious about making music.</p>
              <fieldset><legend>How far do you want to go?</legend><div className="landing-plan__options">
                <button type="button" aria-pressed={depth === "explore"} onClick={() => { setDepth("explore"); posthog?.capture("landing_plan_changed", { control: "depth", value: "explore" }); }}>Get the big picture</button>
                <button type="button" aria-pressed={depth === "build"} onClick={() => { setDepth("build"); posthog?.capture("landing_plan_changed", { control: "depth", value: "build" }); }}>Build my own patch</button>
              </div></fieldset>
              <fieldset><legend>How would you like to practise?</legend><div className="landing-plan__options">
                <button type="button" aria-pressed={method === "experiments"} onClick={() => { setMethod("experiments"); posthog?.capture("landing_plan_changed", { control: "method", value: "experiments" }); }}>Try experiments</button>
                <button type="button" aria-pressed={method === "questions"} onClick={() => { setMethod("questions"); posthog?.capture("landing_plan_changed", { control: "method", value: "questions" }); }}>Work through questions</button>
              </div></fieldset>
              <Link to="/chat" search={{ ask }} className="landing-learning__button" onClick={() => posthog?.capture("start_session_clicked", { source: "landing_direction", depth, method })}>Shape this plan with Keating <ArrowRight size={18} aria-hidden="true" /></Link>
              <p className="landing-plan__note">Opens this request in chat. You can edit it before sending.</p>
            </div>
            <div className="landing-plan__preview">
              <p className="landing-plan__label">Your possible path</p>
              <div aria-live="polite" aria-atomic="true">
                <ol>{lessons.map((lesson, index) => <li key={lesson}><span className="landing-plan__number">{String(index + 1).padStart(2, "0")}</span><span>{lesson}</span></li>)}</ol>
                <p className="landing-plan__exercise">{method === "experiments" ? "Try this: change the filter cutoff. Describe what you hear." : "Think it through: why does closing a filter make a sound less bright?"}</p>
              </div>
              <button type="button" className="landing-plan__reorder" onClick={() => { setSwapped(value => !value); posthog?.capture("landing_plan_changed", { control: "order", value: swapped ? "original" : "filters_first" }); }}><ArrowUp size={16} aria-hidden="true" />{swapped ? "Start with oscillators instead" : "Start with filters instead"}</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="your-continuity" className="landing-learning landing-learning--memory" aria-labelledby="landing-memory-title">
      <div className="landing-wrap landing-memory">
        <div>
          <h2 id="landing-memory-title" data-landing-section="continuity">Explaining where you’re at.<br />Again.</h2>
          <p>You found a useful explanation last time. Now you’re piecing the context back together: what you tried, what clicked, and where you got stuck.</p>
          <div className="landing-learning__answer">
            <h3>Pick up with a teacher that has your history.</h3>
            <p>Keating carries your goals and practice history into the next session. You can inspect and edit that context, shape the teaching instructions, and choose your model.</p>
            <a href={`${DOCUMENTATION_URL}learning-with-keating/`} className="landing-learning__link" onClick={() => posthog?.capture("landing_cta_clicked", { section: "continuity", action: "setup_guide", destination: "docs" })}>See how to make it yours <ArrowRight size={18} aria-hidden="true" /></a>
          </div>
        </div>
        <figure className="landing-memory__example">
          <figcaption>Learning context · example</figcaption>
          <dl><div><dt>Working toward</dt><dd>Build my own synth patch</dd></div><div><dt>Last practice</dt><dd>Changing the filter cutoff</dd></div><div><dt>Next question</dt><dd>How does an envelope change the sound?</dd></div></dl>
          <div className="landing-memory__teacher"><KeatingBot state="thinking" size={64} label="Keating" /><p>“Let’s build on the filter experiment. What if the brightness changed each time you pressed a key?”</p></div>
        </figure>
      </div>
    </section>
    <LandingSharedLearning />
  </>;
}

function LandingSharedLearning() {
  const posthog = usePostHog();
  const [view, setView] = useState<"lessons" | "discussion">("lessons");
  return <section id="learn-together" className="landing-learning landing-learning--courses" aria-labelledby="landing-courses-title">
    <div className="landing-wrap">
      <div className="landing-learning__problem">
        <h2 id="landing-courses-title" data-landing-section="courses">You learned something worth sharing.<br />Where do you even start?</h2>
        <p>A chat transcript is a lot to hand someone. A pile of links leaves them finding their own way. And when you’re learning alongside others, your questions need somewhere to meet.</p>
      </div>
      <div className="landing-learning__answer">
        <h3>Give what you know a place to grow.</h3>
        <p>Build a course with lessons and practice, invite others, and work through it together. Join someone else’s course to follow their path, ask questions, and share what you discover.</p>
      </div>
      <div className="landing-course">
        <header className="landing-course__header"><div><p>Example shared course</p><h4>Make your first synth patch</h4></div><span className="landing-course__people">You + your study group</span></header>
        <div className="landing-course__switch" role="group" aria-label="Preview the shared course">{(["lessons", "discussion"] as const).map(value => <button key={value} type="button" aria-pressed={view === value} onClick={() => { setView(value); posthog?.capture("landing_course_preview_changed", { view: value }); }}>{value === "lessons" ? "The learning path" : "The conversation"}</button>)}</div>
        <div className="landing-course__body" aria-live="polite">
          {view === "lessons" ? <ol className="landing-course__lessons"><li><Check size={18} aria-hidden="true" /><div><strong>Start with a sound</strong><span>Listen, change the oscillator, compare.</span></div></li><li><span className="landing-course__step">02</span><div><strong>Make it your own</strong><span>Shape the filter and envelope. Share your patch.</span></div></li><li><span className="landing-course__step">03</span><div><strong>Learn from each other</strong><span>Try someone else’s approach. Explain what changed.</span></div></li></ol> : <div className="landing-course__discussion"><MessageSquare size={24} aria-hidden="true" /><div><p><strong>Maya</strong> “My patch sounds dull. What should I try changing?”</p><p><strong>Sam</strong> “Try opening the cutoff, then compare it with your original.”</p><span>Example discussion, not a live conversation.</span></div></div>}
        </div>
        <footer className="landing-course__actions"><Link to="/chat" search={{ courseMode: "create" }} className="landing-learning__button" onClick={() => { posthog?.capture("start_session_clicked", { source: "landing_courses", intent: "create_course" }); posthog?.capture("landing_cta_clicked", { section: "courses", action: "create_course", destination: "chat" }); }}>Build a course <ArrowRight size={18} aria-hidden="true" /></Link><div><Link to="/courses" className="landing-learning__link" onClick={() => posthog?.capture("landing_cta_clicked", { section: "courses", action: "open_courses", destination: "courses" })}>Open your courses <ArrowRight size={18} aria-hidden="true" /></Link><p>Have an invitation? Follow its link to join.</p></div></footer>
      </div>
    </div>
  </section>;
}
