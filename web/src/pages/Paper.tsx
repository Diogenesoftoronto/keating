import { useEffect, useRef } from "react";
import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import { KeatingGlyph } from "../design-system/glyphs";
import "./public-pages.css";
import "./paper.css";

export function Paper() {
  const contents = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 701px)");
    const syncLayout = () => { if (contents.current) contents.current.open = wide.matches; };
    syncLayout();
    wide.addEventListener("change", syncLayout);
    return () => wide.removeEventListener("change", syncLayout);
  }, []);
  useSeo({
    title: "Keating Paper — A Metaharness for Agency-Preserving AI Instruction",
    description: "The Keating paper: fresh teaching benchmarks, persistent hypotheses, validated skill revisions, and independent learner assessments, with explicit limits on evidence of learning.",
    canonical: "https://keating.help/paper",
  });
  return (
    <div className="retro-layout retro-page public-page paper-page">
      <Nav publication />
      <main>
        <header className="paper-heading">
          <div className="paper-type"><span data-glyph-host><KeatingGlyph name="doc" size={18} />Research paper</span><span>PDF · 15 pages</span></div>
          <div className="paper-title public-enter">
            <h1>Keating: A Metaharness for <em>Agency-Preserving</em> AI Instruction</h1>
            <p className="paper-meta">
              <span>By Dio the Debugger</span>
              <time dateTime="2026-09-06">September 6, 2026</time>
            </p>
            <a className="k-button k-accent" href="/keating-metaharness.pdf" download="keating-metaharness.pdf">
              <KeatingGlyph name="export" size={17} /> Download PDF
            </a>
          </div>
          <a className="paper-cover public-texture-marble" href="/keating-metaharness.pdf">
            <img src="/keating-metaharness-preview.webp" width={576} height={746} alt="" />
            <span>Open full paper <KeatingGlyph name="right" size={17} /></span>
          </a>
        </header>
        <div className="paper-spread">
          <details className="paper-contents" ref={contents}>
            <summary><KeatingGlyph name="book" size={19} /> In the paper <KeatingGlyph name="chev" size={15} /></summary>
            <nav aria-label="Paper sections">
            {[["Introduction", 1], ["Methods", 4], ["Results", 7], ["Limitations", 13], ["Bibliography", 15]].map(([label, page]) => (
              <a key={page} href={`/keating-metaharness.pdf#page=${page}`}>
                <span>{label}</span><span aria-label={`PDF page ${page}`}>p. {page}</span>
              </a>
            ))}
            </nav>
          </details>
          <article className="paper-abstract" aria-labelledby="paper-abstract-title">
            <h2 id="paper-abstract-title">Abstract</h2>
          <div className="paper-copy">
            <p className="paper-lead">
              AI tutors can scale explanation, but scaling explanation is not the same as scaling
              learning. A tutoring system that answers fluently may still weaken the learner&apos;s
              own reconstruction of a concept.
            </p>

            <p>
              Keating organizes live teaching, learner records, and inspectable artifacts around
              a control layer that can revise teaching procedures. This revision describes a new
              loop that executes tutor continuations, preserves evidence-linked hypotheses, and
              evaluates a proposed skill before activating its exact revision for later sessions.
            </p>

            <p>
              An 18-case mathematics and programming suite separates training, validation, and a
              single-use holdout. Both comparisons must show improvement, preserve every case
              family&apos;s score, and pass all critical criteria. The tutor cannot change the
              scoring weights or promote a saved prompt merely because it is the newest one.
            </p>

            <p>
              Recorded quiz performance, feedback proxies, synthetic teaching behavior, and
              independent learner assessments remain separate. New assessment records cover
              immediate performance, delayed recall, and transfer, preserving missing data and
              the learner&apos;s reported use of assistance.
            </p>

            <p>
              Historical analysis explains the redesign. A frozen policy gains 3.982 points
              inside an algebraic score model, yet 30 standardized MAP-Elites reruns yield 11
              improvements, four ties, and 15 regressions. Archived model-to-model teaching
              traces also expose student-role contamination. These findings diagnose the earlier
              system; they do not evaluate the new skill loop.
            </p>

            <p>
              The contribution is an implemented method with reproducible integrity checks.
              No live-provider performance results for the new loop or human learning effects
              are reported. Judge calibration, fresh independent cases, and randomized trials
              with delayed and transfer assessments remain necessary.
            </p>
            <p className="paper-end">End of abstract</p>
          </div>
          </article>
        </div>
      </main>
      <SimpleFooter />
    </div>
  );
}
