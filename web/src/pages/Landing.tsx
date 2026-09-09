import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { LandingIntro } from "../components/LandingIntro";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { LandingOverload } from "../components/LandingOverload";
import { LANDING_EXAMPLES, type LandingExampleId } from "../components/landing-examples";
import { LandingPractice } from "../components/LandingPractice";
import { LandingTeacherScene } from "../components/LandingTeacherScene";
import { FrustrationClip } from "../components/FrustrationClip";
import { LandingClosing } from "../components/LandingClosing";
import { LandingLearning } from "../components/LandingLearning";
import { useLandingAnalytics } from "../hooks/useLandingAnalytics";
import { useSeo } from "../hooks/useSeo";
import "./landing-page.css";

export function Landing() {
  const [exampleId, setExampleId] = useState<LandingExampleId>("recursion");
  const { root, posthog } = useLandingAnalytics();
  const selectExample = (id: LandingExampleId) => {
    setExampleId(id);
    posthog?.capture("landing_lesson_selected", { example_id: id });
  };
  useSeo({
    title: "Keating — Ready to think for yourself?",
    description: "An answer is not the whole lesson. Keating works with your goals and learning history, then helps you reconstruct ideas through practice. Start a session or download your own AI teacher.",
    canonical: "https://keating.help/",
  });
  return (
    <div className="retro-layout retro-page landing-page">
      <Nav primaryAction="download" />
      <main ref={root}>
        <section id="seen-this-before" className="landing-overload-act" aria-labelledby="landing-title">
          <div className="landing-wrap landing-opening">
            <h1 id="landing-title" data-landing-section="overload">Seen this before?</h1>
            <div className="landing-opening-actions">
              <Link to="/download" className="landing-opening-download" onClick={() => posthog?.capture("download_intent", { source: "landing_opening", destination: "download_page" })}>Download Keating</Link>
              <Link to="/chat" className="landing-opening-browser" onClick={() => posthog?.capture("start_session_clicked", { source: "landing_opening", intent: "open_browser" })}>Open Keating in the browser <span aria-hidden="true">→</span></Link>
            </div>
            <LandingOverload exampleId={exampleId} onExampleChange={selectExample} />
          </div>
          <figure className="landing-frustration landing-wrap">
            <FrustrationClip />
            <figcaption><h2>You asked to learn.<br />You got more to read.</h2></figcaption>
          </figure>
        </section>

        <LandingIntro />

        <section id="keating-lesson" className="landing-response" aria-labelledby="landing-response-title">
          <div className="landing-wrap landing-response-grid">
            <div className="landing-response-copy">
              <h2 id="landing-response-title" data-landing-section="lesson">You do the thinking.<br /><span>Keating helps it click.</span></h2>
              <p>A teacher that starts with your goals and builds on what you know.</p>
              <LandingTeacherScene />
              <div className="landing-deeper">
                <details><summary>Make it your own</summary><p>Choose your model, shape your teacher, and take your data with you. It’s open source—build as deeply as you want.</p><div><Link to="/tutorial">Setup guide</Link><a href="https://github.com/Diogenesoftoronto/keating" target="_blank" rel="noreferrer">Explore the source</a></div></details>
              </div>
            </div>
            <div className="landing-response-example"><div className="landing-example-picker" role="group" aria-label="Choose a lesson subject">{LANDING_EXAMPLES.map(example => <button type="button" key={example.id} data-example={example.id} aria-pressed={exampleId === example.id} onClick={() => selectExample(example.id)}>{example.label}</button>)}</div><LandingPractice key={exampleId} exampleId={exampleId} /></div>
          </div>
        </section>
        <LandingLearning />
        <LandingClosing />
      </main>
      <Footer />
    </div>
  );
}
