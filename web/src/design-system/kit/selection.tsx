import { useId, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { KeatingGlyph, type GlyphName } from "../glyphs";
import { SOFT, useMotionAllowed } from "../motion";
import { classes, type Native } from "./primitives";

export function moveFocus(event: KeyboardEvent, buttons: HTMLElement[], vertical = false) {
  const index = buttons.indexOf(event.target as HTMLElement);
  if (index < 0 || !buttons.length) return;
  const previous = vertical ? "ArrowUp" : "ArrowLeft";
  const next = vertical ? "ArrowDown" : "ArrowRight";
  const step = event.key === previous ? -1 : event.key === next ? 1 : 0;
  const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 : step ? (index+step+buttons.length)%buttons.length : undefined;
  if (target === undefined) return;
  event.preventDefault();
  buttons[target].focus();
  return target;
}
type SegProps<T extends string> = Omit<Native<"div">,"onChange"> & {
  label: string; options: readonly { value: T; label: ReactNode; hint?: string }[]; value: T; onChange(value: T): void; wide?: boolean; size?: "sm" | "md";
};
export function Segmented<T extends string>({ label, options, value, onChange, wide, size = "md", className, onKeyDown, ...props }: SegProps<T>) {
  const hint = options.find(item=>item.value===value)?.hint;
  const id = useId();
  return <><div {...props} role="radiogroup" aria-label={label} aria-describedby={classes(props["aria-describedby"], hint ? id : undefined) || undefined} className={classes("k-seg",wide && "k-wide","k-"+size,className)}
    onKeyDown={e=>{ onKeyDown?.(e); if(e.defaultPrevented) return;
      const i = moveFocus(e,Array.from(e.currentTarget.querySelectorAll('[role="radio"]')),["ArrowUp","ArrowDown"].includes(e.key));
      if(i !== undefined) onChange(options[i].value);
    }}>
    {options.map(option=><button type="button" key={option.value} role="radio" aria-checked={option.value===value} tabIndex={option.value===value ? 0 : -1} onClick={()=>onChange(option.value)}>{option.label}</button>)}
  </div>{hint && <p className="k-hint" id={id}>{hint}</p>}</>;
}
export function Tabs({ label, items, value, onChange, stretch, className, onKeyDown, ...props }: Omit<Native<"div">,"onChange"> & {
  label: string; items: readonly { id: string; label: ReactNode; count?: number | string; glyph?: GlyphName }[]; value: string; onChange(id: string): void; stretch?: boolean;
}) {
  const animate = useMotionAllowed();
  const underline = useId();
  return <div {...props} role="tablist" aria-label={label} className={classes("k-tabs",stretch && "k-wide",className)} onKeyDown={e=>{
    onKeyDown?.(e); if(e.defaultPrevented) return;
    const i = moveFocus(e,Array.from(e.currentTarget.querySelectorAll('[role="tab"]')));
    if(i !== undefined) onChange(items[i].id);
  }}>{items.map(item=><button type="button" key={item.id} id={item.id+"-tab"} role="tab" aria-controls={item.id} aria-selected={item.id===value} tabIndex={item.id===value ? 0 : -1} onClick={()=>onChange(item.id)}>
    {item.glyph && <KeatingGlyph name={item.glyph}/>} {item.label}{item.count != null && <span className="k-count">{item.count}</span>}
    {item.id===value && (animate ? <motion.span className="k-underline" layoutId={underline} transition={SOFT}/> : <span className="k-underline"/>)}
  </button>)}</div>;
}
export function TabPanel({ id, active, className, ...props }: Native<"div"> & { id: string; active: boolean }) {
  return <div {...props} className={classes("k-panel",className)} tabIndex={0} id={id} role="tabpanel" aria-labelledby={id+"-tab"} hidden={!active}/>;
}
