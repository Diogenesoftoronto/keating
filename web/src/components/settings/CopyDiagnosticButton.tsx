import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { css } from "../../../styled-system/css";

export function CopyDiagnosticButton({ label, text, disabled = false }: { label: string; text: string | (() => string); disabled?: boolean }) {
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
    <button type="button" title={state === "copied" ? "Copied" : label} aria-label={label} disabled={disabled || state === "copying"} onClick={() => void copy()} className={css({ display: "inline-flex", alignItems: "center", gap: ".375rem", justifyContent: "center", minWidth: "2.75rem", height: "2.25rem", flexShrink: 0, border: "1px solid var(--border)", borderRadius: ".375rem", paddingInline: ".875rem", paddingBlock: 0, fontSize: ".75rem", fontWeight: 500, color: "var(--foreground)", cursor: "pointer", _hover: { background: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "2px" }, _disabled: { opacity: .5, cursor: "not-allowed" } })}>
      {state === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}<span role="status" aria-live="polite" className={css({ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" })}>{state === "copied" ? "Copied" : ""}</span>
    </button>
    {state === "failed" && <div className={css({ marginTop: ".5rem" })}><p role="status" className={css({ fontSize: ".75rem" })}>Clipboard unavailable. Select and copy the details below.</p><textarea aria-label={`${label} details`} readOnly value={fallback} onFocus={event => event.currentTarget.select()} className={css({ width: "100%", minHeight: "8rem", padding: ".5rem", border: "1px solid var(--border)", fontFamily: "var(--mono-body)", fontSize: ".75rem" })} /></div>}
  </div>;
}
