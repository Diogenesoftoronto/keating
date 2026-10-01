import { useRef, useState } from "react";
import { ArrowDown, Play, X } from "lucide-react";
import { KeatingBot } from "./KeatingBot";
import "./landing-intro.css";

export function LandingIntro() {
  const film = useRef<HTMLVideoElement>(null);
  const [watching, setWatching] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  const toggleFilm = () => {
    const video = film.current;
    setPlaybackBlocked(false);
    setWatching(!watching);
    if (!video) return;
    if (watching) {
      video.pause();
      return;
    }
    // Keep play inside the user gesture so browsers allow the voiceover.
    video.muted = false;
    video.volume = 1;
    void video.play().catch(() => setPlaybackBlocked(true));
  };

  return (
    <section className={`landing-intro${watching ? " landing-intro--film" : ""}`} aria-labelledby="landing-intro-title">
      <video ref={film} className="landing-intro__film" hidden={!watching}
        src="/tapes/keating-4-launch.mp4?v=bf5957f16e1c" poster="/tapes/posters/keating-4-launch.jpg"
        controls playsInline preload="none" aria-label="Keating 4.0 launch film">
        <track kind="captions" src="/tapes/captions/keating-4-launch.vtt" srcLang="en" label="English" />
      </video>
      <div className="landing-intro__portrait" hidden={watching} aria-hidden="true">
        <KeatingBot variant="body" state="waving" size={256} label="" animated />
      </div>
      <h2 id="landing-intro-title">so we made keating</h2>
      <button type="button" className="landing-intro__watch" onClick={toggleFilm} aria-expanded={watching}>
        {watching ? <><X size={16} aria-hidden="true" />Close film</> : <><Play size={16} aria-hidden="true" />Watch the film <span>1:10</span></>}
      </button>
      {playbackBlocked && watching && <p role="status">Press Play in the video controls to start the film.</p>}
      <a className="landing-intro__scroll" href="#keating-lesson" aria-label="Continue to the interactive lesson">
        <span>Scroll</span><ArrowDown size={19} aria-hidden="true" />
      </a>
    </section>
  );
}
