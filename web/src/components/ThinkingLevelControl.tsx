import { useId, useRef } from "react";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { effectiveThinkingLevel, supportedThinkingOptions } from "./thinking-level";

/**
 * Thinking level for the current model, as a row of radio buttons that wrap on narrow screens.
 * Only levels the model accepts are offered; a stored level it does not accept shows as the level the
 * runtime will really use. Arrow keys, Home and End move and choose, as in a native radio group.
 */
export function ThinkingLevelControl({ model, level, onChange, disabled = false }: {
 model: Model<Api> | null | undefined; level: ThinkingLevel;
 onChange: (level: ThinkingLevel) => void; disabled?: boolean;
}) {
 const buttons = useRef<(HTMLButtonElement | null)[]>([]);
 const id = useId();
 const options = supportedThinkingOptions(model);
 const current = effectiveThinkingLevel(model, level);
 const name = model?.name ?? "this model";
 if (model && !model.reasoning) {
  return <div className="thinking-level" data-unsupported="">
   <div className="thinking-level__head"><span className="thinking-level__label">Thinking</span><strong>Not available</strong></div>
   <p className="thinking-level__hint">{name} answers without a separate thinking step. Pick a model marked “Step-by-step reasoning” to set one.</p>
  </div>;
 }
 const move = (index: number) => {
  const next = options[(index + options.length) % options.length];
  if (!next) return;
  onChange(next.value);
  buttons.current[(index + options.length) % options.length]?.focus();
 };
 return <div className="thinking-level">
  <div className="thinking-level__head">
   <span className="thinking-level__label" id={`${id}-label`}>Thinking</span>
   <strong aria-live="polite">{options.find(option => option.value === current)?.label ?? current}</strong>
  </div>
  <div className="thinking-level__options" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}>
   {options.map((option, index) => <button key={option.value} type="button" role="radio"
    ref={node => { buttons.current[index] = node; }}
    aria-checked={option.value === current} tabIndex={option.value === current ? 0 : -1} disabled={disabled}
    onClick={() => onChange(option.value)}
    onKeyDown={event => {
     const destination = event.key === "ArrowRight" || event.key === "ArrowDown" ? index + 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
     if (destination !== null) { event.preventDefault(); event.stopPropagation(); move(destination); }
    }}>{option.label}</button>)}
  </div>
  <p className="thinking-level__hint" id={`${id}-hint`}>
   {disabled ? "Wait for the reply to finish to change this." : `Levels ${name} supports. Higher thinks longer before answering: slower, usually more careful. Applies from your next message.`}
  </p>
 </div>;
}
