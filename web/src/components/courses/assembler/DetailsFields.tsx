/** Course title, description, and the optional post-save review opt-in. */
import { css } from "../../../../styled-system/css";
import { inputClass } from "./styles";

export function DetailsFields({
  title,
  description,
  reviewAfterSave,
  onTitleChange,
  onDescriptionChange,
  onReviewAfterSaveChange,
}: {
  title: string;
  description: string;
  reviewAfterSave: boolean;
  onTitleChange(value: string): void;
  onDescriptionChange(value: string): void;
  onReviewAfterSaveChange(value: boolean): void;
}) {
  return (
    <>
<label
  className={css({
    display: "grid",
    gap: "0.35rem",
    fontSize: "0.74rem",
    fontWeight: 700,
  })}
>
  Course title
  <input
    value={title}
    maxLength={240}
    onChange={(event) => onTitleChange(event.target.value)}
    className={inputClass}
    autoFocus
  />
</label>
<label
  className={css({
    mt: "0.8rem",
    display: "grid",
    gap: "0.35rem",
    fontSize: "0.74rem",
    fontWeight: 700,
  })}
>
  What this course is for{" "}
  <textarea
    value={description}
    maxLength={4_000}
    onChange={(event) => onDescriptionChange(event.target.value)}
    className={inputClass}
    rows={3}
    placeholder="Optional. You can change this later."
  />
</label>
<label className={css({ mt: "0.8rem", display: "block", fontSize: "0.75rem", lineHeight: 1.5 })}>
  <input type="checkbox" checked={reviewAfterSave}
          onChange={(event) => onReviewAfterSaveChange(event.target.checked)} />{" "}
  Review course design after saving
  <span className={css({ display: "block", color: "var(--ink-soft)" })}>Optional suggestions in the builder. Uses your independent judgement setting; hosted mode may send saved course text to that service. Creating the course does not wait for review.</span>
</label>
    </>
  );
}
