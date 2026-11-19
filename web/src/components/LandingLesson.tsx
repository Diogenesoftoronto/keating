import { useState } from "react";
import { usePostHog } from "@posthog/react";
import { Chip, Eyebrow, Prose } from "../design-system/kit";
import { KeatingGlyph, type GlyphName } from "../design-system/glyphs";
import { KeatingBot } from "./KeatingBot";
import { LANDING_EXAMPLES, type LandingExampleId } from "./landing-examples";
import { LandingPractice } from "./LandingPractice";

const questions = {
  recursion: {
    prompt: "Happy to. A guess first, and a wrong one is useful: when a function calls itself, what happens to the call that is still waiting?",
    choices: ["It is replaced by the new call", "It pauses until the inner call returns", "Not sure yet"],
    replies: ["If it were replaced, where would the unfinished addition go? Trace the smaller call and look for what still needs doing.", "Paused is exactly right. Hold on to that word. Now predict what sum(2) returns.", "Start with sum(2). What work is left after it asks for sum(1)?"],
  },
  photosynthesis: {
    prompt: "A leaf grows in sunlight. Where would you look for the carbon atoms that end up in its sugar?",
    choices: ["In the light", "In the carbon dioxide", "Not sure yet"],
    replies: ["Light matters here. Can you find a carbon atom among the inputs written below?", "Yes. Now trace the water and the light separately.", "Compare the names of the inputs. Which one gives you a carbon atom to follow?"],
  },
  probability: {
    prompt: "Roll one fair die. Before we count the even results, what makes counting faces a fair comparison?",
    choices: ["Every face is equally likely", "Even faces are more likely", "Not sure yet"],
    replies: ["Exactly. Now count the faces that meet each condition.", "Imagine marking just the even faces with a pen. Would that change how a fair die lands?", "Picture the six faces. Is there a reason to give one face more weight?"],
  },
};
const notes: [GlyphName, string, string][] = [
  ["message", "A question back, first", "A wrong guess tells Keating where to start."],
  ["code", "Predict, then run it", "Code, simulations and diagrams you can poke, in the reply."],
  ["quiz", "A check before moving on", "One short question, marked, with the reason."],
];

export function LandingLesson() {
  const [id, setId] = useState<LandingExampleId>("recursion");
  const [guess, setGuess] = useState<number | null>(null);
  const posthog = usePostHog();
  const question = questions[id];
  const example = LANDING_EXAMPLES.find(item => item.id === id)!;
  return <section className="lp-lesson" id="keating-lesson">
    <div><Eyebrow>The same question, asked here</Eyebrow><h2 data-landing-section="lesson">You do the thinking.<br/><em>Keating helps it click.</em></h2>
      <p className="lead">It asks before it tells, and it builds on what you already know.</p>
      <ul className="lp-notes">{notes.map(([glyph,title,detail]) => <li key={glyph} data-glyph-host><KeatingGlyph name={glyph}/><span><b>{title}</b>{detail}</span></li>)}</ul>
    </div>
    <div className="lp-chat"><div className="lp-tabs" role="group" aria-label="Choose a lesson subject">
      {LANDING_EXAMPLES.map(item => <Chip as="button" key={item.id} selected={id === item.id} onClick={() => {
        setId(item.id); setGuess(null); posthog?.capture("landing_lesson_selected", { example_id: item.id });
      }}>{item.label}</Chip>)}<small>Try it. Nothing is sent.</small>
    </div><div className="lp-th" data-glyph-host>
      <p className="lp-me">{example.query}</p><Eyebrow>Keating</Eyebrow><Prose><p>{question.prompt}</p></Prose>
      <div className="lp-guess" role="group" aria-label="Make a guess">{question.choices.map((choice,i) =>
        <Chip as="button" key={choice} selected={guess === i} onClick={() => setGuess(i)}>{choice}</Chip>)}</div>
      <Prose aria-live="polite">{guess !== null && <p>{question.replies[guess]}</p>}</Prose>
      <LandingPractice exampleId={id}/>
    </div><div className="lp-dock" aria-hidden="true" data-glyph-host>
      <div className="lp-seat"><KeatingBot variant="body" state="sitting" size={62} label=""/></div>
      <div className="lp-composer"><span>Message Keating</span><div>{(["clip","mic","wave","send"] as const).map(name => <i key={name}><KeatingGlyph name={name} size={15}/></i>)}</div></div>
    </div></div>
  </section>;
}
