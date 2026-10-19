/** Loading note and load-failure alert for the saved-work sources. */
import { Loader2 } from "lucide-react";
import { css } from "../../../../styled-system/css";

export function SourceStatus({
  loading,
  error,
}: {
  loading: boolean;
  error: string;
}) {
  return (
    <>
{loading ? (
  <p
    className={css({
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      py: "2rem",
      color: "var(--ink-soft)",
    })}
  >
    <Loader2
      size={16}
      className={css({ animation: "spin 1s linear infinite" })}
    />{" "}
    Looking through your saved work…
  </p>
) : null}
{error ? (
  <p
    role="alert"
    className={css({
      color: "var(--destructive)",
      fontSize: "0.8rem",
    })}
  >
    Your saved sources could not be loaded: {error}. You can
    still create a blank course.
  </p>
) : null}
    </>
  );
}
