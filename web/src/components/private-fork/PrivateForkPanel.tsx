import { useId, useLayoutEffect, useRef, useState } from "react";
import { css } from "../../../styled-system/css";
import { resolvePrivateForkPassage } from "../../keating/private-fork-provenance";
import { errorMessage, roomStyles as s } from "../rooms/room-ui";

export type PrivateForkPassage = { selectedText: string; start: number; end: number; sourceHash: string };

export function exactPrivateForkPassage(text: string, start = 0, end = text.length): PrivateForkPassage {
  const { quote, ...range } = resolvePrivateForkPassage(text, { selectedText: text.slice(start, end), start, end });
  return { selectedText: quote, start: range.start, end: range.end, sourceHash: range.sourceHash };
}

/** Textareas normalize CRLF/CR. Map their offsets back to the unchanged source. */
export function rawPassageFromTextarea(text: string, value: string, start: number, end: number): PrivateForkPassage {
  const offsets = [0];
  let displayed = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\r" && text[index + 1] === "\n") index++;
    displayed += char === "\r" ? "\n" : char;
    offsets.push(index + 1);
  }
  if (value !== displayed || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end >= offsets.length) {
    throw new Error("Choose the passage again in the source text below.");
  }
  return exactPrivateForkPassage(text, offsets[start]!, offsets[end]!);
}

export interface PrivateForkPanelProps {
  title: string;
  sourceText: string;
  sourceLabel: string;
  sourceKind: "room" | "lesson";
  initialPassage?: PrivateForkPassage;
  lockPassage?: boolean;
  onCancel: () => void;
  onOpen: (args: { passage: PrivateForkPassage; question: string; signal: AbortSignal }) => Promise<void>;
}

/**
 * Inline confirmation: opening creates saved context; only Chat's Send runs a model.
 * Callers must remount on source/account/revision changes, or unmount when access
 * is invalidated, to discard the selected passage and abort any pending open.
 */
export function PrivateForkPanel({ title, sourceText, sourceLabel, sourceKind, initialPassage, lockPassage, onCancel, onOpen }: PrivateForkPanelProps) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const request = useRef<AbortController | null>(null);
  const [passage, setPassage] = useState<PrivateForkPassage | null>(() => {
    try {
      if (initialPassage) {
        const exact = resolvePrivateForkPassage(sourceText, initialPassage);
        return { selectedText: exact.quote, start: exact.start, end: exact.end, sourceHash: exact.sourceHash };
      }
      return exactPrivateForkPassage(sourceText);
    } catch { return null; }
  });
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    panel.current?.focus();
    return () => { request.current?.abort(); };
  }, []);
  const cancel = () => { request.current?.abort(); onCancel(); };
  const open = async () => {
    if (request.current || !passage) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      resolvePrivateForkPassage(sourceText, passage);
      await onOpen({ passage, question: question.trim(), signal: controller.signal });
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause, "The private continuation could not be opened. Try again."));
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  };
  return (
    <section ref={panel} tabIndex={-1} aria-labelledby={`${id}-title`} aria-describedby={`${id}-privacy`}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } }}
      className={css({ minW: 0, border: "1px solid var(--ink)", bg: "var(--card)", p: "0.85rem", display: "grid", gap: "0.65rem", _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "2px" } })}>
      <h3 id={`${id}-title`} className={s.heading}>{title}</h3>
      <p id={`${id}-privacy`} className={s.help}>
        The source stays {sourceKind === "room" ? "in the shared room" : "in the lesson"}. Your continuation is a separate Chat, outside room and teacher oversight, and does not complete course progress.
      </p>
      <div>
        <p className={s.fieldLabel}>{sourceLabel}</p>
        {passage ? <pre className={css({ mt: "0.35rem", maxH: "10rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: "0.82rem", lineHeight: 1.55 })}>{passage.selectedText}</pre>
          : <p role="status" className={s.help}>Choose a nonempty passage of up to 8,000 characters below.</p>}
      </div>
      {!lockPassage ? <details open={!passage || undefined}>
        <summary className={css({ cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)" } })}>Choose a passage</summary>
        <label className={`${s.field} ${css({ mt: "0.5rem" })}`}>
          <span className={s.fieldLabel}>Select text in the original source</span>
          <textarea readOnly disabled={busy} rows={6} value={sourceText.replace(/\r\n|\r/g, "\n")} className={s.input}
            aria-describedby={`${id}-selection-help`}
            onSelect={(event) => {
              const input = event.currentTarget;
              if (input.selectionStart === input.selectionEnd) return;
              try { setPassage(rawPassageFromTextarea(sourceText, input.value, input.selectionStart, input.selectionEnd)); setError(""); }
              catch (cause) { setPassage(null); setError(errorMessage(cause, "Choose the passage again.")); }
            }} />
        </label>
        <p id={`${id}-selection-help`} className={s.help}>Drag to select, or hold Shift and use the arrow keys. The excerpt above shows exactly what will be used.</p>
        {sourceText.length <= 8_000 ? <button type="button" className={s.button} disabled={busy} onClick={() => { try { setPassage(exactPrivateForkPassage(sourceText)); setError(""); } catch (cause) { setError(errorMessage(cause, "Choose another passage.")); } }}>Use whole source</button> : null}
      </details> : null}
      <label className={s.field}>
        <span className={s.fieldLabel}>Your question (optional)</span>
        <textarea value={question} maxLength={2_000} rows={2} disabled={busy} className={s.input} onChange={(event) => setQuestion(event.target.value)} aria-describedby={`${id}-send`} />
      </label>
      <p id={`${id}-send`} className={s.help}>Uses your chosen Chat model. Choose or connect one in Chat settings if needed. Your question is filled in for you; press Send in Chat when you are ready. Nothing runs when you open it.</p>
      <p className={s.help}>Saved in normal Chat history, with your usual storage, sync, export, and sharing settings.</p>
      {error ? <p role="alert" className={s.error}>{error}</p> : null}
      <div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
        <button type="button" className={s.primary} disabled={busy || !passage} onClick={() => void open()}>{busy ? "Opening…" : error ? "Try again" : "Open private Chat"}</button>
        <button type="button" className={s.button} onClick={cancel}>Cancel</button>
      </div>
      {busy ? <p role="status" className={s.help}>Checking the source and saving your continuation…</p> : null}
    </section>
  );
}
