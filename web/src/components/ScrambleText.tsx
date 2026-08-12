import { useEffect, useRef, useState, type RefObject } from "react";
import { css, cx } from "../../styled-system/css";
import { useReducedMotion } from "../hooks/use-media-query";

/**
 * Text that resolves out of noise, character by character, left to right.
 *
 * The visible span is aria-hidden and a settled copy sits beside it in a
 * screen-reader-only span, so assistive tech reads the real sentence once
 * rather than following the churn. Under reduced motion the plain text renders
 * with no duplicate and no timers.
 *
 * Frames are written straight to the DOM node — a React render per frame per
 * heading would re-render half the landing page sixty times a second.
 */

const GLYPHS = "▚▞▖▘▝░▒▓█#$%&*+=~^|<>/\\{}[]()01";

const srOnly = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  border: 0,
  overflow: "hidden",
  whiteSpace: "nowrap",
  clipPath: "inset(50%)",
});

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

/** True once the referenced element has been at least partly on screen. Fires once. */
export function useInView(ref: RefObject<HTMLElement | null>, enabled = true): boolean {
  const [inView, setInView] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);

  return inView;
}

export interface ScrambleTextProps {
  text: string;
  /**
   * `view` decodes when the text scrolls into frame (default), `mount` starts
   * immediately, `change` re-runs every time `text` changes.
   */
  trigger?: "view" | "mount" | "change";
  /** Frames between each character starting to resolve. Lower is faster. */
  stagger?: number;
  /** Blur the line while it resolves. */
  blur?: boolean;
  /** Delay before the decode starts, in ms. */
  delay?: number;
  className?: string;
}

export function ScrambleText({
  text,
  trigger = "view",
  stagger = 1.7,
  blur = true,
  delay = 0,
  className,
}: ScrambleTextProps) {
  const reducedMotion = useReducedMotion();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(wrapperRef, trigger === "view" && !reducedMotion);
  const armed = !reducedMotion && (trigger === "view" ? inView : true);

  useEffect(() => {
    const node = spanRef.current;
    if (!node) return;

    const settle = () => {
      node.textContent = text;
      node.style.filter = "";
    };

    if (!armed) {
      settle();
      return;
    }

    const chars = [...text];
    // Whitespace never scrambles — it holds the word shapes in place.
    const schedule = chars.map((char, i) =>
      char.trim() === ""
        ? { start: 0, end: 0 }
        : { start: i * stagger, end: i * stagger + 8 + Math.random() * 14 },
    );
    const total = Math.max(1, ...schedule.map((s) => s.end));

    let frame = 0;
    let tick = 0;
    let raf = 0;

    function step() {
      tick += 1;
      let out = "";
      for (let i = 0; i < chars.length; i++) {
        const { start, end } = schedule[i];
        if (frame >= end) out += chars[i];
        else if (frame < start) out += tick % 2 ? randomGlyph() : " ";
        else out += randomGlyph();
      }
      node!.textContent = out;
      if (blur) {
        node!.style.filter = `blur(${((1 - frame / total) * 5).toFixed(2)}px)`;
      }

      if (frame >= total) {
        settle();
        return;
      }
      frame += 1;
      raf = requestAnimationFrame(step);
    }

    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(step);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      settle();
    };
  }, [armed, text, stagger, delay, blur]);

  if (reducedMotion) return <>{text}</>;

  return (
    <>
      <span
        ref={wrapperRef}
        aria-hidden="true"
        className={cx(
          css({
            position: "relative",
            display: "inline-block",
            maxWidth: "100%",
            verticalAlign: "bottom",
          }),
          className,
        )}
      >
        <span className={css({ visibility: "hidden" })}>{text}</span>
        <span
          ref={spanRef}
          className={css({ position: "absolute", inset: 0, willChange: "filter" })}
        >
          {text}
        </span>
      </span>
      <span className={srOnly}>{text}</span>
    </>
  );
}
