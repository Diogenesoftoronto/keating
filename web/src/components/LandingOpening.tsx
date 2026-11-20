import { useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { AppLink } from "./AppLink";
import { useMotionAllowed } from "../design-system/motion";
import { KeatingGlyph } from "../design-system/glyphs";
import { LANDING_EXAMPLES } from "./landing-examples";

const beats = ["You ask", "It answers", "You nod", "The next morning"];
const holds = [1500, 2600, 1700, 5600];

export function LandingPlay() {
  const ref = useRef<HTMLDivElement>(null);
  const [selectedBeat, setBeat] = useState<number>();
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const motion = useMotionAllowed();
  const beat = selectedBeat ?? (motion ? 0 : 3);
  const rotating = motion && !paused;

  useEffect(() => {
    if (!motion) setBeat(undefined);
  }, [motion]);

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!rotating || !visible) return;
    const timer = window.setTimeout(() => setBeat((beat + 1) % beats.length), holds[beat]);
    return () => window.clearTimeout(timer);
  }, [beat, rotating, visible]);

  return <div className="lp-play" data-beat={beat} data-rotating={rotating} ref={ref}>
    <p className="lp-sr">You ask for an explanation, nod as you read it, and the next morning you cannot recall what a base case does.</p>
    <div className="lp-stack" aria-hidden="true">
      {LANDING_EXAMPLES.map((example, index) => <article className={`lp-win w${index}`} key={example.id}>
        <header><i/><i/><i/>{index === 0 && <b>Chat demo</b>}</header>
        {index === 0 && <div className="lp-ask"><span>{example.query}</span></div>}
        <div className="lp-wall">{example.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
      </article>)}
      <span className="lp-nod" data-glyph-host><KeatingGlyph name="up" size={14}/>Makes sense, thanks!</span>
      <div className="lp-quiz">
        <b>So what does a base case do?</b><div className="lp-ans">uh<i/></div>
      </div>
    </div>
    <div className="lp-beats" role="group" aria-label="The story in four beats">{beats.map((label, i) =>
      <button key={label} type="button" aria-pressed={i === beat} onClick={() => { setBeat(i); setPaused(true); }}>{label}</button>)}</div>
    {motion && <div className="lp-play-footer">
      <button className="lp-play-toggle" type="button" onClick={() => setPaused(!paused)}>
        {rotating ? "Pause story" : "Play story"}
      </button>
    </div>}
  </div>;
}

export function LandingOpening() {
  const posthog = usePostHog();
  return <section id="seen-this-before" className="lp-hero" aria-labelledby="landing-title">
    <div>
      <h1 id="landing-title" data-landing-section="overload">It made sense yesterday.</h1>
      <p className="lead">You understood the chatbot’s answer yesterday. Can you explain it today?</p>
      <div className="lp-cta">
        <AppLink to="/chat" className="k-button k-accent" onClick={() => posthog?.capture("start_session_clicked", { source: "landing_opening", intent: "open_browser" })}>Open Keating in the browser <KeatingGlyph name="right" size={14}/></AppLink>
        <AppLink to="/download" className="k-button k-outline" onClick={() => posthog?.capture("download_intent", { source: "landing_opening", destination: "download_page" })}><KeatingGlyph name="export" size={14}/>Download</AppLink>
      </div>
    </div><LandingPlay/>
  </section>;
}
