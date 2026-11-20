import { useEffect, useRef } from "react";
import { LandingVideo } from "./LandingVideo";
import { walkthroughs, availableWalkthroughs, type LandingWalkthrough } from "./landing-walkthroughs";

const paths = Object.keys(import.meta.glob("/public/landing/walkthroughs/**/*")).map(path => path.slice("/public".length));
const clips = availableWalkthroughs(walkthroughs, new Set(paths));

function Walkthrough({ clip }: { clip: LandingWalkthrough }) {
  return <li className="lp-clip">
    <LandingVideo title={clip.title} poster={clip.poster} mp4={clip.mp4} webm={clip.webm}
      captions={clip.captions} durationLabel={clip.duration} />
    <div className="lp-clip-caption">
      <h3>{clip.title}</h3>
      <a href={clip.guide} aria-label={`Read the walkthrough: ${clip.title}`}>Read the walkthrough</a>
    </div>
  </li>;
}

/** Every walkthrough sits beside the first one: a grid on wide screens, a tight stack on phones. */
export function LandingWalkthroughs() {
  const list = useRef<HTMLUListElement>(null);

  // One recording plays at a time. `play` does not bubble, so listen in the capture phase.
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const onPlay = (event: Event) => {
      node.querySelectorAll("video").forEach(video => { if (video !== event.target && !video.paused) video.pause(); });
    };
    node.addEventListener("play", onPlay, true);
    return () => node.removeEventListener("play", onPlay, true);
  }, []);

  if (!clips.length) return null;
  return <section className="lp-watch" id="watch-it-work" aria-labelledby="walkthroughs-title">
    <div className="lp-watch-header">
      <h2 id="walkthroughs-title" data-landing-section="walkthroughs">A minute each.</h2>
    </div>
    <ul className="lp-clips" id="landing-walkthroughs" ref={list} data-count={clips.length}
      aria-label={clips.length > 1 ? "Walkthrough videos" : undefined}>
      {clips.map(clip => <Walkthrough key={clip.mp4} clip={clip}/>)}
    </ul>
  </section>;
}
