import { useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { IconButton } from "../design-system/kit";
import { LandingVideo } from "./LandingVideo";
import { walkthroughs, availableWalkthroughs, type LandingWalkthrough } from "./landing-walkthroughs";

const paths = Object.keys(import.meta.glob("/public/landing/walkthroughs/**/*")).map(path => path.slice("/public".length));
const clips = availableWalkthroughs(walkthroughs, new Set(paths));

function nearestWalkthrough(track: HTMLDivElement) {
  const first = track.children.item(0);
  const second = track.children.item(1);
  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return 0;
  const stride = second.offsetLeft - first.offsetLeft;
  if (stride === 0) return 0;
  return Math.min(clips.length - 1, Math.max(0, Math.round(track.scrollLeft / stride)));
}

function Walkthrough({ clip }: { clip: LandingWalkthrough }) {
  return <article className="lp-clip">
    <LandingVideo title={clip.title} poster={clip.poster} mp4={clip.mp4} webm={clip.webm}
      captions={clip.captions} durationLabel={clip.duration} />
    <div className="lp-clip-caption">
      <h3>{clip.title}</h3>
      <a href={clip.guide} aria-label={`Read the walkthrough: ${clip.title}`}>Read the walkthrough</a>
    </div>
  </article>;
}

export function LandingWalkthroughs() {
  const rail = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  if (!clips.length) return null;

  function moveBy(step: number) {
    const track = rail.current;
    if (!track) return;
    const first = track.firstElementChild;
    const destination = track.children.item(nearestWalkthrough(track) + step);
    if (first instanceof HTMLElement && destination instanceof HTMLElement) {
      track.scrollTo({ left: destination.offsetLeft - first.offsetLeft });
    }
  }

  function trackPosition(event: UIEvent<HTMLDivElement>) {
    const track = event.currentTarget;
    const index = nearestWalkthrough(track);
    if (index === active) return;
    track.children.item(active)?.querySelector("video")?.pause();
    setActive(index);
  }

  function navigateWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const forward = getComputedStyle(event.currentTarget).direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    moveBy(event.key === forward ? 1 : -1);
  }

  return <section className="lp-watch" id="watch-it-work" aria-labelledby="walkthroughs-title">
    <div className="lp-watch-header">
      <h2 id="walkthroughs-title" data-landing-section="walkthroughs">A minute each.</h2>
      {clips.length > 1 && <div className="lp-watch-controls" role="group" aria-label="Walkthrough navigation">
        <span className="lp-watch-position" aria-live="polite">{active + 1} / {clips.length}</span>
        <IconButton label="Previous walkthrough" glyph="left" bordered aria-controls="landing-walkthroughs"
          aria-disabled={active === 0} onClick={() => moveBy(-1)} />
        <IconButton label="Next walkthrough" glyph="right" bordered aria-controls="landing-walkthroughs"
          aria-disabled={active === clips.length - 1} onClick={() => moveBy(1)} />
      </div>}
    </div>
    <div className="lp-clips" id="landing-walkthroughs" ref={rail}
      role={clips.length > 1 ? "group" : undefined} aria-label={clips.length > 1 ? "Walkthrough videos" : undefined}
      tabIndex={clips.length > 1 ? 0 : undefined} onScroll={clips.length > 1 ? trackPosition : undefined}
      onKeyDown={clips.length > 1 ? navigateWithKeyboard : undefined}>
      {clips.map(clip => <Walkthrough key={clip.mp4} clip={clip}/>)}
    </div>
  </section>;
}
