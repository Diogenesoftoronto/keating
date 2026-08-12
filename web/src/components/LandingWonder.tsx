import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useReducedMotion } from "../hooks/use-media-query";
import { ShaderField } from "./ShaderField";
import { ScrambleText } from "./ScrambleText";

const HERO_HEADLINE_LINES = [
  ["Bring", "the", "question."],
  ["Keep", "the", "thinking."],
] as const;

const MASCOT_REACTIONS = [
  {
    src: "/brand/mascot-live-idle.png",
    phrase: "Bring me the part that almost makes sense.",
  },
  {
    src: "/brand/mascot-live-listening.png",
    phrase: "I am listening for the thin part.",
  },
  {
    src: "/brand/mascot-live-working.png",
    phrase: "Good. Now let us test the structure.",
  },
  {
    src: "/brand/mascot-live-speaking.png",
    phrase: "Your turn. Teach it back to me.",
  },
] as const;

const LEARNING_STAGES = [
  {
    number: "01",
    verb: "Listen",
    title: "Find the thin part.",
    body: "Keating listens to the way you explain an idea, then separates what you can reconstruct from what you only recognize.",
    image: "/brand/mascot-live-listening.png",
    imageAlt: "Keating listening closely",
    note: "The next question begins where your explanation loses its shape.",
    accent: "listen",
  },
  {
    number: "02",
    verb: "Rebuild",
    title: "Work from first principles.",
    body: "The easy answer stays out of reach long enough for you to rebuild the mechanism, connect the prerequisites, and make the idea your own.",
    image: "/brand/mascot-live-working.png",
    imageAlt: "Keating working through a problem",
    note: "Plans, maps, traces, and animations make the structure inspectable.",
    accent: "work",
  },
  {
    number: "03",
    verb: "Probe",
    title: "Let the explanation meet resistance.",
    body: "A counterexample, transfer question, or request for evidence reveals whether the new understanding survives outside the original prompt.",
    image: "/brand/mascot-live-speaking.png",
    imageAlt: "Keating asking the next question",
    note: "The teacher adjusts, but the learner keeps authorship of the reasoning.",
    accent: "probe",
  },
  {
    number: "04",
    verb: "Return",
    title: "Teach it back later.",
    body: "Keating turns the session into a return path. What is due, uncertain, or worth verifying remains visible across the browser and CLI.",
    image: "/brand/mascot-lotus.png",
    imageAlt: "Keating sitting calmly in a review pose",
    note: "If the explanation still holds later, the knowledge is finally yours.",
    accent: "return",
  },
] as const;

const CRT_FRAMES = [
  {
    id: "classroom",
    title: "Begin with the learner's explanation.",
    src: "/tapes/posters/web-classroom.jpg",
    alt: "Keating web classroom with a learner response and guided question",
    objectPosition: "top center",
  },
  {
    id: "live",
    title: "Keep voice, vision, and tools visible.",
    src: "/tapes/posters/feature-live.jpg",
    alt: "Keating Live interface with audio, video, and session panels",
    objectPosition: "top center",
  },
  {
    id: "return",
    title: "Turn the session into a return path.",
    src: "/tapes/posters/feature-coming-up.jpg",
    alt: "Keating Coming Up page with review priorities and learning items",
    objectPosition: "top center",
  },
  {
    id: "courses",
    title: "Keep the learning room intact.",
    src: "/tapes/posters/feature-courses.jpg",
    alt: "Keating course page with lesson content and a terminal-style course panel",
    objectPosition: "top center",
  },
  {
    id: "publish",
    title: "Leave an inspectable record.",
    src: "/tapes/posters/feature-publish.jpg",
    alt: "Keating publication page showing a Standard.site article",
    objectPosition: "top center",
  },
] as const;

export function AnimatedHeroHeadline() {
  let wordIndex = 0;

  return (
    <p className="hero-headline" aria-label="Bring the question. Keep the thinking.">
      {HERO_HEADLINE_LINES.map((line, lineIndex) => (
        <span key={line.join("-")} className="hero-headline-line" aria-hidden="true">
          {line.map((word) => {
            const delay = 100 + wordIndex * 78;
            wordIndex += 1;
            return (
              <span
                key={`${word}-${lineIndex}`}
                className="hero-headline-word"
                style={{ animationDelay: `${delay}ms` }}
              >
                {word}
              </span>
            );
          })}
        </span>
      ))}
      <span className="cursor" aria-hidden="true" />
    </p>
  );
}

