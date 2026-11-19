import type { ReactNode } from "react";
import { KeatingGlyph, type GlyphName } from "../glyphs";
import { Plot, type Datum, useChartTooltip } from "./shared";

type Select = {columns?: number; selected?: string; onSelect?: (label: string) => void; label?: string};
function Grid({columns, children}: {columns: number; children: ReactNode}) {
  return <div className="kc-grid" style={{gridTemplateColumns:`repeat(${Math.max(1,Math.floor(columns))},minmax(0,1fr))`}}>{children}</div>;
}
function Cell({name, detail, bind, className, selected, onSelect, children}: Select & {
  name: string; detail: string; bind: ReturnType<typeof useChartTooltip>["bind"]; className: string; children?: ReactNode;
}) {
  const props = {...bind(detail), className:"kc-cell "+className, "data-selected":selected===name, "data-kc-enter":"fade"};
  return onSelect ? <button type="button" {...props} aria-pressed={selected===name} onClick={() => onSelect(name)}>{children}</button> : <span {...props}>{children}</span>;
}

export function HeatGrid({data,columns=7,label,selected,onSelect}: Select & {data: readonly Datum[]}) {
  const tip = useChartTooltip();
  const max = Math.max(0,...data.map(d => d.value));
  return <Plot rows={data.map(d => [d.label,d.value])} columns={["Cell","Quantity"]} label={label}>
    <Grid columns={columns}>{data.map(d => <Cell key={d.label} name={d.label} detail={d.label+" "+d.value} bind={tip.bind}
      className={"kc-level-"+(max ? Math.ceil(4*d.value/max) : 0)} selected={selected} onSelect={onSelect}/>)}</Grid>
    <div className="kc-ramp">Less{[1,2,3,4].map(n => <i key={n} className={"kc-level-"+n} {...tip.bind(max ? `Above ${max*(n-1)/4} through ${max*n/4}` : "0")}/>)}More</div>{tip.tooltip}</Plot>;
}

type State = "ok" | "warn" | "bad";
const glyphs: Record<State,GlyphName> = {ok:"check", warn:"alert", bad:"x"};
export function StateGrid({data,states,columns=7,label,selected,onSelect}: Select & {data: readonly {label: string; state: State}[]; states: Record<State,string>}) {
  const tip = useChartTooltip();
  return <Plot rows={data.map(d => [d.label,states[d.state]])} columns={["Check","State"]} label={label}>
    <Grid columns={columns}>{data.map(d => <Cell key={d.label} name={d.label} detail={d.label+" "+states[d.state]} bind={tip.bind}
      className={"kc-state-"+d.state} selected={selected} onSelect={onSelect}><KeatingGlyph name={glyphs[d.state]}/></Cell>)}</Grid>
    <div className="kc-legend">{(Object.keys(states) as State[]).map(s => <span key={s}><KeatingGlyph name={glyphs[s]} className={"kc-state-"+s}/>{states[s]} <b>{data.filter(d => d.state === s).length}</b></span>)}</div>{tip.tooltip}</Plot>;
}
