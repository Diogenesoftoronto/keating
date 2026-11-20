import { useEffect, useRef, useState, type CSSProperties } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { ShaderSurface } from "../design-system/shaders";
import { useMotionAllowed } from "../design-system/motion";
import "./landing-recess.css";

const base = "/landing/recess/";
const published = new Set(Object.keys(import.meta.glob("/public/landing/recess/*")).map(path => path.slice("/public".length)));

const cast: [string, string][] = [
  ["maths-drift", "Maths"], ["coding-spin", "Coding"], ["chemistry-drift", "Chemistry"], ["music-drift", "Music"],
  ["literature-split", "Literature"], ["history-dart", "History"], ["law-myth", "Law"], ["japanese-drift", "Japanese"],
];

/** A 4 by 2 stop-motion sheet. `row` plays the first four poses; `sheet` plays all eight. */
function Sprite({ sheet, play = "row", className, style }: { sheet: string; play?: "row" | "sheet" | "cycle"; className?: string; style?: CSSProperties }) {
  return <span className={["lp-recess-sprite", className].filter(Boolean).join(" ")} data-play={play} aria-hidden="true"
    style={{ ...style, backgroundImage: `url("${base}${sheet}.avif")` }}/>;
}

/** A silent gameplay loop: plays only on screen, rests on its poster when motion is off or the visitor pauses. */
function RecessClip({ name, description, caption, still, held }: { name: string; description: string; caption: string; still: string; held: boolean }) {
  const host = useRef<HTMLElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const motion = useMotionAllowed();
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = `${base}${name}`;
  const available = published.has(`${source}.mp4`);
  const poster = published.has(`${source}.jpg`) ? `${source}.jpg` : undefined;
  const resting = !motion || failed || !available;

  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .1 });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = player.current;
    if (!video || resting) return;
    if (!visible || held) {
      video.pause();
      return;
    }
    const sync = () => {
      if (document.hidden) video.pause();
      else {
        video.muted = true;
        void video.play().catch(() => {
          // Autoplay blocked: the poster stays.
        });
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, [visible, held, resting]);

  return <figure className="lp-recess-clip" ref={host}>
    <div className="lp-recess-picture">
      {available && <video ref={player} hidden={resting && Boolean(poster)} poster={poster} muted loop playsInline preload="none"
        aria-label={description} onError={() => setFailed(true)}>
        {published.has(`${source}.webm`) && <source src={`${source}.webm`} type="video/webm"/>}
        <source src={`${source}.mp4`} type="video/mp4" onError={() => setFailed(true)}/>
      </video>}
      {resting && (poster ? <img src={poster} alt={description} loading="lazy"/>
        : !available && <Sprite sheet={still} className="lp-recess-standin"/>)}
    </div>
    {available && <figcaption>{caption}</figcaption>}
  </figure>;
}

export function LandingRecess() {
  const root = useRef<HTMLElement>(null);
  const motion = useMotionAllowed();
  const [entered, setEntered] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setEntered(true);
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setOnScreen(entry.isIntersecting);
      if (entry.isIntersecting) setEntered(true);
    }, { threshold: .08 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <section className="lp-recess" id="recess" ref={root} aria-labelledby="landing-recess-title"
    data-entered={entered} data-paused={held || !onScreen}>
    <div className="lp-recess-head">
      <div>
        <p className="lp-recess-tag"><KeatingGlyph name="tool" size={14}/>Practice game</p>
        <h2 id="landing-recess-title" data-landing-section="recess">Take a <em>recess.</em></h2>
        <p className="lead">Stuck on a paragraph? In Recess, Keating puts on a jetpack and flies through your lesson. Its enemies are loose bits of that lesson, and the way past them is knowing it.</p>
      </div>
      <Sprite sheet="jetpack-hover" play="sheet" className="lp-recess-pilot"/>
    </div>

    <div className="lp-recess-play">
      <RecessClip name="recess-play" still="jetpack-aim" held={held}
        description="Keating flies a jetpack over a maths lesson, firing at stray symbols and gathering the sparks they drop."
        caption="The opening waves, from the design mockup"/>
      <div className="lp-recess-beats">
        <article><b>01</b><div><h3>The lesson fights back.</h3>
          <p>Stray symbols, a chain of rules, a wrong idea in a speech bubble. Every subject has its own cast, from maths to law to Japanese.</p></div></article>
        <article><b>02</b><div><h3>Answer to get through.</h3>
          <p>Between waves, three gates come down with answers to a question from your lesson. Knocked out? One more question gets you back up.</p></div></article>
      </div>
    </div>

    <div className="lp-recess-cast">
      {motion && onScreen && !held && <ShaderSurface effect="field" strength={.55}/>}
      <ul aria-label="Characters by subject">{cast.map(([sheet, subject], index) =>
        <li key={sheet} style={{ "--i": index } as CSSProperties}><Sprite sheet={`foe-${sheet}`}/><span className="lp-recess-subject">{subject}</span></li>)}
      </ul>
    </div>

    <div className="lp-recess-boss">
      <article className="lp-recess-beats"><b>03</b><div><h3>A boss made of waffle.</h3>
        <p>The Wall of Text slams, charges and throws your lesson’s own words at you. Strike it out line by line and it leaves the one sentence worth keeping.</p></div></article>
      <RecessClip name="recess-boss" still="foe-maths-wall" held={held}
        description="The Wall of Text boss throws words while Keating strikes its lines out."
        caption="The Wall of Text, from the design mockup"/>
    </div>

    <div className="lp-recess-more">
      <div><Sprite sheet="care-charging" play="sheet"/><div><h3>Look after him.</h3>
        <p>Studying gathers sparks, cogs and polish. Keep Keating charged and tuned and he flies better for it. Finish a lesson check to put a keepsake on his shelf. It gathers dust when it is time to review.</p></div></div>
      <div><Sprite sheet="kit-outfits-a" play="cycle"/><div><h3>Do it for real.</h3>
        <p>Work out the tax on a receipt, read a historical source, or describe your room in Spanish. Submit your written work to earn blueprint pieces and parts for Keating’s kit.</p></div></div>
    </div>

    <footer className="lp-recess-note">
      <p>Choose Recess beside the study actions in chat. The clips show the design mockup.</p>
      {motion && <button type="button" className="lp-play-toggle" onClick={() => setHeld(!held)}>
        {held ? "Play the motion" : "Pause the motion"}
      </button>}
    </footer>
  </section>;
}
