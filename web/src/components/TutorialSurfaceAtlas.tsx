import { css, cx } from "../../styled-system/css";
import { eyebrow } from "../../styled-system/recipes";

export interface TutorialSurface {
  id: string;
  label: string;
  title: string;
  description: string;
  href: string;
  image: string;
  alt: string;
}

/**
 * The learner-facing surfaces that deserve an explanation in the tutorial.
 * Callback and share URLs are deliberately omitted: they are transitions, not
 * places a learner chooses as part of a normal Keating workflow.
 */
export const TUTORIAL_SURFACES: TutorialSurface[] = [
  {
    id: "classroom",
    label: "01 · Classroom",
    title: "Ask, branch, and build",
    description:
      "The main workspace for Socratic conversation, visible reasoning, tools, session forks, and interactive lesson objects.",
    href: "/chat",
    image: "/tutorial/surface-classroom.png",
    alt: "Keating classroom with its session rail, conversation, and composer.",
  },
  {
    id: "models",
    label: "02 · Models",
    title: "Route by capability",
    description:
      "Search local, browser, hosted, and cloud models; then filter by vision, reasoning, context, or provider.",
    href: "/chat?settings=providers",
    image: "/tutorial/surface-models.png",
    alt: "Keating model browser with provider and capability filters.",
  },
  {
    id: "live",
    label: "03 · Live",
    title: "Teach with voice and vision",
    description:
      "A duplex room for camera, audio, live transcripts, tools, connection state, and measurable response timing.",
    href: "/live",
    image: "/tutorial/surface-live.png",
    alt: "Keating Live with video, audio, transcript, and connection status panels.",
  },
  {
    id: "review",
    label: "04 · Review",
    title: "Mark the teaching itself",
    description:
      "Open a whole-turn note in the Margin, choose its signal, and add the required rationale before any optional detail.",
    href: "/review",
    image: "/tutorial/review-annotation.png",
    alt: "Keating Review with a tutor response and a new whole-turn annotation open in the Margin.",
  },
  {
    id: "coming-up",
    label: "05 · Coming Up",
    title: "Return at the right moment",
    description:
      "Prioritize open checks and spaced-repetition cards, see what is due, and move decks between Keating and Anki.",
    href: "/coming-up",
    image: "/tutorial/surface-coming-up.png",
    alt: "Keating Coming Up runway with due cards, review time, and a priority board.",
  },
  {
    id: "courses",
    label: "06 · Courses",
    title: "Assemble a durable learning room",
    description:
      "Create a blank course or select generated interaction cards from the artifact tray; plans and flashcard decks remain explicit when empty.",
    href: "/courses",
    image: "/tutorial/surface-course-builder.png",
    alt: "Keating course builder with a blank-course form, empty plan and deck sections, and repeated generated interaction cards in the artifact tray.",
  },
  {
    id: "usage",
    label: "07 · Training export",
    title: "Prepare documented training data",
    description:
      "Choose ChatML, Alpaca, or both; select a source and response-length threshold; redact secrets; then export a training ZIP.",
    href: "/usage",
    image: "/tutorial/usage-training-export.png",
    alt: "Keating Training data export with Both formats, All sources, an 80-character minimum, and secret redaction enabled.",
  },
  {
    id: "bench",
    label: "08 · Bench",
    title: "Compare models as teachers",
    description:
      "Run the same pedagogical workload across models and compare quality, speed, cost, and repeatable benchmark evidence.",
    href: "/bench",
    image: "/tutorial/surface-bench.png",
    alt: "Keating Bench model comparison with pedagogical scores, speed, and cost.",
  },
  {
    id: "tui",
    label: "09 · Terminal",
    title: "Keep the whole branch in view",
    description:
      "Use the layered sidepanel, model picker, custom portrait, message frames, and fork-aware session tree without leaving the terminal.",
    href: "/download",
    image: "/tapes/posters/tui-collaborative.jpg",
    alt: "Keating terminal interface with profile, actions, model, messages, and a forked session tree.",
  },
  {
    id: "cli",
    label: "10 · Artifacts",
    title: "Leave inspectable files behind",
    description:
      "Turn a topic into plans, maps, animations, verification reports, benchmarks, traces, and policy evolution artifacts.",
    href: "/download",
    image: "/tapes/posters/cli-artifacts.jpg",
    alt: "Keating command-line artifact workflow producing plans, maps, checks, and traces.",
  },
  {
    id: "publishing",
    label: "11 · Publishing",
    title: "Publish the learning record",
    description:
      "Read release notes and field work from Keating's AT Protocol publication, with honest loading and failure states.",
    href: "/blog",
    image: "/tutorial/surface-publishing.png",
    alt: "Keating publication with release notes, essays, and an explicit upstream status.",
  },
];

export function TutorialSurfaceAtlas() {
  return (
    <div
      className={css({
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: { base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" },
      })}
    >
      {TUTORIAL_SURFACES.map((surface) => (
        <article
          key={surface.id}
          id={`surface-${surface.id}`}
          className={css({
            minWidth: 0,
            border: "2px solid var(--ink)",
            background: "var(--card)",
            boxShadow: "4px 4px 0 var(--ink)",
            transition: "transform 160ms ease, box-shadow 160ms ease",
            _hover: { transform: "translate(-2px, -2px)", boxShadow: "6px 6px 0 var(--ink)" },
            _focusWithin: { outline: "3px solid var(--accent)", outlineOffset: "3px" },
          })}
        >
          <a
            href={surface.href}
            aria-label={`Open ${surface.title}`}
            className={css({ display: "flex", height: "100%", color: "inherit", flexDirection: "column", textDecoration: "none" })}
          >
            <div
              className={css({
                position: "relative",
                overflow: "hidden",
                aspectRatio: "16 / 10",
                borderBottom: "2px solid var(--ink)",
                background: "var(--terminal)",
              })}
            >
              <img
                src={surface.image}
                alt={surface.alt}
                loading="lazy"
                decoding="async"
                className={css({ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" })}
              />
              <span
                className={cx(
                  eyebrow(),
                  css({
                    position: "absolute",
                    top: "0.65rem",
                    left: "0.65rem",
                    border: "1px solid var(--paper)",
                    background: "color-mix(in srgb, var(--ink) 88%, transparent)",
                    color: "var(--paper)",
                    padding: "0.2rem 0.45rem",
                    fontSize: "10px",
                  }),
                )}
              >
                {surface.label}
              </span>
            </div>
            <div className={css({ display: "flex", flex: 1, flexDirection: "column", gap: "0.5rem", padding: "1rem" })}>
              <h3 className={css({ margin: 0, fontSize: "1.05rem", fontWeight: 700 })}>{surface.title}</h3>
              <p className={css({ margin: 0, color: "var(--ink-soft)", fontSize: "0.8rem", lineHeight: 1.55 })}>
                {surface.description}
              </p>
              <span className={cx(eyebrow(), css({ marginTop: "auto", paddingTop: "0.35rem", color: "var(--accent)" }))}>
                Open surface →
              </span>
            </div>
          </a>
        </article>
      ))}
    </div>
  );
}
