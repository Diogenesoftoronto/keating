import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { css, cx } from "../../styled-system/css";
import { sectionHead, sectionLede, sectionTitle } from "../../styled-system/recipes";
import { useReducedMotion } from "../hooks/use-media-query";

type SurfaceId = "web" | "tui" | "cli";

interface SurfaceClip {
  id: SurfaceId;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  handoff: string;
  src: string;
  poster: string;
}

const SURFACES: SurfaceClip[] = [
  {
    id: "web",
    label: "Web",
    eyebrow: "01 // LEARN",
    title: "Ask in the classroom.",
    description:
      "A live Gemini session: the learner asks why cities form where they do. Keating reasons in the open, then hands back the one question worth answering next.",
    handoff: "Move to the TUI when reading turns into working.",
    src: "/tapes/web-classroom.mp4",
    poster: "/tapes/posters/web-classroom.jpg",
  },
  {
    id: "tui",
    label: "TUI",
    eyebrow: "02 // COLLABORATE",
    title: "Keep the dialogue in your terminal.",
    description:
      "The collaborative OpenTUI host runs the same conversation through Pi — plans, concept maps, and everything Keating knows about you stay one keystroke away.",
    handoff: "Drop to the CLI when the conversation should leave something behind.",
    src: "/tapes/tui-collaborative.mp4",
    poster: "/tapes/posters/tui-collaborative.jpg",
  },
  {
    id: "cli",
    label: "CLI",
    eyebrow: "03 // INSPECT",
    title: "Turn the lesson into files.",
    description:
      "One Special Relativity session becomes a plan, a concept map, a verification checklist, and a full trace — generated live by the Bun CLI, not staged for the camera.",
    handoff: "Head back to the web shell when it is time to teach it back.",
    src: "/tapes/cli-artifacts.mp4",
    poster: "/tapes/posters/cli-artifacts.jpg",
  },
];

interface ProductFeature {
  number: string;
  label: string;
  title: string;
  description: string;
  poster: string;
  to: "/chat" | "/live" | "/coming-up" | "/courses" | "/blog";
  action: string;
}

const PRODUCT_FEATURES: ProductFeature[] = [
  {
    number: "04",
    label: "MODEL ROUTING",
    title: "Choose by capability, not logo.",
    description:
      "Search every cloud and local model Keating can reach, then filter by vision, thinking, or context length — whatever the lesson actually demands.",
    poster: "/tapes/posters/feature-models.jpg",
    to: "/chat",
    action: "Open the classroom",
  },
  {
    number: "05",
    label: "LIVE MEDIA",
    title: "Keep voice, vision, and tools in one session.",
    description:
      "Live shows you the machinery: camera state, audio state, time to first response, frames sent, tools fired. When something stalls, you can see exactly where.",
    poster: "/tapes/posters/feature-live.jpg",
    to: "/live",
    action: "Open Live",
  },
  {
    number: "06",
    label: "REVIEW RUNWAY",
    title: "Turn sessions into a return path.",
    description:
      "What is due, what you flagged as important, and what still needs verifying — collected in one place, with two-way Anki transfer. A runway, not another inbox.",
    poster: "/tapes/posters/feature-coming-up.jpg",
    to: "/coming-up",
    action: "See Coming Up",
  },
  {
    number: "07",
    label: "COURSES",
    title: "Make learning a room you can return to.",
    description:
      "Lessons, sources, shared notes, decks, peer work, and the teacher review you consented to — kept together behind the Not Organic gateway.",
    poster: "/tapes/posters/feature-courses.jpg",
    to: "/courses",
    action: "Explore Courses",
  },
  {
    number: "08",
    label: "STANDARD.SITE",
    title: "Publish the record. Keep failure visible.",
    description:
      "Release notes and field work publish to Standard.site over the AT Protocol. When upstream is down, the page says so — and says how to recover.",
    poster: "/tapes/posters/feature-publish.jpg",
    to: "/blog",
    action: "Open the publication",
  },
];

