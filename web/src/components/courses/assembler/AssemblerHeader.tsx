/** Title block of the course assembler with its close control. */
import { X } from "lucide-react";
import { css } from "../../../../styled-system/css";

export function AssemblerHeader({ onClose }: { onClose(): void }) {
  return (
  <header
    className={css({
      display: "flex",
      alignItems: "start",
      justifyContent: "space-between",
      gap: "1rem",
      borderBottom: "1px solid var(--ink)",
      bg: "var(--course-wash, #ddebdd)",
      p: "1rem",
    })}
  >
    <div>
      <p
        className={css({
          fontFamily: "var(--mono-display)",
          fontSize: "0.66rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--course-green-dark, #14743c)",
        })}
      >
        New course
      </p>
      <h2
        id="course-assembler-title"
        className={css({
          mt: "0.25rem",
          fontFamily: "Georgia, serif",
          fontSize: "1.8rem",
        })}
      >
        Assemble the course you want.
      </h2>
      <p
        className={css({
          mt: "0.35rem",
          maxW: "65ch",
          color: "var(--ink-soft)",
          lineHeight: 1.55,
        })}
      >
        Start empty, or bring in plans, quizzes, generated UI, visuals,
        maps, animations, and cards you already made with Keating.
        Everything stays editable.
      </p>
    </div>
    <button
      type="button"
      onClick={onClose}
      aria-label="Close course assembler"
      className={css({
        p: "0.35rem",
        _hover: { bg: "color-mix(in srgb, var(--ink) 8%, transparent)" },
      })}
    >
      <X size={19} />
    </button>
  </header>
  );
}
