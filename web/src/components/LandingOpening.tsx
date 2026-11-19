import { useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { AppLink } from "./AppLink";
import { Eyebrow } from "../design-system/kit";
import { useMotionAllowed } from "../design-system/motion";
import { KeatingGlyph } from "../design-system/glyphs";
import { LANDING_EXAMPLES } from "./landing-examples";

const beats = ["You ask", "It answers", "You nod", "The next morning"];
const holds = [1500, 2600, 1700, 5600];

export function LandingPlay() {
  const ref = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(3);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [visible, setVisible] = useState(false);
  const motion = useMotionAllowed();

  useEffect(() => {
    if (!motion) setBeat(3);
  }, [motion]);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!motion || hover || focus || !visible) return;
    const timer = window.setTimeout(() => setBeat((beat + 1) % beats.length), holds[beat]);
    return () => window.clearTimeout(timer);
  }, [beat, motion, hover, focus, visible]);

  return <div className="lp-play" data-beat={beat} ref={ref}
    onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
    onFocus={() => setFocus(true)} onBlur={event => setFocus(event.currentTarget.contains(event.relatedTarget))}>
    <p className="lp-sr">You ask for an explanation, nod as you read it, and the next morning you cannot recall what a base case does.</p>
    <div className="lp-stack" aria-hidden="true">
      {LANDING_EXAMPLES.map((example, index) => <article className={`lp-win w${index}`} key={example.id}>
        <header><i/><i/><i/><b>{example.provider}</b></header>
        {index === 0 && <div className="lp-ask"><span>{example.query}</span></div>}
        <div className="lp-wall">{example.paragraphs.map(p => <p key={p}>{p}</p>)}</div>
      </article>)}
      <span className="lp-nod" data-glyph-host><KeatingGlyph name="up" size={14}/>Makes sense, thanks!</span>
      <div className="lp-quiz"><Eyebrow muted>The next morning · no scrolling up</Eyebrow>
        <b>So what does a base case do?</b><div className="lp-ans">uh<i/></div><small>It was in the first paragraph.</small>
      </div>
    </div>
    <div className="lp-beats" role="group" aria-label="The story in four beats">{beats.map((label, i) =>
      <button key={label} type="button" aria-pressed={i === beat} onClick={() => setBeat(i)}><b>{i + 1}</b>{label}</button>)}</div>
    <p className="lp-disc">Illustrated examples · authored text, not provider transcripts</p>
  </div>;
}

export function LandingOpening() {
  const posthog = usePostHog();
  return <section id="seen-this-before" className="lp-hero" aria-labelledby="landing-title">
    <div><Eyebrow>Seen this before?</Eyebrow>
      <h1 id="landing-title" data-landing-section="overload">It made sense yesterday.</h1>
      <p className="lead">You asked a chatbot to explain it. It did, and well. You nodded, closed the tab, and the understanding went with it.</p>
      <div className="lp-cta">
        <AppLink to="/chat" className="k-button k-accent" onClick={() => posthog?.capture("start_session_clicked", { source: "landing_opening", intent: "open_browser" })}>Open Keating in the browser <KeatingGlyph name="right" size={14}/></AppLink>
        <AppLink to="/download" className="k-button k-outline" onClick={() => posthog?.capture("download_intent", { source: "landing_opening", destination: "download_page" })}><KeatingGlyph name="export" size={14}/>Download</AppLink>
      </div>
      <p className="lp-fine">Free to start · open source · works with the models you already use</p>
    </div><LandingPlay/>
  </section>;
}
