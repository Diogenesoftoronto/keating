/**
 * The create button and its error alert. The label tells the learner whether
 * they are making a blank or an assembled course; the button is disabled while
 * creating or when the title is empty.
 */
import { Loader2, Plus } from "lucide-react";
import { css } from "../../../../styled-system/css";

export function CreateFooter({
  creating,
  titleValid,
  hasSources,
  error,
  onCreate,
}: {
  creating: boolean;
  titleValid: boolean;
  hasSources: boolean;
  error: string;
  onCreate(): void;
}) {
  return (
    <>
<button
  type="button"
  onClick={onCreate}
  disabled={creating || !titleValid}
  className={css({
    mt: "1rem",
    display: "inline-flex",
    w: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    border: "2px solid var(--ink)",
    bg: "var(--course-green, #1e9b50)",
    px: "1rem",
    py: "0.75rem",
    fontWeight: 800,
    color: "white",
    boxShadow: "4px 4px 0 var(--ink)",
    _disabled: { opacity: 0.6 },
  })}
>
  {creating ? (
    <Loader2
      size={17}
      className={css({ animation: "spin 1s linear infinite" })}
    />
  ) : (
    <Plus size={17} />
  )}
  {creating
    ? "Creating…"
    : hasSources
      ? "Create assembled course"
      : "Create blank course"}
</button>
{error && (
  <p
    role="alert"
    className={css({
      mt: "0.8rem",
      color: "var(--destructive)",
      fontSize: "0.8rem",
    })}
  >
    {error}
  </p>
)}
    </>
  );
}
