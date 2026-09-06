import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import { Download, FileText } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { paperCard } from "../../styled-system/recipes";

const styles = {
  page: cx("retro-layout", "retro-page"),
  main: css({ pt: "1.5rem", pb: "4rem", px: "1.5rem" }),
  container: css({ maxW: "56rem", mx: "auto" }),
  hero: cx(paperCard(), css({ p: "2rem", mb: "2rem" })),
  title: css({ fontSize: "1.875rem", fontWeight: "700", mb: "1rem", md: { fontSize: "2.25rem" } }),
  metaRow: css({ display: "flex", flexDir: "column", justifyContent: "space-between", gap: "1rem", md: { flexDir: "row", alignItems: "center" } }),
  meta: cx("font-terminal", css({ color: "var(--muted-foreground)" })),
  accent: css({ color: "#d5604b" }),
  accentDate: css({ color: "#d5604b", lineHeight: "1.75rem" }),
  download: css({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", bg: "#d5604b", color: "#f1ece0", px: "1.5rem", py: "0.75rem", fontWeight: "700", transitionProperty: "color, background-color", transitionDuration: "150ms", _hover: { bg: "#b33e33" } }),
  article: cx(paperCard(), css({ p: "2rem", lineHeight: "1.625", md: { p: "3rem" } })),
  abstractHeader: cx("font-terminal", css({ display: "flex", alignItems: "center", gap: "0.5rem", mb: "2rem", color: "var(--muted-foreground)", fontSize: "0.875rem", borderBottom: "1px solid var(--border)", pb: "1rem" })),
  abstract: css({ fontSize: "1.125rem", fontFamily: "serif", fontStyle: "italic", color: "color-mix(in srgb, var(--foreground) 80%, transparent)", mb: "2rem", lineHeight: "2rem", md: { fontSize: "1.25rem" } }),
  body: css({ color: "var(--foreground)", fontFamily: "serif", "& > * + *": { mt: "2rem" } }),
  paragraph: css({ fontSize: "1.125rem", lineHeight: "1.75rem" }),
  end: css({ mt: "3rem", pt: "2rem", borderTop: "1px solid var(--border)" }),
  endText: cx("font-terminal", css({ fontSize: "0.875rem", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center" })),
};

export function Paper() {
  useSeo({
    title: "Keating Paper — A Metaharness for Agency-Preserving AI Instruction",
    description: "The Keating paper: fresh teaching benchmarks, persistent hypotheses, validated skill revisions, and independent learner assessments, with explicit limits on evidence of learning.",
    canonical: "https://keating.help/paper",
  });
  return (
    <div className={styles.page}>
      <Nav />

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.hero}>
            <h1 className={styles.title}>
              Keating: A Metaharness for Agency-Preserving AI Instruction
            </h1>
            <div className={styles.metaRow}>
              <div className={styles.meta}>
                <span className={styles.accent}>AUTHOR:</span> Dio the Debugger <br />
                <span className={styles.accentDate}>DATE:</span> September 6, 2026
              </div>
              <a
                href="/keating-metaharness.pdf"
                download="keating-metaharness.pdf"
                className={styles.download}
              >
                <Download size={20} />
                DOWNLOAD PDF
              </a>
            </div>
          </div>

          <article className={styles.article}>
            <div className={styles.abstractHeader}>
              <FileText size={16} />
              ABSTRACT
            </div>
            
            <p className={styles.abstract}>
              AI tutors can scale explanation, but scaling explanation is not the same as scaling
              learning. A tutoring system that answers fluently may still weaken the learner&apos;s
              own reconstruction of a concept.
            </p>

            <div className={styles.body}>
              <p className={styles.paragraph}>
                Keating organizes live teaching, learner records, and inspectable artifacts around
                a control layer that can revise teaching procedures. This revision describes a new
                loop that executes tutor continuations, preserves evidence-linked hypotheses, and
                evaluates a proposed skill before activating its exact revision for later sessions.
              </p>

              <p className={styles.paragraph}>
                An 18-case mathematics and programming suite separates training, validation, and a
                single-use holdout. Both comparisons must show improvement, preserve every case
                family&apos;s score, and pass all critical criteria. The tutor cannot change the
                scoring weights or promote a saved prompt merely because it is the newest one.
              </p>
              
              <p className={styles.paragraph}>
                Recorded quiz performance, feedback proxies, synthetic teaching behavior, and
                independent learner assessments remain separate. New assessment records cover
                immediate performance, delayed recall, and transfer, preserving missing data and
                the learner&apos;s reported use of assistance.
              </p>

              <p className={styles.paragraph}>
                Historical analysis explains the redesign. A frozen policy gains 3.982 points
                inside an algebraic score model, yet 30 standardized MAP-Elites reruns yield 11
                improvements, four ties, and 15 regressions. Archived model-to-model teaching
                traces also expose student-role contamination. These findings diagnose the earlier
                system; they do not evaluate the new skill loop.
              </p>

              <p className={styles.paragraph}>
                The contribution is an implemented method with reproducible integrity checks.
                No live-provider performance results for the new loop or human learning effects
                are reported. Judge calibration, fresh independent cases, and randomized trials
                with delayed and transfer assessments remain necessary.
              </p>
            </div>

            <div className={styles.end}>
              <p className={styles.endText}>
                &mdash; End of Abstract &mdash;
              </p>
            </div>
          </article>
        </div>
      </main>

      <SimpleFooter />
    </div>
  );
}