export function SurfaceScreencasts() {
  const reducedMotion = useReducedMotion();
  const [activeId, setActiveId] = useState<SurfaceId>("web");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = SURFACES.findIndex((surface) => surface.id === activeId);
  const active = SURFACES[activeIndex];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const stopPlayback = () => {
      cancelled = true;
      video.pause();
    };
    setAutoplayBlocked(false);
    video.currentTime = 0;
    if (reducedMotion) {
      video.pause();
      return stopPlayback;
    }
    void video.play().catch(() => {
      if (!cancelled) setAutoplayBlocked(true);
    });
    return stopPlayback;
  }, [activeId, reducedMotion]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextIndex = activeIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (activeIndex + 1) % SURFACES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (activeIndex - 1 + SURFACES.length) % SURFACES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SURFACES.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    setActiveId(SURFACES[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section
      className={css({
        borderBlock: "3px solid var(--ink)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, var(--paper)), var(--paper) 48%, color-mix(in srgb, var(--phosphor) 6%, var(--paper)))",
        paddingBlock: { base: "4rem", md: "6.5rem" },
      })}
      aria-labelledby="surface-screencasts-title"
    >
      <div
        className={css({
          width: "min(1180px, calc(100% - 2rem))",
          marginInline: "auto",
        })}
      >
        <div className={sectionHead()}>
          <span className="eyebrow prompt">open SURFACES.mp4</span>
        </div>
        <h2 id="surface-screencasts-title" className={sectionTitle()}>
          Watch Keating work.
        </h2>
        <p className={cx(sectionLede(), css({ maxWidth: "48rem" }))}>
          Every clip is a real session, recorded against the shipping build. Follow one question
          from the browser, into the terminal, out to the files it leaves behind.
        </p>

        <div
          className={css({
            display: "grid",
            gap: { base: "1.5rem", lg: "2.5rem" },
            alignItems: "start",
            marginTop: { base: "2rem", md: "3rem" },
            gridTemplateColumns: { base: "minmax(0, 1fr)", lg: "15rem minmax(0, 1fr)" },
          })}
        >
          <div>
            <div
              role="tablist"
              aria-label="Choose a Keating surface"
              className={css({
                display: "flex",
                overflowX: "auto",
                borderBottom: { base: "2px solid var(--ink)", lg: "0" },
                flexDirection: { base: "row", lg: "column" },
              })}
            >
              {SURFACES.map((surface, index) => {
                const selected = surface.id === activeId;
                return (
                  <button
                    key={surface.id}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    type="button"
                    id={`surface-tab-${surface.id}`}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`surface-panel-${surface.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveId(surface.id)}
                    onKeyDown={handleTabKeyDown}
                    className={css({
                      position: "relative",
                      flex: { base: "0 0 auto", lg: "initial" },
                      minWidth: { base: "7rem", lg: "100%" },
                      border: "0",
                      borderLeft: { base: "0", lg: "3px solid transparent" },
                      borderBottom: { base: "3px solid transparent", lg: "0" },
                      background: selected ? "var(--ink)" : "transparent",
                      color: selected ? "var(--paper)" : "var(--ink)",
                      padding: { base: "0.85rem 1rem", lg: "1rem 1.25rem" },
                      textAlign: "left",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8rem",
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      transition: "background-color 140ms ease, color 140ms ease",
                      _hover: { background: selected ? "var(--ink)" : "var(--accent-dim)" },
                      _focusVisible: {
                        outline: "3px solid var(--accent)",
                        outlineOffset: "3px",
                        zIndex: 1,
                      },
                    })}
                  >
                    <span
                      className={css({
                        display: { base: "none", lg: "inline" },
                        marginRight: "0.65rem",
                        color: selected ? "var(--accent)" : "var(--muted-foreground)",
                      })}
                    >
                      0{index + 1}
                    </span>
                    {surface.label}
                  </button>
                );
              })}
            </div>

            <p
              className={css({
                display: { base: "none", lg: "block" },
                marginTop: "1.5rem",
                borderTop: "1px solid var(--ink)",
                paddingTop: "1rem",
                color: "var(--muted-foreground)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.72rem",
                lineHeight: 1.65,
              })}
            >
              WEB → TUI → CLI → WEB
              <br />
              One project. Three entry points.
            </p>
          </div>

          <div className={css({ minWidth: 0 })}>
            {SURFACES.filter((surface) => surface.id !== active.id).map((surface) => (
              <div
                key={surface.id}
                id={`surface-panel-${surface.id}`}
                role="tabpanel"
                aria-labelledby={`surface-tab-${surface.id}`}
                hidden
              />
            ))}
          <div
            id={`surface-panel-${active.id}`}
            role="tabpanel"
            aria-labelledby={`surface-tab-${active.id}`}
            tabIndex={0}
            className={css({
              minWidth: 0,
              _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "5px" },
            })}
          >
            <div
              className={css({
                position: "relative",
                overflow: "hidden",
                border: "3px solid var(--ink)",
                background: "#090d0b",
                boxShadow: { base: "5px 5px 0 var(--accent-dim)", md: "9px 9px 0 var(--accent-dim)" },
                aspectRatio: "16 / 9",
              })}
            >
              <video
                key={active.id}
                ref={videoRef}
                className={css({ display: "block", width: "100%", height: "100%", objectFit: "cover" })}
                src={active.src}
                poster={active.poster}
                muted
                loop
                playsInline
                controls
                autoPlay={!reducedMotion}
                preload="metadata"
                aria-label={`${active.label} screencast: ${active.title}`}
              >
                Your browser does not support embedded video.
              </video>
              <div
                className={css({
                  position: "absolute",
                  top: "0.8rem",
                  left: "0.8rem",
                  border: "2px solid var(--ink)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                  padding: "0.35rem 0.55rem",
                  fontFamily: "var(--font-mono)",
                  fontSize: { base: "0.58rem", md: "0.68rem" },
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  pointerEvents: "none",
                })}
                aria-hidden="true"
              >
                {active.eyebrow}
              </div>
            </div>

            {autoplayBlocked && (
              <p
                role="status"
                className={css({
                  margin: "0.85rem 0 0",
                  color: "var(--muted-foreground)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                })}
              >
                Playback is paused. Use the video controls to start this screencast.
              </p>
            )}

            <div
              className={css({
                display: "grid",
                gap: { base: "0.75rem", md: "1.5rem" },
                marginTop: { base: "1.5rem", md: "1.75rem" },
                gridTemplateColumns: { base: "1fr", md: "minmax(0, 1fr) minmax(14rem, 0.7fr)" },
              })}
            >
              <div>
                <h3
                  className={css({
                    margin: 0,
                    fontFamily: "var(--font-display)",
                    fontSize: { base: "1.5rem", md: "2rem" },
                    lineHeight: 1.05,
                    color: "var(--ink)",
                  })}
                >
                  {active.title}
                </h3>
                <p className={css({ marginTop: "0.7rem", maxWidth: "46rem", lineHeight: 1.65 })}>
                  {active.description}
                </p>
              </div>
              <p
                className={css({
                  margin: 0,
                  borderLeft: "3px solid var(--accent)",
                  paddingLeft: "1rem",
                  color: "var(--muted-foreground)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.76rem",
                  lineHeight: 1.65,
                })}
              >
                NEXT HANDOFF
                <br />
                <span className={css({ color: "var(--ink)" })}>{active.handoff}</span>
              </p>
            </div>
          </div>
          </div>
        </div>

        <div
          className={css({
            marginTop: { base: "4rem", md: "6rem" },
            borderTop: "2px solid var(--ink)",
            paddingTop: { base: "2.25rem", md: "3rem" },
          })}
        >
          <div
            className={css({
              display: "grid",
              gap: { base: "1rem", md: "2rem" },
              alignItems: "end",
              gridTemplateColumns: { base: "1fr", md: "minmax(0, 1fr) minmax(18rem, 0.7fr)" },
            })}
          >
            <div>
              <span className="eyebrow prompt">open FEATURE_TOUR.hf</span>
              <h3
                className={css({
                  margin: "1rem 0 0",
                  maxWidth: "42rem",
                  fontFamily: "var(--font-display)",
                  fontSize: { base: "2rem", md: "3rem" },
                  lineHeight: 1,
                })}
              >
                Eight surfaces. One thread.
              </h3>
            </div>
            <p className={css({ margin: 0, color: "var(--muted-foreground)", lineHeight: 1.7 })}>
              The tour picks the thread up and carries it through the rest of Keating. Every frame
              comes from the routes shipping today — loading states, access gates, and recovery
              paths included.
            </p>
          </div>

          <figure
            className={css({
              margin: { base: "2rem 0 0", md: "2.75rem 0 0" },
            })}
          >
            <div
              className={css({
                position: "relative",
                overflow: "hidden",
                aspectRatio: "16 / 9",
                border: "3px solid var(--ink)",
                background: "#090d0b",
                boxShadow: { base: "5px 5px 0 var(--accent-dim)", md: "9px 9px 0 var(--accent-dim)" },
              })}
            >
              <video
                className={css({ display: "block", width: "100%", height: "100%", objectFit: "cover" })}
                src="/tapes/keating-surface-tour.mp4"
                poster="/tapes/posters/keating-surface-tour.jpg"
                controls
                muted
                playsInline
                preload="metadata"
                aria-label="Keating eight-feature product tour"
              >
                Your browser does not support embedded video.
              </video>
              <span
                className={css({
                  position: "absolute",
                  top: "0.8rem",
                  left: "0.8rem",
                  border: "2px solid var(--ink)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                  padding: "0.35rem 0.55rem",
                  fontFamily: "var(--font-mono)",
                  fontSize: { base: "0.58rem", md: "0.68rem" },
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  pointerEvents: "none",
                })}
                aria-hidden="true"
              >
                32 SEC // FULL PRODUCT TOUR
              </span>
            </div>
            <figcaption
              className={css({
                display: "flex",
                gap: "0.75rem 1.5rem",
                justifyContent: "space-between",
                flexWrap: "wrap",
                marginTop: "1rem",
                color: "var(--muted-foreground)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.72rem",
                lineHeight: 1.6,
              })}
            >
              <span>One question, carried across every surface Keating ships.</span>
              <span>WEB → MODEL → LIVE → REVIEW → COURSE → BLOG → TUI → CLI</span>
            </figcaption>
          </figure>

          <div
            className={css({
              display: "grid",
              gap: "1.25rem",
              marginTop: { base: "2rem", md: "2.75rem" },
              gridTemplateColumns: {
                base: "minmax(0, 1fr)",
                md: "repeat(2, minmax(0, 1fr))",
                xl: "repeat(6, minmax(0, 1fr))",
              },
            })}
          >
            {PRODUCT_FEATURES.map((feature, index) => (
              <article
                key={feature.number}
                className={css({
                  display: "flex",
                  minWidth: 0,
                  flexDirection: "column",
                  border: "2px solid var(--ink)",
                  background: "var(--paper)",
                  boxShadow: "5px 5px 0 var(--accent-dim)",
                  gridColumn: {
                    base: "auto",
                    xl: index < 2 ? "span 3" : "span 2",
                  },
                })}
              >
                <div
                  className={css({
                    position: "relative",
                    overflow: "hidden",
                    aspectRatio: "16 / 10",
                    borderBottom: "2px solid var(--ink)",
                    background: "#0a100c",
                  })}
                >
                  <img
                    src={feature.poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={css({
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: "top center",
                      transition: "transform 220ms ease",
                    })}
                  />
                  <span
                    className={css({
                      position: "absolute",
                      top: "0.75rem",
                      left: "0.75rem",
                      border: "2px solid var(--ink)",
                      background: "var(--paper)",
                      padding: "0.3rem 0.5rem",
                      color: "var(--ink)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.65rem",
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                    })}
                  >
                    {feature.number} // {feature.label}
                  </span>
                </div>
                <div
                  className={css({
                    display: "flex",
                    flex: 1,
                    flexDirection: "column",
                    padding: { base: "1.15rem", md: "1.4rem" },
                  })}
                >
                  <h4
                    className={css({
                      margin: 0,
                      fontFamily: "var(--font-display)",
                      fontSize: { base: "1.25rem", md: "1.45rem" },
                      lineHeight: 1.1,
                    })}
                  >
                    {feature.title}
                  </h4>
                  <p
                    className={css({
                      margin: "0.8rem 0 1.25rem",
                      color: "var(--muted-foreground)",
                      fontSize: "0.9rem",
                      lineHeight: 1.65,
                    })}
                  >
                    {feature.description}
                  </p>
                  <Link
                    to={feature.to}
                    className={css({
                      alignSelf: "flex-start",
                      marginTop: "auto",
                      color: "var(--accent)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.72rem",
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      textDecoration: "none",
                      textTransform: "uppercase",
                      _hover: { textDecoration: "underline", textUnderlineOffset: "0.25rem" },
                      _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "4px" },
                    })}
                  >
                    {feature.action} →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
