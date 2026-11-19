import { useEffect, useState } from "react";
import { Button, IconButton } from "../../design-system/kit";
import { css } from "../../../styled-system/css";

export function CopyDiagnosticButton({ label, text, disabled = false, showLabel = false }: { label: string; text: string | (() => string); disabled?: boolean; showLabel?: boolean }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [fallback, setFallback] = useState("");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2200);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    setState("copying");
    let value = "";
    try {
      value = typeof text === "function" ? text() : text;
      await navigator.clipboard.writeText(value);
      setFallback("");
      setState("copied");
    } catch {
      setFallback(value);
      setState("failed");
    }
  };
  return <div className={css({ display: "inline-block", flexShrink: 0, verticalAlign: "middle" })}>
    {showLabel
      ? <Button variant="ghost" aria-label={label} glyph={state === "copied" ? "check" : "copy"} disabled={disabled || state === "copying"} onClick={() => void copy()}>{label}</Button>
      : <IconButton size="sm" glyph={state === "copied" ? "check" : "copy"} label={label} disabled={disabled || state === "copying"} onClick={() => void copy()}/>}
    <span role="status" aria-live="polite" className={css({ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" })}>{state === "copied" ? "Copied" : ""}</span>
    {state === "failed" && <div className={css({ marginTop: ".5rem" })}><p role="status" className={css({ fontSize: ".75rem" })}>Clipboard unavailable. Select and copy the details below.</p><textarea aria-label={`${label} details`} readOnly value={fallback} onFocus={event => event.currentTarget.select()} className={css({ width: "100%", minHeight: "8rem", padding: ".5rem", border: "1px solid var(--border)", fontFamily: "var(--mono-body)", fontSize: ".75rem" })} /></div>}
  </div>;
}
