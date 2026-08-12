import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { css, cx } from "../../styled-system/css";
import { useReducedMotion } from "../hooks/use-media-query";
import { ShaderField } from "./ShaderField";
import { ScrambleText } from "./ScrambleText";

type ChannelId = "web" | "tui" | "cli" | "tour";

interface Channel {
  id: ChannelId;
  label: string;
  slate: string;
  title: string;
  blurb: string;
  src: string;
  poster: string;
}

/** Four tapes in one deck — the three surfaces, then the whole product in 32 seconds. */
const CHANNELS: Channel[] = [
  {
    id: "web",
    label: "Web",
    slate: "CH 01 · CLASSROOM",
    title: "Ask in the classroom.",
    blurb:
      "A live session: why cities form where they do. Keating reasons in the open, then hands back the one question worth answering next.",
    src: "/tapes/web-classroom.mp4",
    poster: "/tapes/posters/web-classroom.jpg",
  },
  {
    id: "tui",
    label: "TUI",
    slate: "CH 02 · TERMINAL",
    title: "Keep the dialogue in your terminal.",
    blurb:
      "The same conversation, running through Pi. Plans, concept maps, and everything Keating knows about you stay one keystroke away.",
    src: "/tapes/tui-collaborative.mp4",
    poster: "/tapes/posters/tui-collaborative.jpg",
  },
  {
    id: "cli",
    label: "CLI",
    slate: "CH 03 · ARTIFACTS",
    title: "Turn the lesson into files.",
    blurb:
      "One Special Relativity session becomes a plan, a concept map, a verification checklist, and a full trace — generated live, not staged for the camera.",
    src: "/tapes/cli-artifacts.mp4",
    poster: "/tapes/posters/cli-artifacts.jpg",
  },
  {
    id: "tour",
    label: "Tour",
    slate: "CH 04 · FULL TOUR",
    title: "The whole room in 32 seconds.",
    blurb:
      "Every route shipping today, in order: model routing, live media, the review runway, courses, and publishing. Loading states and access gates included.",
    src: "/tapes/keating-surface-tour.mp4",
    poster: "/tapes/posters/keating-surface-tour.jpg",
  },
];

interface ProductFeature {
  label: string;
  title: string;
  description: string;
  poster: string;
  to: "/chat" | "/live" | "/coming-up" | "/courses" | "/blog";
  action: string;
}

const PRODUCT_FEATURES: ProductFeature[] = [
  {
    label: "Model routing",
    title: "Choose by capability, not logo.",
    description:
      "Search every cloud and local model Keating can reach, then filter by vision, thinking, or context length.",
    poster: "/tapes/posters/feature-models.jpg",
    to: "/chat",
    action: "Open the classroom",
  },
  {
    label: "Live media",
    title: "Voice, vision, and tools in one session.",
    description:
      "Camera state, audio state, time to first response, frames sent, tools fired. When something stalls, you can see where.",
    poster: "/tapes/posters/feature-live.jpg",
    to: "/live",
    action: "Open Live",
  },
  {
    label: "Review runway",
    title: "Turn sessions into a return path.",
    description:
      "What is due, what you flagged, and what still needs verifying — in one place, with two-way Anki transfer.",
    poster: "/tapes/posters/feature-coming-up.jpg",
    to: "/coming-up",
    action: "See Coming Up",
  },
  {
    label: "Courses",
    title: "Make learning a room you return to.",
    description:
      "Lessons, sources, shared notes, decks, and peer work kept together behind the Not Organic gateway.",
    poster: "/tapes/posters/feature-courses.jpg",
    to: "/courses",
    action: "Explore Courses",
  },
  {
    label: "Standard.site",
    title: "Publish the record. Keep failure visible.",
    description:
      "Release notes and field work publish over the AT Protocol. When upstream is down, the page says so.",
    poster: "/tapes/posters/feature-publish.jpg",
    to: "/blog",
    action: "Open the publication",
  },
];

