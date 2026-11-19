import { Eyebrow } from "../design-system/kit";
import { ChartFrame, ChartTable } from "../design-system/charts";
import { useEntrance } from "../design-system/charts/shared";
import { KeatingBot } from "./KeatingBot";

const results = [
  { title: "Practice", condition: "with a chatbot", value: "+48%", mark: "up", width: "48%" },
  { title: "The exam", condition: "without it", value: "−17%", mark: "dn", width: "17%" },
  { title: "The exam", condition: "same model, told to give hints, not answers", value: "no drop", mark: "nil", width: undefined },
];

export function LandingStudy() {
  const chart = useEntrance<HTMLDivElement>();
  return <>
    <section className="lp-line"><div className="lp-buried k-grid" aria-hidden="true">
      <u/><u/><u/><div className="lp-bot"><KeatingBot variant="body" state="dizzy" size={104} label=""/></div><u/><u/>
    </div><h2 data-landing-section="frustration">You asked to learn.<br/>You got more to read.</h2></section>
    <section className="lp-proof"><div><Eyebrow>It is not just you</Eyebrow>
      <h2 data-landing-section="study">It felt like learning.<br/>The exam disagreed.</h2>
      <p className="lead">In a randomised trial with nearly 1,000 high-school maths students, the ones who practised with a plain chatbot solved more problems, then did worse on the exam without it. They did not notice the difference.</p>
      <cite>Bastani, Bastani, Sungu, Ge, Kabakcı and Mariman. <a target="_blank" rel="noreferrer" href="https://www.pnas.org/doi/10.1073/pnas.2422633122">Generative AI without guardrails can harm learning.</a> PNAS, 2025.</cite>
    </div><div className="lp-chart" ref={chart}>
      <ChartFrame title="Practice and exam results" reading="Practice +48%, exam −17%, exam with hints: no drop.">
        {results.map(row => <div className="lp-row" key={row.condition}><span>{row.title}<small>{row.condition}</small></span>
          <div className="lp-tr"><i aria-hidden="true" data-kc-enter={row.mark === "nil" ? "point" : "grow"} className={`lp-bar lp-${row.mark}`} style={{ width: row.width }}/><b className={`lp-val lp-value-${row.mark}`}>{row.value}</b></div></div>)}
        <p className="lp-ft">Compared with students who had no AI. The model was the same in both groups. What changed was whether it handed over the answer.</p>
        <ChartTable columns={["Assessment", "Condition", "Result"]} rows={results.map(row => [row.title,row.condition,row.value])}/>
      </ChartFrame>
    </div></section>
  </>;
}
