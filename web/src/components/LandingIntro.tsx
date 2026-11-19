import { useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { KeatingBot } from "./KeatingBot";
import { ShaderSurface } from "../design-system/shaders";

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
    <section className="lp-intro" aria-labelledby="landing-intro-title">
      {!watching && <ShaderSurface effect="field"/>}
      <video ref={film} className="landing-intro__film" hidden={!watching}
        src="/tapes/keating-4-launch.mp4?v=bf5957f16e1c" poster="/tapes/posters/keating-4-launch.jpg"
        controls playsInline preload="none" aria-label="Keating 4.0 launch film">
        <track kind="captions" src="/tapes/captions/keating-4-launch.vtt" srcLang="en" label="English" />
      </video>
      <div className="landing-intro__portrait" hidden={watching} aria-hidden="true">
        <KeatingBot variant="body" state="waving" size={190} label="" animated />
      </div>
      <h2 id="landing-intro-title" data-landing-section="film">so we made keating</h2>
      <button type="button" className="k-button k-outline" onClick={toggleFilm} aria-expanded={watching}>
        {watching ? <><KeatingGlyph name="x" size={16} />Close film</> : <><KeatingGlyph name="play" size={16} />Watch the film <span>1:10</span></>}
      </button>
      {playbackBlocked && watching && <p role="status">Press Play in the video controls to start the film.</p>}
      <a className="landing-intro__scroll" href="#keating-lesson" aria-label="Continue to the interactive lesson">
        <span>Scroll</span><KeatingGlyph name="down" size={19} />
      </a>
    </section>
  );
}
