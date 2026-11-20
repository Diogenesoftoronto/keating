import { useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { KeatingBot } from "./KeatingBot";
import { ShaderSurface } from "../design-system/shaders";
import { LandingVideo, type LandingVideoHandle } from "./LandingVideo";

export function LandingIntro() {
  const film = useRef<LandingVideoHandle>(null);
  const [watching, setWatching] = useState(false);

  const toggleFilm = () => {
    setWatching(!watching);
    if (watching) film.current?.pause();
    else film.current?.play();
  };

  return (
    <section className="lp-intro" aria-labelledby="landing-intro-title">
      {!watching && <ShaderSurface effect="field"/>}
      <LandingVideo ref={film} hidden={!watching} title="Keating launch film" hasAudio durationLabel="1:10"
        mp4="/tapes/keating-4-launch.mp4?v=bf5957f16e1c" poster="/tapes/posters/keating-4-launch.jpg"
        captions="/tapes/captions/keating-4-launch.vtt" />
      <div className="landing-intro__portrait" hidden={watching} aria-hidden="true">
        <KeatingBot variant="body" state="waving" size={190} label="" animated />
      </div>
      <h2 id="landing-intro-title" data-landing-section="film">so we made keating</h2>
      <button type="button" className="k-button k-outline" onClick={toggleFilm} aria-expanded={watching}>
        {watching ? <><KeatingGlyph name="x" size={16} />Close film</> : <><KeatingGlyph name="play" size={16} />Watch the film <span>1:10</span></>}
      </button>
      <a className="landing-intro__scroll" href="#keating-lesson" aria-label="Continue to the interactive lesson">
        <span>Scroll</span><KeatingGlyph name="down" size={19} />
      </a>
    </section>
  );
}
