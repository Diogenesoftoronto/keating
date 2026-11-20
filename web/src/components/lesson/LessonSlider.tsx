import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import "./lesson-slider.css";

/**
 * A printed-ruler slider for lesson frames (board L4, decision 7). A real `<input type=range>` sits
 * over the drawn track, so keyboard (arrows, PageUp/PageDown, Home/End), touch and screen readers
 * behave as native; the ruler (major ticks every 25%, minor every 5%), green fill, square thumb and
 * faint "where you started" tick are drawn around it.
 * The current value rests at the end of the label row; clicking it opens a well for an exact value.
 */
export interface LessonSliderProps {
  label: string;
  /** Accessible name of the range; defaults to `label`. */
  ariaLabel?: string;
  /** Accessible name of the exact-value well; defaults to "<name> numeric value". */
  editLabel?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  /** The authored starting value, drawn as a faint tick so the learner sees how far they moved. */
  start?: number;
  onChange: (value: number) => void;
  /** Formats a value with its unit for the tag, the ends and the ARIA value text. */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

const fraction = (value: number, min: number, max: number) => max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

export function LessonSlider({ label, ariaLabel, editLabel, min, max, step, value, start, onChange, format = String, disabled = false, className = "" }: LessonSliderProps) {
  const id = useId();
  const name = ariaLabel ?? label;
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(false);
  const well = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!active) return;
    const end = () => setActive(false);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, [active]);
  useEffect(() => { if (editing) well.current?.select(); }, [editing]);
  const shown = format(value);
  const moved = start !== undefined && start !== value;
  const style = { "--at": fraction(value, min, max), "--from": fraction(start ?? value, min, max) } as CSSProperties;
  const commit = (input: HTMLInputElement) => {
    if (input.value.trim() !== "" && input.validity.valid && Number.isFinite(input.valueAsNumber)) onChange(input.valueAsNumber);
    setEditing(false);
  };
  return <div className={`lesson-slider ${className}`} style={style} data-active={active || undefined} data-moved={moved || undefined} data-disabled={disabled || undefined}>
    <div className="lesson-slider__row">
      <label className="lesson-label" htmlFor={id}>{label}</label>
      {editing
        ? <input ref={well} className="lesson-slider__well" type="number" aria-label={editLabel ?? `${name} numeric value`} min={min} max={max} step={step ?? "any"}
            defaultValue={value} autoFocus onBlur={event => commit(event.currentTarget)}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); commit(event.currentTarget); }
              if (event.key === "Escape") { event.preventDefault(); setEditing(false); }
            }} />
        : <button type="button" className="lesson-slider__value" disabled={disabled} aria-label={`${shown}. Type an exact ${name}`} title="Type an exact value" onClick={() => setEditing(true)}>{shown}</button>}
    </div>
    <div className="lesson-slider__track">
      <div className="lesson-slider__rail" aria-hidden="true">
        <i className="lesson-slider__fill" />
        {start !== undefined && <i className="lesson-slider__start" title={`Started at ${format(start)}`} />}
        <span className="lesson-slider__thumb"><span className="lesson-slider__tag">{shown}</span></span>
      </div>
      <input id={id} className="lesson-slider__input" type="range" aria-label={name} aria-valuetext={shown} min={min} max={max} step={step ?? "any"} value={value} disabled={disabled}
        onPointerDown={() => setActive(true)} onChange={event => onChange(Number(event.currentTarget.value))} />
    </div>
  </div>;
}