export function HeroWonderStage({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [reactionIndex, setReactionIndex] = useState(0);
  const reaction = MASCOT_REACTIONS[reactionIndex];

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  function updateDepth(event: PointerEvent<HTMLDivElement>) {
    if (reducedMotion || event.pointerType !== "mouse") return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      stage.style.setProperty("--hero-terminal-x", `${(x * 13).toFixed(2)}px`);
      stage.style.setProperty("--hero-terminal-y", `${(y * 9).toFixed(2)}px`);
      stage.style.setProperty("--hero-rotate-x", `${(y * -1.3).toFixed(2)}deg`);
      stage.style.setProperty("--hero-rotate-y", `${(x * 1.9).toFixed(2)}deg`);
      stage.style.setProperty("--hero-far-x", `${(x * -14).toFixed(2)}px`);
      stage.style.setProperty("--hero-far-y", `${(y * -9).toFixed(2)}px`);
      stage.style.setProperty("--hero-shadow-x", `${(x * 7).toFixed(2)}px`);
      stage.style.setProperty("--hero-shadow-y", `${(y * 5).toFixed(2)}px`);
      stage.style.setProperty("--hero-mascot-x", `${(x * -24).toFixed(2)}px`);
      stage.style.setProperty("--hero-mascot-y", `${(y * -15).toFixed(2)}px`);
    });
  }

  function resetDepth() {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty("--hero-terminal-x", "0px");
    stage.style.setProperty("--hero-terminal-y", "0px");
    stage.style.setProperty("--hero-rotate-x", "0deg");
    stage.style.setProperty("--hero-rotate-y", "0deg");
    stage.style.setProperty("--hero-far-x", "0px");
    stage.style.setProperty("--hero-far-y", "0px");
    stage.style.setProperty("--hero-shadow-x", "0px");
    stage.style.setProperty("--hero-shadow-y", "0px");
    stage.style.setProperty("--hero-mascot-x", "0px");
    stage.style.setProperty("--hero-mascot-y", "0px");
  }

  return (
    <div
      ref={stageRef}
      className="hero-wonder-stage"
      onPointerMove={updateDepth}
      onPointerLeave={resetDepth}
    >
      {/* Phosphor halftone field, painted behind the badge and the terminal. */}
      <ShaderField colorVar="--phosphor" density={58} intensity={0.92} opacity={0.4} />
      <img
        className="hero-orbit-mark"
        src="/brand/logo-badge.png"
        alt=""
        aria-hidden="true"
        width={470}
        height={403}
      />
      <span className="hero-orbit hero-orbit-one" aria-hidden="true">
        WHY?
      </span>
      <span className="hero-orbit hero-orbit-two" aria-hidden="true">
        SHOW YOUR WORK
      </span>
      <span className="hero-orbit hero-orbit-three" aria-hidden="true">
        TRY AGAIN
      </span>

      <div className="hero-terminal-layer">{children}</div>

      <button
        className="hero-mascot-reaction"
        type="button"
        onClick={() => setReactionIndex((current) => (current + 1) % MASCOT_REACTIONS.length)}
        aria-label="Ask Keating for another prompt"
      >
        <span className="hero-mascot-bubble" aria-hidden="true">
          {reaction.phrase}
        </span>
        <span className="landing-visually-hidden" aria-live="polite">
          {reaction.phrase}
        </span>
        <img
          key={reaction.src}
          src={reaction.src}
          alt=""
          aria-hidden="true"
          width={640}
          height={640}
        />
      </button>
    </div>
  );
}

export function KineticTeachingText() {
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);
  const visibleRef = useRef(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || reducedMotion) return;

    const update = () => {
      frameRef.current = null;
      const rect = section.getBoundingClientRect();
      const viewport = window.innerHeight;
      const progress = Math.max(0, Math.min(1, (viewport - rect.top) / (viewport + rect.height)));
      const travel = (progress - 0.5) * Math.min(window.innerWidth * 0.16, 220);
      section.style.setProperty("--kinetic-a", `${travel}px`);
      section.style.setProperty("--kinetic-b", `${-travel * 0.72}px`);
      section.style.setProperty("--kinetic-c", `${travel * 0.42}px`);
    };

    const schedule = () => {
      if (!visibleRef.current) return;
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(update);
    };

    const observer =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            ([entry]) => {
              visibleRef.current = entry.isIntersecting;
              if (entry.isIntersecting) schedule();
            },
            { rootMargin: "35% 0px" },
          )
        : null;
    if (observer) {
      observer.observe(section);
    } else {
      visibleRef.current = true;
      update();
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [reducedMotion]);

  return (
    <section ref={sectionRef} className="kinetic-teaching" aria-labelledby="kinetic-title">
      <ShaderField colorVar="--accent-green" density={130} intensity={0.5} opacity={0.28} />
      <div className="kinetic-label">THE SOCRATIC LOOP</div>
      <h2 id="kinetic-title" className="landing-visually-hidden">
        Listen, ask, and teach it back
      </h2>
      <div className="kinetic-row kinetic-row-a" aria-hidden="true">
        LISTEN FOR THE THIN PART.
      </div>
      <div className="kinetic-row kinetic-row-b" aria-hidden="true">
        ASK WHAT CHANGES THE SHAPE.
      </div>
      <div className="kinetic-row kinetic-row-c" aria-hidden="true">
        TEACH IT BACK UNTIL IT HOLDS.
      </div>
      <img
        className="kinetic-mascot"
        src="/brand/mascot-head-v2.png"
        alt=""
        aria-hidden="true"
        width={1254}
        height={1254}
        loading="lazy"
      />
    </section>
  );
}

