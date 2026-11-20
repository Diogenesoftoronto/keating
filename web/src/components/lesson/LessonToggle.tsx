import { useRef, type ReactNode } from "react";
import { KeatingGlyph, playGlyph, type GlyphName } from "../../design-system/glyphs";

/**
 * A capability toggle drawn as its glyph, not a checkbox: the mic is lit or struck through, the clock
 * runs or rests. A real checkbox sits underneath (visually hidden), so labels, roles and form tests behave
 * as before. Owner, 2026-11-20: checkboxes should read as what they switch ("a microphone icon checkbox").
 */
export function LessonToggle({ glyph, glyphOff, checked, onChange, disabled, children, hint, className = "" }: {
  glyph: GlyphName;
  /** Drawing for the off state, e.g. `micoff`, `cameraoff`, `mute`, `eyeoff`. Defaults to the dimmed `glyph`. */
  glyphOff?: GlyphName;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  /** One short mono line under the label. */
  hint?: ReactNode;
  className?: string;
}) {
  const host = useRef<HTMLLabelElement>(null);
  return <label ref={host} className={`lesson-toggle ${className}`} data-glyph-host data-on={checked || undefined}>
    <input type="checkbox" className="lesson-sr" checked={checked} disabled={disabled}
      onChange={event => {
        onChange(event.target.checked);
        const svg = host.current?.querySelector("svg");
        if (svg) requestAnimationFrame(() => playGlyph(svg as SVGSVGElement));
      }} />
    <span className="lesson-toggle__mark" aria-hidden="true"><KeatingGlyph name={checked ? glyph : glyphOff ?? glyph} size={13} active={checked} /></span>
    <span className="lesson-toggle__text">{children}{hint ? <small>{hint}</small> : null}</span>
  </label>;
}
