import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { animate } from "motion";
import { DURATION, EASE, motionAllowed, useMotionAllowed } from "../motion";
import "./charts.css";

export type Cell = string | number;
/** A status or structural colour for one datum, instead of its series colour. `rest` is the unfilled remainder. */
export type Tone = "ok" | "warn" | "bad" | "ink" | "rest";
export type Datum = { label: string; value: number; tone?: Tone };
const TONES: Record<Tone, string> = { ok: "var(--accent-green)", warn: "var(--amber)", bad: "var(--destructive)", ink: "var(--ink)", rest: "var(--paper-deep)" };
export type Rows = readonly (readonly Cell[])[];
export const reading = (rows: Rows) => rows.map(row => row.join(" ")).join(", ") || "No data";
export function seriesColor(index: number, tone?: Tone) { return tone ? TONES[tone] : `var(--series-${index + 1})`; }
export function markClass(datum: { pattern?: boolean; tone?: Tone }) { return [datum.pattern && "kc-hatch", datum.tone === "rest" && "kc-rest"].filter(Boolean).join(" ") || undefined; }
export function limitSeries(items: readonly unknown[]) {
  if (items.length > 3) throw new RangeError("Choose up to three series or combine categories into Other.");
}

export function useEntrance<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const allowed = useMotionAllowed();
  const visited = useRef(false);
  useEffect(() => {
    if (!ref.current || visited.current) return;
    if (!motionAllowed()) { visited.current = true; return; }
    if (!allowed) return;
    visited.current = true;
    const controls = Array.from(ref.current.querySelectorAll<HTMLElement>("[data-kc-enter]"), (mark, index) => {
      const kind = mark.dataset.kcEnter;
      const frames = kind === "grow" ? { scaleX: [0, 1] } : kind === "draw" ? { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] } : kind === "slide" ? { x: ["0%", "230%", "0%"] } : { opacity: [0, 1] };
      return animate(mark, frames, { duration: DURATION.play, ease: EASE, delay: kind === "point" ? Math.min(index * .012, .15) : 0 });
    });
    return () => controls.forEach(control => control.cancel());
  }, [allowed]);
  return ref;
}

type Tip = { text: string; x: number; y: number; above: boolean; id: string };
export function ChartTooltip({ text, x, y, above, id }: Tip) {
  return <div id={id} role="tooltip" className="kc-tooltip" style={{ left: x, top: y, transform: above ? "translateY(-100%)" : undefined }}>{text}</div>;
}

export function useChartTooltip() {
  const id = useId();
  type Anchor = {element: Element; text: string};
  const [hover, setHover] = useState<Anchor | null>(null);
  const [focus, setFocus] = useState<Anchor | null>(null);
  const active = hover ?? focus;
  const [tip,setTip] = useState<Tip | null>(null);
  useEffect(() => {
    if (!active) { setTip(null); return; }
    const reposition = () => {
      const rect = active.element.getBoundingClientRect();
      const above = rect.top > window.innerHeight / 2;
      const width = Math.min(window.innerWidth - 16, 12.5 * parseFloat(getComputedStyle(document.documentElement).fontSize));
      setTip({id,text:active.text,above,x:Math.max(8,Math.min(rect.left,window.innerWidth-width-8)),y:above ? rect.top-4 : rect.bottom+4});
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setHover(null); setFocus(null); }
    };
    reposition();
    document.addEventListener("keydown",key);
    window.addEventListener("scroll",reposition,true);
    window.addEventListener("resize",reposition);
    return () => {
      document.removeEventListener("keydown",key);
      window.removeEventListener("scroll",reposition,true);
      window.removeEventListener("resize",reposition);
    };
  }, [active,id]);
  function bind(text: string) {
    const position = (event: SyntheticEvent<Element>) => ({element:event.currentTarget,text});
    return { tabIndex: 0, "aria-label": text, "aria-describedby": tip?.text === text ? id : undefined,
      onFocus: (e: SyntheticEvent<Element>) => { setHover(null); setFocus(position(e)); },
      onBlur: () => setFocus(null), onMouseEnter: (e: SyntheticEvent<Element>) => setHover(position(e)), onMouseLeave: () => setHover(null) };
  }
  return { bind, active: active?.text, tooltip: tip && active?.text === tip.text ? createPortal(<ChartTooltip {...tip}/>,active.element.ownerDocument.body) : null };
}

export function ChartTable({ columns, rows, caption }: { columns: readonly string[]; rows: Rows; caption?: string }) {
  return <details className="kc-table"><summary>View as table</summary><table><caption>{caption ?? reading(rows)}</caption>
    <thead><tr>{columns.map((c,i) => <th scope="col" key={i}>{c}</th>)}</tr></thead>
    <tbody>{rows.map((row,i) => <tr key={i}>{row.map((v,j) => j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j}>{v}</td>)}</tr>)}</tbody></table></details>;
}

export function Plot({label, rows, columns, children, count = rows.length}: {label?: string; rows: Rows; columns: string[]; children: ReactNode; count?: number}) {
  const ref = useEntrance<HTMLDivElement>();
  const name = label ?? reading(rows);
  return <div ref={ref} role="group" className="kc-plot" aria-label={name}>{rows.length ? children : "No data"}
    {count > 3 && <ChartTable columns={columns} rows={rows} caption={name}/>}</div>;
}
export function Label({ text }: {text: string}) { return <span className="kc-label" title={text}>{text}</span>; }

export type Entry = {label: string; value: Cell; pattern?: boolean; tone?: Tone};
export function Legend({entries, label, selected, onSelect}: {entries: readonly Entry[]; label?: string; selected?: string; onSelect?: (label: string) => void}) {
  limitSeries(entries);
  return <div className="kc-legend" role="group" aria-label={label ?? reading(entries.map(e => [e.label,e.value]))}>{entries.map((e,i) => {
    const content = <><i className={markClass(e)} style={{backgroundColor:seriesColor(i, e.tone)}}/><Label text={e.label}/><b>{e.value}</b></>;
    return onSelect ? <button key={e.label} type="button" aria-pressed={selected === e.label} onClick={() => onSelect(e.label)}>{content}</button> : <span key={e.label}>{content}</span>;
  })}</div>;
}

export function ChartFrame({ title, scope, reading: summary, children, label }: { title: string; scope?: string; reading: string; children: ReactNode; label?: string }) {
  return <figure className="kc-frame" aria-label={label ?? [title,scope,summary].filter(Boolean).join(", ")}><figcaption><strong>{title}</strong>{scope && <small>{scope}</small>}<p>{summary}</p></figcaption>{children}</figure>;
}
export function Stat({label, value, support}: {label: string; value: Cell; support?: string}) {
  return <div className="kc-stat" role="group" aria-label={[label,value,support].filter(v => v !== undefined).join(" ")}><Label text={label}/><b>{value}</b>{support && <small>{support}</small>}</div>;
}
export const percent = (value: number, min: number, max: number) => max > min ? Math.min(100,Math.max(0,100*(value-min)/(max-min))) : 50;
export const interval = (low: number, high: number, min: number, max: number): CSSProperties => {
  const start = percent(low,min,max);
  return {left: start+"%", width: Math.max(0,percent(high,min,max)-start)+"%"};
};
