/** Saved quizzes and generated artifacts that can seed the course. */
import { Shapes } from "lucide-react";
import { css, cx } from "../../../../styled-system/css";
import type { CourseArtifactSource } from "../../../courses/course-assembly";
import { choiceClass } from "./styles";

export function ArtifactsSection({
  artifacts,
  selected,
  onToggle,
}: {
  artifacts: readonly CourseArtifactSource[];
  selected: ReadonlySet<string>;
  onToggle(artifactId: string): void;
}) {
  return (
  <section
    className={css({
      mt: "1.25rem",
      borderTop: "1px solid var(--ink)",
      pt: "1rem",
    })}
  >
    <div
      className={css({
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "1rem",
      })}
    >
      <h3
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.45rem",
          fontFamily: "Georgia, serif",
          fontSize: "1.2rem",
        })}
      >
        <Shapes size={17} /> Artifact tray
      </h3>
      <span
        className={css({
          fontFamily: "var(--mono-display)",
          fontSize: "0.65rem",
          color: "var(--ink-soft)",
        })}
      >
        {artifacts.length}
      </span>
    </div>
    <p
      className={css({
        mt: "0.25rem",
        fontSize: "0.72rem",
        color: "var(--ink-soft)",
      })}
    >
      Quizzes, GenUI, images, maps, animations, verifications, and
      other saved work.
    </p>
    {artifacts.length ? (
      <div
        className={css({
          mt: "0.65rem",
          display: "grid",
          maxH: "22rem",
          gap: "0.5rem",
          overflowY: "auto",
          pr: "0.25rem",
          sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
        })}
      >
        {artifacts.map((artifact) => (
          <label
            key={artifact.id}
            className={cx(choiceClass, css({ cursor: "pointer" }))}
          >
            <input
              type="checkbox"
              checked={selected.has(artifact.id)}
              onChange={() => onToggle(artifact.id)}
            />
            <span>
              <strong
                className={css({
                  display: "block",
                  fontSize: "0.82rem",
                })}
              >
                {artifact.title}
              </strong>
              <small
                className={css({
                  display: "block",
                  mt: "0.1rem",
                  color: "var(--ink-soft)",
                })}
              >
                {artifact.kind.replaceAll("-", " ")} ·{" "}
                {artifact.sourceLabel}
              </small>
            </span>
          </label>
        ))}
      </div>
    ) : (
      <p
        className={css({
          mt: "0.5rem",
          fontSize: "0.78rem",
          color: "var(--ink-soft)",
        })}
      >
        Saved quizzes and generated learning artifacts will appear
        here.
      </p>
    )}
  </section>
  );
}
