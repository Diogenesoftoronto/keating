import { ArrowDown } from "lucide-react";
import { KeatingBot } from "./KeatingBot";
import "./landing-intro.css";

export function LandingIntro() {
  return (
    <section className="landing-intro" aria-labelledby="landing-intro-title">
      <div className="landing-intro__portrait" aria-hidden="true">
        <KeatingBot variant="body" state="waving" size={256} label="" animated />
      </div>
      <h2 id="landing-intro-title">so we made keating</h2>
      <a className="landing-intro__scroll" href="#keating-lesson" aria-label="Continue to the interactive lesson">
        <span>Scroll</span><ArrowDown size={19} aria-hidden="true" />
      </a>
    </section>
  );
}
