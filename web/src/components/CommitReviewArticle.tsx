import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, FileCode2, LockKeyhole, Network, Shield, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { css, cx } from "../../styled-system/css";
import { paperCard } from "../../styled-system/recipes";

export interface CommitReviewFlowStep {
  label: string;
  detail: string;
}

export interface CommitReviewSection {
  id: string;
  title: string;
  file: string;
  why: string;
  takeaway: string;
  snippet?: string;
}

export interface CommitReviewQuizCard {
  prompt: string;
  answer: string;
}

export interface CommitReviewArticleProps {
  commit: string;
  title: string;
  subtitle: string;
  routePath: string;
  summary: string[];
  misconception: string;
  flow: CommitReviewFlowStep[];
  sections: CommitReviewSection[];
  guardrails: string[];
  tests: string[];
  extraChange: string;
  quizzes: CommitReviewQuizCard[];
}

const styles = {
  page: css({ maxW: "72rem", mx: "auto" }),
  layout: css({ display: "grid", gap: "1.5rem", lg: { gridTemplateColumns: "minmax(0,1fr) 18rem" } }),
  minW0: css({ minW: 0 }),
  hero: cx(paperCard(), css({ p: "2rem", mb: "1.5rem", scrollMarginTop: "6rem" })),
  pillRow: cx("font-terminal", css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })),
  pill: css({ borderRadius: "9999px", border: "1px solid var(--border)", px: "0.75rem", py: "0.25rem" }),
  h1: css({ mt: "1rem", fontSize: "1.875rem", fontWeight: "700", md: { fontSize: "2.25rem" } }),
  subtitle: css({ mt: "0.75rem", maxW: "48rem", color: "var(--muted-foreground)" }),
  actionRow: css({ mt: "1.25rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.875rem" }),
  outlineButton: css({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: "0.375rem",
    border: "1px solid var(--border)",
    px: "0.75rem",
    py: "0.5rem",
    _hover: { bg: "var(--accent)" },
  }),
  summaryGrid: css({ display: "grid", gap: "1rem", mb: "1.5rem", md: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
  card: cx(paperCard(), css({ p: "1.25rem" })),
  smallHeading: css({ mb: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: "600" }),
  mutedSmall: css({ fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  summaryList: css({ "& > * + *": { mt: "0.5rem" }, fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  section: cx(paperCard(), css({ p: "1.5rem", mb: "1.5rem", scrollMarginTop: "6rem" })),
  sectionLast: cx(paperCard(), css({ p: "1.5rem", scrollMarginTop: "6rem" })),
  h2: css({ fontSize: "1.25rem", fontWeight: "700", mb: "1rem" }),
  flowGrid: css({ display: "grid", gap: "0.75rem", md: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, xl: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
  insetCard: css({ borderRadius: "0.75rem", border: "1px solid var(--border)", bg: "var(--background)", p: "1rem" }),
  stepLabel: cx("font-terminal", css({ fontSize: "0.75rem", color: "#d5604b" })),
  mt1Semibold: css({ mt: "0.25rem", fontSize: "0.875rem", fontWeight: "600" }),
  mt2Muted: css({ mt: "0.5rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  sectionHeader: css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }),
  fileLabel: cx("font-terminal", css({ fontSize: "0.75rem", color: "#d5604b" })),
  h2Tight: css({ mt: "0.25rem", fontSize: "1.25rem", fontWeight: "700" }),
  badge: css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", borderRadius: "9999px", border: "1px solid var(--border)", px: "0.75rem", py: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
  paragraph: css({ mt: "1rem", fontSize: "0.875rem", lineHeight: "1.5rem" }),
  takeaway: css({ mt: "1rem", borderRadius: "0.75rem", border: "1px solid var(--border)", bg: "var(--background)", p: "1rem" }),
  eyebrow: css({ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" }),
  details: css({ mt: "1rem", borderRadius: "0.75rem", border: "1px solid var(--border)", bg: "var(--background)", "&[open]": { bg: "color-mix(in srgb, var(--background) 80%, transparent)" } }),
  summary: css({ cursor: "pointer", listStyle: "none", px: "1rem", py: "0.75rem", fontSize: "0.875rem", fontWeight: "600" }),
  detailsBody: css({ px: "1rem", pb: "1rem" }),
  snippet: css({ overflowX: "auto", borderRadius: "0.75rem", border: "1px solid var(--border)", bg: "#171c17", p: "1rem", fontSize: "0.75rem", lineHeight: "1.5rem", color: "#f3ede1" }),
  ruleGrid: css({ display: "grid", gap: "0.75rem", md: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } }),
  testList: css({ "& > * + *": { mt: "0.75rem" }, fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  testItem: css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" }),
  greenIcon: css({ mt: "0.125rem", flexShrink: 0, color: "#1e9b50" }),
  extra: css({ mt: "1.25rem", borderRadius: "0.75rem", border: "1px solid var(--border)", bg: "var(--background)", p: "1rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  strong: css({ color: "var(--foreground)" }),
  quizIntro: css({ mb: "1rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  quizGrid: css({ display: "grid", gap: "1rem", md: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } }),
  quizCard: css({ borderRadius: "0.75rem", border: "1px solid var(--border)", bg: "var(--background)", p: "1rem" }),
  quizPrompt: css({ fontSize: "0.875rem", fontWeight: "600" }),
  revealButton: css({ mt: "0.75rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.75rem", py: "0.375rem", fontSize: "0.75rem", _hover: { bg: "var(--accent)" } }),
  answer: css({ mt: "0.75rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  aside: css({ display: "none", lg: { display: "block" } }),
  toc: cx(paperCard(), css({ position: "sticky", top: "5rem", p: "1.25rem" })),
  tocTitle: css({ fontSize: "0.875rem", fontWeight: "600", mb: "0.75rem" }),
  nav: css({ "& > * + *": { mt: "0.5rem" }, fontSize: "0.875rem" }),
  navLink: css({ display: "block", borderRadius: "0.375rem", px: "0.5rem", py: "0.25rem", color: "var(--muted-foreground)", _hover: { bg: "var(--accent)", color: "var(--accent-foreground)" } }),
};

function SnippetBlock({ code }: { code: string }) {
  return (
    <pre className={styles.snippet}>
      <code>{code}</code>
    </pre>
  );
}

function QuizCard({ prompt, answer }: CommitReviewQuizCard) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className={styles.quizCard}>
      <div className={styles.quizPrompt}>{prompt}</div>
      <button
        type="button"
        className={styles.revealButton}
        onClick={() => setRevealed((v) => !v)}
      >
        <Sparkles size={14} />
        {revealed ? "Hide answer" : "Reveal answer"}
      </button>
      {revealed && <p className={styles.answer}>{answer}</p>}
    </div>
  );
}

export function CommitReviewArticle({
  commit,
  title,
  subtitle,
  routePath,
  summary,
  misconception,
  flow,
  sections,
  guardrails,
  tests,
  extraChange,
  quizzes,
}: CommitReviewArticleProps) {
  const toc = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      { id: "flow", label: "Request flow" },
      ...sections.map((section) => ({ id: section.id, label: section.title })),
      { id: "guardrails", label: "Guardrails" },
      { id: "tests", label: "Tests" },
      { id: "quiz", label: "Retrieval" },
    ],
    [sections],
  );

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <div className={styles.minW0}>
          <section id="overview" className={styles.hero}>
            <div className={styles.pillRow}>
              <span className={styles.pill}>COMMIT {commit}</span>
              <span className={styles.pill}>TEACHING REVIEW</span>
              <span className={styles.pill}>HTTP PAGE</span>
            </div>
            <h1 className={styles.h1}>{title}</h1>
            <p className={styles.subtitle}>{subtitle}</p>
            <div className={styles.actionRow}>
              <Link to={routePath} className={styles.outlineButton}>
                Share this route
                <ArrowRight size={14} />
              </Link>
              <a href="#quiz" className={styles.outlineButton}>
                Jump to retrieval
                <ArrowRight size={14} />
              </a>
            </div>
          </section>

          <section className={styles.summaryGrid}>
            <div className={styles.card}>
              <div className={styles.smallHeading}><Network size={16} /> Main idea</div>
              <ul className={styles.summaryList}>
                {summary.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
            <div className={styles.card}>
              <div className={styles.smallHeading}><Shield size={16} /> Misconception</div>
              <p className={styles.mutedSmall}>{misconception}</p>
            </div>
            <div className={styles.card}>
              <div className={styles.smallHeading}><LockKeyhole size={16} /> Security gate</div>
              <p className={styles.mutedSmall}>
                The browser tools are the interface. The true enforcement point is the server route that approves or rejects file access.
              </p>
            </div>
          </section>

          <section id="flow" className={styles.section}>
            <h2 className={styles.h2}>Request flow</h2>
            <div className={styles.flowGrid}>
              {flow.map((step, index) => (
                <div key={`${step.label}-${index}`} className={styles.insetCard}>
                  <div className={styles.stepLabel}>STEP {index + 1}</div>
                  <div className={styles.mt1Semibold}>{step.label}</div>
                  <p className={styles.mt2Muted}>{step.detail}</p>
                </div>
              ))}
            </div>
          </section>

          {sections.map((section) => (
            <section key={section.id} id={section.id} className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.fileLabel}>{section.file}</div>
                  <h2 className={styles.h2Tight}>{section.title}</h2>
                </div>
                <div className={styles.badge}>
                  <FileCode2 size={14} /> File-by-file walkthrough
                </div>
              </div>
              <p className={styles.paragraph}>{section.why}</p>
              <div className={styles.takeaway}>
                <div className={styles.eyebrow}>Takeaway</div>
                <p className={styles.mt1Semibold}>{section.takeaway}</p>
              </div>
              {section.snippet ? (
                <details className={styles.details}>
                  <summary className={styles.summary}>
                    Show representative code snippet
                  </summary>
                  <div className={styles.detailsBody}>
                    <SnippetBlock code={section.snippet} />
                  </div>
                </details>
              ) : null}
            </section>
          ))}

          <section id="guardrails" className={styles.section}>
            <h2 className={styles.h2}>Guardrails worth remembering</h2>
            <div className={styles.ruleGrid}>
              {guardrails.map((rule) => (
                <div key={rule} className={cx(styles.insetCard, styles.mutedSmall)}>
                  • {rule}
                </div>
              ))}
            </div>
          </section>

          <section id="tests" className={styles.section}>
            <h2 className={styles.h2}>Tests and evidence</h2>
            <ul className={styles.testList}>
              {tests.map((test) => (
                <li key={test} className={styles.testItem}>
                  <CheckCircle2 size={16} className={styles.greenIcon} />
                  <span>{test}</span>
                </li>
              ))}
            </ul>
            <div className={styles.extra}>
              <strong className={styles.strong}>Also in the commit:</strong> {extraChange}
            </div>
          </section>

          <section id="quiz" className={styles.sectionLast}>
            <h2 className={styles.h2}>Retrieval</h2>
            <p className={styles.quizIntro}>
              Don’t just nod along. Try to reconstruct the architecture before revealing the answers.
            </p>
            <div className={styles.quizGrid}>
              {quizzes.map((quiz) => (
                <QuizCard key={quiz.prompt} {...quiz} />
              ))}
            </div>
          </section>
        </div>

        <aside className={styles.aside}>
          <div className={styles.toc}>
            <div className={styles.tocTitle}>On this page</div>
            <nav className={styles.nav}>
              {toc.map((item) => (
                <a key={item.id} href={`#${item.id}`} className={styles.navLink}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
