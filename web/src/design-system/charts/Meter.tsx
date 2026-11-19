import type { ComponentPropsWithRef } from "react";
import { KeatingGlyph } from "../glyphs";
import { useEntrance } from "./shared";

export type MeterProps = ComponentPropsWithRef<"div"> & {
  value?: number; max: number; label?: string; tone?: "data" | "series1" | "series2" | "series3" | "ink" | "ok" | "warn" | "bad";
  threshold?: {value: number; label: string}; indeterminate?: boolean; size?: "sm" | "md" | "lg"; valueText?: string; progress?: boolean;
  /** Something is happening right now (a download, a run): light streaks step through the filled part. Decoration only. */
  live?: boolean;
};
export function Meter({value = 0, max, label, tone = "data", threshold, indeterminate, valueText, size = "md", progress, live, className, ...props}: MeterProps) {
  const limit = Number.isFinite(max) && max > 0 ? max : 1;
  const now = Number.isFinite(value) ? Math.max(0,Math.min(limit,value)) : 0;
  const reading = [valueText ?? (indeterminate ? "In progress" : now+" of "+limit), threshold && threshold.label+" "+threshold.value].filter(Boolean).join(", ");
  const entrance = useEntrance<HTMLSpanElement>();
  const glyph = tone === "ok" ? "check" : tone === "bad" ? "x" : tone === "warn" ? "minus" : undefined;
  const track = <div {...props} className={["k-meter","k-"+(tone === "data" ? "series1" : tone),"kc-meter",className].filter(Boolean).join(" ")} data-size={size}
    role={progress || indeterminate ? "progressbar" : "meter"} aria-label={label ?? props["aria-label"] ?? reading} aria-valuemin={0} aria-valuemax={limit}
    aria-valuenow={indeterminate ? undefined : now} aria-valuetext={props["aria-valuetext"] ?? reading}>
    <span ref={entrance} className="kc-fill" style={{transform: `scaleX(${indeterminate ? 1 : now/limit})`}}><i data-kc-enter={indeterminate ? "slide" : "grow"} className={indeterminate ? "kc-pending kc-hatch" : undefined}/></span>
    {live && !indeterminate && now > 0 && <span className="kc-live" aria-hidden="true" style={{width: now/limit*100+"%"}}/>}
    {threshold && <i className="kc-tick" style={{left: Math.min(100, Math.max(0,threshold.value/limit*100))+"%"}}/>}
  </div>;
  if (!threshold && valueText === undefined && !glyph) return track;
  return <div className="kc-meter-row">{track}<span>{glyph && <KeatingGlyph name={glyph}/>}{valueText ?? reading.split(", ")[0]}{threshold && <small>{threshold.label} {threshold.value}</small>}</span></div>;
}

export function Progress({done, total, label, live}: {done: number; total: number; label?: string; live?: boolean}) {
  const steps = Number.isFinite(total) ? Math.max(0,Math.floor(total)) : 0;
  const n = Number.isFinite(done) ? Math.max(0,Math.min(steps,Math.floor(done))) : 0;
  const text = n+" of "+steps;
  const ref = useEntrance<HTMLDivElement>();
  if (steps > 12) return <Meter progress live={live} value={n} max={steps} label={label} valueText={text} tone="ink"/>;
  return <div ref={ref} className="kc-meter-row" role="progressbar" aria-label={label ?? text} aria-valuetext={text} aria-valuemin={0} aria-valuemax={steps} aria-valuenow={n}>
    <div className="kc-steps" data-live={live || undefined}>{Array.from({length:steps},(_,i) => <i key={i} data-step={i<n ? "done" : i===n ? "current" : "todo"} data-kc-enter={i<n ? "grow" : undefined}/>)}</div><span>{text}</span></div>;
}
export function Countdown({remaining, total, label}: {remaining: number; total: number; label?: string}) {
  const seconds = Math.max(0,Math.min(total,remaining));
  const ratio = total > 0 ? seconds/total : 0;
  const tone = ratio < .1 ? "bad" : ratio < .25 ? "warn" : "data";
  const text = seconds+" s left"+(tone === "bad" ? " · Critical" : tone === "warn" ? " · Warning" : "");
  return <Meter value={seconds} max={total} label={label} tone={tone} valueText={text}/>;
}
