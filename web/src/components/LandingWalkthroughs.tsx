import { useRef, useState } from "react";
import { Button, Eyebrow } from "../design-system/kit";
import { walkthroughs, availableWalkthroughs, type LandingWalkthrough } from "./landing-walkthroughs";

const paths = Object.keys(import.meta.glob("/public/landing/walkthroughs/**/*")).map(path => path.slice("/public".length));
const clips = availableWalkthroughs(walkthroughs, new Set(paths));

function Walkthrough({ clip }: { clip: LandingWalkthrough }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  return <article className="lp-clip"><div className="lp-shot k-grid">
    <video ref={video} aria-label={clip.title} poster={clip.poster} controls={started} width={1280} height={800} playsInline preload="none">
      <source src={clip.webm} type="video/webm"/><source src={clip.mp4} type="video/mp4"/>
      <track kind="captions" src={clip.captions} srcLang="en" label="English"/>
    </video>
    {!started && <><Button variant="primary" glyph="play" aria-label={`Play ${clip.title}`} onClick={() => {
      setStarted(true); void video.current?.play().catch(() => setBlocked(true));
    }}>Play</Button><small>{clip.duration}</small></>}
  </div><b>{clip.title}</b><p>{clip.description}</p>
  {blocked && <p role="status">Press Play in the video controls to start.</p>}<a href={clip.guide}>Read the walkthrough</a></article>;
}

export function LandingWalkthroughs() {
  if (!clips.length) return null;
  return <section className="lp-watch" id="watch-it-work"><Eyebrow>Watch it work</Eyebrow><h2 data-landing-section="walkthroughs">A minute each.</h2>
    <div className="lp-clips">{clips.map(clip => <Walkthrough key={clip.mp4} clip={clip}/>)}</div>
  </section>;
}
