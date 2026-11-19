import { KeatingGlyph } from "../design-system/glyphs";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { css } from "../../styled-system/css";
import { placeAgainstAnchor } from "./trajectory/anchor-position";

const triggerStyle = css({
  display: "inline-grid", placeItems: "center", verticalAlign: "middle", padding: 0,
  width: "1.5rem", minHeight: "1.5rem", border: 0, borderRadius: "50%",
  background: "transparent", color: "var(--muted-foreground)", cursor: "help",
  "&[aria-expanded=true]": { color: "var(--foreground)", background: "var(--muted)" },
  _focusVisible: { outlineOffset: "1px" },
  "@media (hover: hover)": { _hover: { color: "var(--foreground)", background: "var(--muted)" } },
});
const bubbleStyle = css({
  position: "fixed", zIndex: 60, visibility: "hidden", width: "max-content",
  maxWidth: "min(19rem, calc(100% - 1rem))",
  padding: ".5rem .625rem", border: "1px solid var(--border)", borderRadius: ".375rem",
  background: "var(--popover)", color: "var(--popover-foreground)", boxShadow: "var(--shadow-card)",
  fontFamily: "var(--font-ui)", fontSize: ".8125rem", lineHeight: 1.45, overflowWrap: "anywhere",
});

export function DiagnosticHelp({ term, text }: { term: string; text: string }) {
  const descriptionId = useId();
  const bubbleId = `${descriptionId}-bubble`;
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [mode, setMode] = useState<"hover" | "focus" | "pinned" | null>(null);
  const open = mode !== null;

  function cancelHoverClose() {
    clearTimeout(hoverTimer.current);
  }

  function scheduleHoverClose() {
    cancelHoverClose();
    // Leave enough time to cross the gap between the trigger and the tooltip.
    hoverTimer.current = setTimeout(() => setMode(current => current === "hover" ? null : current), 180);
  }

  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!trigger.current || !bubble.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const surface = { width: bubble.current.offsetWidth, height: bubble.current.offsetHeight };
      const { left, top } = placeAgainstAnchor(anchor, surface, {
        width: document.documentElement.clientWidth, height: window.innerHeight,
      }, { offset: 4 });
      Object.assign(bubble.current.style, { left: `${left}px`, top: `${top}px`, visibility: "visible" });
    }
    function dismiss() { setMode(null); }
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !bubble.current?.contains(event.target)) dismiss();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", dismiss, true);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className={triggerStyle} aria-label={`Explain ${term}`}
      aria-describedby={descriptionId} aria-expanded={open} aria-controls={open ? bubbleId : undefined}
      onPointerEnter={event => {
        if (event.pointerType !== "mouse") return;
        cancelHoverClose();
        setMode(current => current ?? "hover");
      }}
      onPointerLeave={event => { if (event.pointerType === "mouse") scheduleHoverClose(); }}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setMode("focus"); }}
      onBlur={() => setMode(null)}
      onClick={() => {
        cancelHoverClose();
        setMode(current => current === "pinned" ? null : "pinned");
      }}>
      <KeatingGlyph name="help" size={14} />
    </button>
    <span hidden id={descriptionId}>{text}</span>
    {open && createPortal(<span id={bubbleId} ref={bubble} className={bubbleStyle} aria-hidden="true"
      onPointerEnter={cancelHoverClose} onPointerLeave={scheduleHoverClose}>{text}</span>, document.body)}
  </>;
}
