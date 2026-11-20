import { useEffect, useRef, useState } from "react";
import { ChartFrame } from "../design-system/charts";
import { FrustrationClip } from "./FrustrationClip";

const results = [
  { title: "Practice", condition: "with a chatbot", value: "+48%", mark: "up", width: "48%" },
  { title: "The exam", condition: "without it", value: "−17%", mark: "dn", width: "17%" },
  { title: "The exam", condition: "same model, told to give hints, not answers", value: "no drop", mark: "nil", width: undefined },
];

export function LandingStudy() {
  const chart = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!chart.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio < .35) return;
      setEntered(true);
      observer.disconnect();
    }, { threshold: .35 });
    observer.observe(chart.current);
    return () => observer.disconnect();
  }, []);

  return <>
    <section className="lp-line">
      <FrustrationClip />
      <h2 data-landing-section="frustration">You asked to learn.<br/>You got more to read.</h2>
    </section>
    <section className="lp-proof"><div>
      <h2 data-landing-section="study">It felt like learning.<br/>The exam disagreed.</h2>
      <p className="lead">In a trial of nearly 1,000 students, those who got answers from a chatbot did better in practice and worse on the exam.</p>
    </div><div className="lp-chart" ref={chart} data-entered={entered}>
      <ChartFrame title="Practice and exam results" reading="Practice +48%, exam −17%, exam with hints: no drop.">
        {results.map(row => <div className="lp-row" key={row.condition}><span>{row.title}<small>{row.condition}</small></span>
          <div className="lp-tr"><i aria-hidden="true" className={`lp-bar lp-${row.mark}`} style={{ width: row.width }}/><b className={`lp-val lp-value-${row.mark}`}>{row.value}</b></div></div>)}
        <p className="lp-ft">
          <span>Compared with students who used no AI.</span>
          <a target="_blank" rel="noreferrer" href="https://www.pnas.org/doi/10.1073/pnas.2422633122">Read the study</a>
        </p>
      </ChartFrame>
    </div></section>
  </>;
}
