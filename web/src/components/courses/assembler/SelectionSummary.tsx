/** Plain-language summary of what the new course will start with. */
import { KeatingGlyph } from "../../../design-system/glyphs";
import { css } from "../../../../styled-system/css";

export function SelectionSummary({
  hasSources,
  moduleCount,
  artifactCount,
  cardCount,
}: {
  hasSources: boolean;
  moduleCount: number;
  artifactCount: number;
  cardCount: number;
}) {
  return (
<div role="status" data-glyph-host
  className={css({
    mt: "1rem",
    borderTop: "1px solid var(--line-soft)",
    bg: "var(--paper)",
    p: "0.8rem",
  })}
>
  <p
    className={css({
      display: "flex",
      alignItems: "center",
      gap: "0.45rem",
      fontWeight: 750,
    })}
  >
    {hasSources ? <KeatingGlyph name="check" size={16} /> : <KeatingGlyph name="menu" size={16} />}{" "}
    {hasSources ? "Assembled start" : "Blank start"}
  </p>
  <p
    className={css({
      mt: "0.3rem",
      fontSize: "0.76rem",
      color: "var(--ink-soft)",
      lineHeight: 1.5,
    })}
  >
    {hasSources
      ? `${moduleCount} plan section${moduleCount === 1 ? "" : "s"}, ${artifactCount} artifact${artifactCount === 1 ? "" : "s"}, and ${cardCount} card${cardCount === 1 ? "" : "s"} selected.`
      : "No template content. Open the course and add your first module, lesson, assignment, source, quiz, or card."}
  </p>
</div>
  );
}
