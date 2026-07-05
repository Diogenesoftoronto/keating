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
    description: "The Keating paper: a metaharness for teaching, a control layer that organizes planning, prompting, retrieval, transfer, verification, and evaluation around the live teaching exchange.",
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
                <span className={styles.accentDate}>DATE:</span> April 3, 2026
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
                Keating is designed around that distinction. It is not a single tutoring chatbot;
                it is a metaharness for teaching, a control layer that organizes planning,
                prompting, retrieval, transfer, verification, and evaluation around the live
                teaching exchange.
              </p>

              <p className={styles.paragraph}>
                The live system now also records session cadence and topic revisit urgency through
                an engagement timeline derived from lesson logs and retention decay estimates,
                although that spaced-review mechanism is not separately evaluated in the present
                paper.
              </p>
              
              <p className={styles.paragraph}>
                We analyze two evidence layers: an archival trace set of 22 raw sessions curated
                to 16 topic x learner pairs, and a synthetic benchmark implemented directly in the
                repository. The archival set yields a normalized overall score of 0.61 (95%
                bootstrap interval 0.515-0.705), with strong topic heterogeneity: Special
                Relativity is highest at 0.75 and Stoicism lowest at 0.425.
              </p>

              <p className={styles.paragraph}>
                The synthetic layer shows that the current Keating policy, although evolved on
                Derivative alone, improves the full 14-topic harness by 6.703 points over the
                default policy across 200/200 seeds, with derivative-only evolution improving in
                29/30 reruns.
              </p>

              <p className={styles.paragraph}>
                The contribution of this paper is therefore twofold: a formal account of a
                teaching metaharness and a reproducible benchmark-and-analysis stack for studying
                agency-preserving instruction. The present evidence supports systems and
                methodology claims; a human randomized trial remains the necessary next step for
                causal pedagogical claims.
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
