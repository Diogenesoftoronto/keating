import { useId, useState, type FormEvent, type ReactNode } from "react";
import { css } from "../../../styled-system/css";
import type { RoomCreateInput, RoomSettings } from "../../rooms/contracts";
import { errorMessage, roomStyles as s } from "./room-ui";

export interface RoomCreateDraft {
  title: string;
  topic: string;
  goal: string;
  participation: RoomSettings["participation"];
  replyReview: RoomSettings["replyReview"];
}

export function RoomChoice<Value extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  legend: string;
  name: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string; hint?: string }>;
  onChange: (value: Value) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={css({ display: "grid", gap: "0.35rem", minW: 0 })} disabled={disabled}>
      <legend className={s.fieldLabel}>{legend}</legend>
      <div className={s.segment}>
        {options.map((option) => (
          <label key={option.value} className={s.segmentOption}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <strong>{option.label}</strong>
            {option.hint ? <span className={s.segmentHint}>{option.hint}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export const PARTICIPATION_OPTIONS = [
  { value: "facilitate", label: "Joins in", hint: "Keating reads along and speaks when it can help." },
  { value: "on-request", label: "When asked", hint: "Only after @Keating or a teacher’s request." },
] as const;

export const REPLY_REVIEW_OPTIONS = [
  { value: "off", label: "Post directly", hint: "Keating’s replies reach the room right away." },
  { value: "teacher-approves", label: "Teacher approves", hint: "Replies wait for a teacher to approve, edit, or reject." },
] as const;

/**
 * Title, topic, goal, and the two choices that shape how Keating behaves.
 * Unsent input stays in place when creation fails.
 */
export function RoomCreateForm({
  initial,
  context,
  submitLabel = "Create room",
  onCreate,
  onCancel,
}: {
  initial?: Partial<RoomCreateDraft>;
  /** Shown above the fields, e.g. the course lesson the room will carry. */
  context?: ReactNode;
  submitLabel?: string;
  onCreate: (input: RoomCreateInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<RoomCreateDraft>({
    title: "",
    topic: "",
    goal: "",
    participation: "facilitate",
    replyReview: "off",
    ...initial,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (patch: Partial<RoomCreateDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate({
        title: draft.title.trim(),
        topic: draft.topic.trim(),
        goal: draft.goal.trim(),
        settings: { participation: draft.participation, replyReview: draft.replyReview },
      });
    } catch (cause) {
      setError(errorMessage(cause, "The room could not be created."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className={css({ display: "grid", gap: "0.9rem" })} aria-busy={busy}>
      {context}
      <label className={s.field}>
        <span className={s.fieldLabel}>Title</span>
        <input
          className={s.input}
          value={draft.title}
          maxLength={160}
          required
          placeholder="Thursday proof workshop"
          onChange={(event) => update({ title: event.target.value })}
        />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>Topic <span className={css({ fontWeight: 400, color: "var(--ink-soft)" })}>(optional)</span></span>
        <textarea
          className={s.input}
          value={draft.topic}
          rows={2}
          maxLength={2_000}
          placeholder="Induction on the natural numbers"
          onChange={(event) => update({ topic: event.target.value })}
        />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>Goal for the session <span className={css({ fontWeight: 400, color: "var(--ink-soft)" })}>(optional)</span></span>
        <textarea
          className={s.input}
          value={draft.goal}
          rows={2}
          maxLength={2_000}
          placeholder="Everyone writes one induction proof and explains its base case."
          onChange={(event) => update({ goal: event.target.value })}
        />
        <span className={s.help}>Keating reads the topic and goal and steers the conversation toward them.</span>
      </label>
      <RoomChoice
        legend="How Keating participates"
        name={`${id}-participation`}
        value={draft.participation}
        options={PARTICIPATION_OPTIONS}
        onChange={(participation) => update({ participation })}
      />
      <RoomChoice
        legend="Teacher review of Keating’s replies"
        name={`${id}-review`}
        value={draft.replyReview}
        options={REPLY_REVIEW_OPTIONS}
        onChange={(replyReview) => update({ replyReview })}
      />
      <p className={s.help}>
        Everyone in the room reads the same transcript. Teachers and the host also see private guidance and held replies.
        You can change these choices later.
      </p>
      {error ? <p role="alert" className={s.error}>{error}</p> : null}
      <div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
        <button type="submit" className={s.primary} disabled={busy || !draft.title.trim()}>
          {busy ? "Creating…" : submitLabel}
        </button>
        {onCancel ? <button type="button" className={s.button} onClick={onCancel} disabled={busy}>Cancel</button> : null}
      </div>
    </form>
  );
}