const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function SurfaceScreencasts() {
  const reducedMotion = useReducedMotion();
  const [activeId, setActiveId] = useState<ChannelId>("web");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = CHANNELS.findIndex((channel) => channel.id === activeId);
  const active = CHANNELS[activeIndex];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    // The deck's readout is written straight to the DOM: `timeupdate` fires
    // several times a second and none of the rest of the section depends on it.
    function paint() {
      const el = videoRef.current;
      if (!el) return;
      if (timecodeRef.current) {
        timecodeRef.current.textContent = `${formatTime(el.currentTime)} / ${formatTime(el.duration)}`;
      }
      if (progressRef.current) {
        const ratio = el.duration > 0 ? el.currentTime / el.duration : 0;
        progressRef.current.style.transform = `scaleX(${ratio.toFixed(4)})`;
      }
    }

    video.addEventListener("timeupdate", paint);
    video.addEventListener("loadedmetadata", paint);
    paint();

    setAutoplayBlocked(false);
    video.currentTime = 0;
    if (!reducedMotion) {
      void video.play().catch(() => {
        if (!cancelled) setAutoplayBlocked(true);
      });
    } else {
      video.pause();
    }

    return () => {
      cancelled = true;
      video.removeEventListener("timeupdate", paint);
      video.removeEventListener("loadedmetadata", paint);
      video.pause();
    };
  }, [activeId, reducedMotion]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextIndex = activeIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (activeIndex + 1) % CHANNELS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (activeIndex - 1 + CHANNELS.length) % CHANNELS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = CHANNELS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    setActiveId(CHANNELS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section
      className={css({
        position: "relative",
        isolation: "isolate",
        overflow: "hidden",
        borderBottom: "2px solid var(--ink)",
        background: "var(--paper)",
        paddingBlock: { base: "4rem", md: "6.5rem" },
      })}
      aria-labelledby="surface-screencasts-title"
    >
      <ShaderField colorVar="--accent-green" density={150} intensity={0.4} opacity={0.22} />

      <div className={cx("wrap", css({ position: "relative", zIndex: 1 }))}>
        <div
          className={css({
            display: "grid",
            gap: { base: "0.75rem", md: "2.5rem" },
            alignItems: "end",
            marginBottom: { base: "2rem", md: "2.75rem" },
            gridTemplateColumns: { base: "1fr", md: "minmax(0, 1.1fr) minmax(0, 0.9fr)" },
          })}
        >
          <h2
            id="surface-screencasts-title"
            className={css({
              margin: 0,
              fontFamily: "var(--mono-display)",
              fontWeight: 700,
              fontSize: { base: "2rem", md: "3.2rem" },
              lineHeight: 1,
              letterSpacing: "-0.035em",
            })}
          >
            <ScrambleText text="Watch it work." />
          </h2>
          <p
            className={css({
              margin: 0,
              maxWidth: "44ch",
              color: "var(--ink-soft)",
              lineHeight: 1.7,
            })}
          >
            Four tapes, recorded against the shipping build. Follow one question from the browser,
            into the terminal, out to the files it leaves behind.
          </p>
        </div>

        {/* ---- the deck ------------------------------------------------ */}
        <div
          className={css({
            border: "3px solid var(--ink)",
            background: "var(--card)",
            boxShadow: { base: "6px 6px 0 var(--accent-dim)", md: "12px 12px 0 var(--accent-dim)" },
          })}
        >
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
              borderBottom: "3px solid var(--ink)",
              background: "var(--terminal)",
              color: "var(--phosphor)",
              padding: { base: "0.5rem 0.7rem", md: "0.6rem 1rem" },
              fontFamily: "var(--mono-body)",
              fontSize: { base: "0.6rem", md: "0.68rem" },
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            })}
          >
            <span
              aria-hidden="true"
              className={css({
                width: "0.6rem",
                height: "0.6rem",
                borderRadius: "50%",
                background: "var(--red)",
                boxShadow: "0 0 10px var(--red)",
                animation: reducedMotion ? "none" : "retro-blink 1.6s step-end infinite",
              })}
            />
            <span className={css({ fontWeight: 700 })}>
              <ScrambleText text={active.slate} trigger="change" stagger={1.1} blur={false} />
            </span>
            <span
              ref={timecodeRef}
              className={css({ marginLeft: "auto", color: "var(--phosphor-dim)", fontVariantNumeric: "tabular-nums" })}
            >
              --:-- / --:--
            </span>
          </div>

          <div
            className={css({
              position: "relative",
              overflow: "hidden",
              background: "#070b09",
              aspectRatio: "16 / 9",
            })}
          >
            {CHANNELS.filter((channel) => channel.id !== active.id).map((channel) => (
              <div
                key={channel.id}
                id={`surface-panel-${channel.id}`}
                role="tabpanel"
                aria-labelledby={`surface-tab-${channel.id}`}
                hidden
              />
            ))}

            <div
              id={`surface-panel-${active.id}`}
              role="tabpanel"
              aria-labelledby={`surface-tab-${active.id}`}
              tabIndex={0}
              className={css({
                position: "absolute",
                inset: 0,
                _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-6px" },
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

              {/* Screen texture: scanlines, grain, and a corner vignette. */}
              <span
                aria-hidden="true"
                className={css({
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  pointerEvents: "none",
                  opacity: 0.5,
                  background:
                    "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.3) 0 1px, transparent 1px 3px)",
                })}
              />
              <span
                aria-hidden="true"
                className={css({
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  pointerEvents: "none",
                  opacity: 0.09,
                  mixBlendMode: "overlay",
                  backgroundImage: GRAIN_URL,
                })}
              />
              <span
                aria-hidden="true"
                className={css({
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  pointerEvents: "none",
                  background:
                    "radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.45) 100%)",
                })}
              />
              {/* Channel change flash — one short burst of static, keyed on the tape. */}
              {!reducedMotion && (
                <span
                  key={`static-${active.id}`}
                  aria-hidden="true"
                  className={css({
                    position: "absolute",
                    inset: 0,
                    zIndex: 3,
                    pointerEvents: "none",
                    backgroundImage: GRAIN_URL,
                    // Base 0 so a missing keyframe leaves no artifact behind.
                    opacity: 0,
                    animation: "surface-tune 340ms ease-out forwards",
                  })}
                />
              )}
            </div>
          </div>

          <span
            aria-hidden="true"
            className={css({
              display: "block",
              height: "3px",
              background: "var(--accent)",
              transformOrigin: "left center",
              transform: "scaleX(0)",
            })}
            ref={progressRef}
          />

          {/* ---- channel selector -------------------------------------- */}
          <div
            role="tablist"
            aria-label="Choose a Keating tape"
            className={css({
              display: "grid",
              borderTop: "3px solid var(--ink)",
              gridTemplateColumns: { base: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
            })}
          >
            {CHANNELS.map((channel, index) => {
              const selected = channel.id === activeId;
              return (
                <button
                  key={channel.id}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  id={`surface-tab-${channel.id}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`surface-panel-${channel.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveId(channel.id)}
                  onKeyDown={handleTabKeyDown}
                  className={css({
                    position: "relative",
                    display: "flex",
                    alignItems: "baseline",
                    gap: "0.5rem",
                    border: 0,
                    borderRight: "2px solid var(--ink)",
                    borderBottom: { base: "2px solid var(--ink)", md: "0" },
                    background: selected ? "var(--ink)" : "transparent",
                    color: selected ? "var(--paper)" : "var(--ink)",
                    padding: { base: "0.8rem 0.9rem", md: "0.95rem 1.2rem" },
                    cursor: "pointer",
                    fontFamily: "var(--mono-body)",
                    fontSize: { base: "0.72rem", md: "0.8rem" },
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    textAlign: "left",
                    textTransform: "uppercase",
                    transition: "background-color 140ms ease, color 140ms ease",
                    _last: { borderRight: 0 },
                    _hover: {
                      background: selected ? "var(--ink)" : "color-mix(in srgb, var(--accent) 22%, transparent)",
                    },
                    _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-4px", zIndex: 1 },
                  })}
                >
                  <span
                    className={css({
                      fontSize: "0.62rem",
                      opacity: 0.7,
                      fontVariantNumeric: "tabular-nums",
                    })}
                  >
                    0{index + 1}
                  </span>
                  {channel.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={css({
            display: "grid",
            gap: { base: "0.5rem", md: "2.5rem" },
            alignItems: "start",
            marginTop: { base: "1.5rem", md: "1.75rem" },
            gridTemplateColumns: { base: "1fr", md: "minmax(0, 0.9fr) minmax(0, 1.1fr)" },
          })}
        >
          <h3
            className={css({
              margin: 0,
              fontFamily: "var(--mono-display)",
              fontSize: { base: "1.35rem", md: "1.7rem" },
              lineHeight: 1.1,
              letterSpacing: "-0.015em",
            })}
          >
            <ScrambleText text={active.title} trigger="change" stagger={1.2} />
          </h3>
          <p className={css({ margin: 0, maxWidth: "52ch", color: "var(--ink-soft)", lineHeight: 1.7 })}>
            {active.blurb}
          </p>
        </div>

        {autoplayBlocked && (
          <p
            role="status"
            className={css({
              margin: "0.85rem 0 0",
              color: "var(--ink-soft)",
              fontFamily: "var(--mono-body)",
              fontSize: "0.72rem",
            })}
          >
            Playback is paused. Use the video controls to start this tape.
          </p>
        )}

        {/* ---- everything else ---------------------------------------- */}
        <div
          className={css({
            marginTop: { base: "3rem", md: "4.5rem" },
            borderTop: "2px solid var(--ink)",
            paddingTop: { base: "2rem", md: "2.75rem" },
          })}
        >
          <h3
            className={css({
              maxWidth: "24ch",
              margin: "0 0 2rem",
              fontFamily: "var(--mono-display)",
              fontWeight: 700,
              fontSize: { base: "1.6rem", md: "2.2rem" },
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
            })}
          >
            <ScrambleText text="The rest of the room." />
          </h3>

          <div
            className={css({
              display: "grid",
              gap: "1.25rem",
              gridTemplateColumns: {
                base: "minmax(0, 1fr)",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(6, minmax(0, 1fr))",
              },
            })}
          >
            {PRODUCT_FEATURES.map((feature, index) => (
              <article
                key={feature.label}
                className={css({
                  display: "flex",
                  minWidth: 0,
                  flexDirection: "column",
                  border: "2px solid var(--ink)",
                  background: "var(--card)",
                  boxShadow: "4px 4px 0 var(--ink)",
                  transition: "transform 160ms ease, box-shadow 160ms ease",
                  gridColumn: { base: "auto", lg: index < 2 ? "span 3" : "span 2" },
                  _hover: { transform: "translate(-2px, -2px)", boxShadow: "7px 7px 0 var(--accent-dim)" },
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
                    })}
                  />
                  <span
                    aria-hidden="true"
                    className={css({
                      position: "absolute",
                      inset: 0,
                      opacity: 0.35,
                      background:
                        "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.3) 0 1px, transparent 1px 3px)",
                    })}
                  />
                  <span
                    className={css({
                      position: "absolute",
                      bottom: "0.6rem",
                      left: "0.6rem",
                      border: "2px solid var(--ink)",
                      background: "var(--paper)",
                      padding: "0.25rem 0.45rem",
                      color: "var(--ink)",
                      fontFamily: "var(--mono-body)",
                      fontSize: "0.6rem",
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    })}
                  >
                    {feature.label}
                  </span>
                </div>
                <div
                  className={css({
                    display: "flex",
                    flex: 1,
                    flexDirection: "column",
                    padding: { base: "1.1rem", md: "1.3rem" },
                  })}
                >
                  <h4
                    className={css({
                      margin: 0,
                      fontFamily: "var(--mono-display)",
                      fontSize: { base: "1.15rem", md: "1.3rem" },
                      lineHeight: 1.15,
                    })}
                  >
                    {feature.title}
                  </h4>
                  <p
                    className={css({
                      margin: "0.7rem 0 1.2rem",
                      color: "var(--ink-soft)",
                      fontSize: "0.88rem",
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
                      color: "var(--accent-dim)",
                      fontFamily: "var(--mono-body)",
                      fontSize: "0.72rem",
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      textDecoration: "none",
                      textTransform: "uppercase",
                      _dark: { color: "var(--phosphor)" },
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