export function LearningJourney() {
  const reducedMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const frameRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  function findClosestCard() {
    frameRef.current = null;
    const track = trackRef.current;
    if (!track) return;
    const target = track.getBoundingClientRect().left + track.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - target);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setActiveIndex(closestIndex);
  }

  function handleScroll() {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(findClosestCard);
  }

  function goTo(index: number) {
    const nextIndex = Math.max(0, Math.min(LEARNING_STAGES.length - 1, index));
    const card = cardRefs.current[nextIndex];
    const track = trackRef.current;
    if (!card || !track) return;
    track.scrollTo({
      left: card.offsetLeft - (track.clientWidth - card.clientWidth) / 2,
      behavior: reducedMotion ? "auto" : "smooth",
    });
    setActiveIndex(nextIndex);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(LEARNING_STAGES.length - 1);
    }
  }

  return (
    <section className="learning-journey" id="manifesto" aria-labelledby="journey-title">
      <div className="wrap journey-heading">
        <div>
          <h2 id="journey-title">
            <ScrambleText text="Understanding changes focus as you move." />
          </h2>
        </div>
        <div className="journey-intro">
          <p>Each stage moves to the foreground while the rest of the lesson stays in view.</p>
          <div className="journey-controls" aria-label="Learning path controls">
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              aria-label="Previous learning stage"
            >
              ←
            </button>
            <span aria-live="polite">
              {String(activeIndex + 1).padStart(2, "0")} / {String(LEARNING_STAGES.length).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex === LEARNING_STAGES.length - 1}
              aria-label="Next learning stage"
            >
              →
            </button>
          </div>
        </div>
      </div>

      <div
        ref={trackRef}
        className="journey-track"
        role="region"
        aria-label="Keating learning stages"
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        {LEARNING_STAGES.map((stage, index) => (
          <article
            key={stage.number}
            ref={(node) => {
              cardRefs.current[index] = node;
            }}
            className={`journey-card journey-${stage.accent}${activeIndex === index ? " is-active" : ""}`}
            aria-current={activeIndex === index ? "step" : undefined}
          >
            <div className="journey-card-copy">
              <div className="journey-card-meta">
                <span>{stage.number}</span>
                <span>{stage.verb}</span>
              </div>
              <h3>{stage.title}</h3>
              <p>{stage.body}</p>
              <small>{stage.note}</small>
            </div>
            <div className="journey-card-image">
              <span className="journey-orbit" aria-hidden="true" />
              <img
                src={stage.image}
                alt={stage.imageAlt}
                width={640}
                height={640}
                loading="lazy"
                decoding="async"
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CrtPlaythrough() {
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [sectionVisible, setSectionVisible] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!("IntersectionObserver" in window)) {
      setSectionVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setSectionVisible(entry.isIntersecting),
      { rootMargin: "-10% 0px", threshold: 0.12 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reducedMotion || hoverPaused || focusPaused || !pageVisible || !sectionVisible) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % CRT_FRAMES.length);
    }, 5600);
    return () => window.clearInterval(timer);
  }, [focusPaused, hoverPaused, pageVisible, reducedMotion, sectionVisible]);

  function selectFrame(index: number) {
    setActiveIndex((index + CRT_FRAMES.length) % CRT_FRAMES.length);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectFrame(activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectFrame(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectFrame(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectFrame(CRT_FRAMES.length - 1);
    }
  }

  return (
    <section ref={sectionRef} className="crt-playthrough" aria-label="Keating product screens">
      <div
        className="wrap crt-program-layout"
        role="region"
        aria-label="Keating product screen slideshow. Use arrow keys to change screens."
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerEnter={() => setHoverPaused(true)}
        onPointerLeave={() => setHoverPaused(false)}
        onFocus={() => setFocusPaused(true)}
        onBlur={() => setFocusPaused(false)}
      >
        <div className="crt-program-stage">
          <div className="crt-wrap">
            <img src="/brand/crt-monitor.png" alt="" aria-hidden="true" width={573} height={436} />
            <div className="crt-screen crt-program-screen">
              {CRT_FRAMES.map((frame, index) => {
                const active = index === activeIndex;
                const failed = failedImages.has(frame.id);
                return (
                  <div
                    key={frame.id}
                    className={`crt-program-frame${active ? " is-active" : ""}`}
                    aria-hidden={!active}
                  >
                    {failed ? (
                      <div className="crt-program-fallback">
                        <strong>SCREEN SIGNAL LOST</strong>
                        <span>{frame.title}</span>
                      </div>
                    ) : (
                      <img
                        src={frame.src}
                        alt={active ? frame.alt : ""}
                        loading="lazy"
                        decoding="async"
                        style={{ objectPosition: frame.objectPosition }}
                        onError={() =>
                          setFailedImages((current) => {
                            const next = new Set(current);
                            next.add(frame.id);
                            return next;
                          })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
