import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { LandingOpening } from "../components/LandingOpening";
import { LandingStudy } from "../components/LandingStudy";
import { LandingIntro } from "../components/LandingIntro";
import { LandingLesson } from "../components/LandingLesson";
import { LandingLearning } from "../components/LandingLearning";
import { LandingWalkthroughs } from "../components/LandingWalkthroughs";
import { LandingClosing } from "../components/LandingClosing";
import { KeatingGlyph, type GlyphName } from "../design-system/glyphs";
import { useLandingAnalytics } from "../hooks/useLandingAnalytics";
import { useSeo } from "../hooks/useSeo";
import { DOCUMENTATION_URL } from "../lib/tutorial-links";
import "./landing-page.css";

const options: [GlyphName, string, string][] = [
  ["chip", "Choose your model", "Use Keating’s hosted teacher, bring a key, or run a model locally."],
  ["folder", "Your data", "Export your sessions and learning records."],
  ["code", "Open source", "Change the teacher or host it yourself."],
];

export function Landing() {
  const { root } = useLandingAnalytics();
  useSeo({
    title: "Keating: it made sense yesterday",
    description: "A chatbot explains it and you nod. The next day it is gone. Keating is an AI teacher that asks before it tells, checks what stuck, and remembers where you are. Start in the browser or download it.",
    canonical: "https://keating.help/",
  });
  return <div className="retro-layout retro-page landing-page"><Nav/>
    <main className="lp" ref={root}>
      <LandingOpening/><LandingStudy/><LandingIntro/><LandingLesson/><LandingLearning/>
      <section className="lp-own"><h2 data-landing-section="setup">Make it your own.</h2>
        <div className="lp-tiles">{options.map(([glyph, title, copy]) => <div key={title} data-glyph-host>
          <KeatingGlyph name={glyph} size={22}/><b>{title}</b><p>{copy}</p>
        </div>)}</div>
        <div className="lp-cta"><a href={`${DOCUMENTATION_URL}start-here/`}>Setup guide</a>
          <a href="https://github.com/Diogenesoftoronto/keating" target="_blank" rel="noreferrer">Explore the source</a></div>
      </section>
      <LandingWalkthroughs/><LandingClosing/>
    </main><Footer/>
  </div>;
}
