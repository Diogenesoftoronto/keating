import { Label, Legend, Plot, limitSeries, percent, seriesColor, useChartTooltip, type Tone } from "./shared";

type Sample = {x: number; y: number; label?: string};
/** `tone` draws a series in a status/structural colour instead of its series colour; `mark: "ring"` draws its samples as hollow squares (a "now" marker). */
type Series = {label: string; points: readonly Sample[]; tone?: Tone; mark?: "ring"; endLabel?: "value"};
/** A "where you are now" marker: a dashed ink line at `x` with an amber square at `y` and an optional label beside it. */
type Now = {x: number; y: number; label?: string};
/** `format`/`formatX` turn plotted numbers into words for people (end labels, legend, tooltips, table, x ends). Both optional; without them raw numbers show as before. */
export function LineChart({series, label, domain, connect=true, crosshair=false, format, formatX, now}: {
  series: readonly Series[]; label?: string; domain?: readonly [number,number]; connect?: boolean; crosshair?: boolean;
  format?: (y: number) => string; formatX?: (x: number) => string; now?: Now;
}) {
  const fy = (v: number) => format ? format(v) : v;
  const fx = (v: number) => formatX ? formatX(v) : v;
  limitSeries(series);
  const tip = useChartTooltip();
  const ordered = series.map(s => ({...s, points:[...s.points].sort((a,b) => a.x-b.x)}));
  const samples = ordered.flatMap(s => s.points);
  const xs = [...samples.map(p => p.x), ...(now ? [now.x] : [])], ys = [...samples.map(p => p.y), ...(now ? [now.y] : [])];
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = domain?.[0] ?? Math.min(...ys), yMax = domain?.[1] ?? Math.max(...ys);
  const x = (p: Sample) => percent(p.x,xMin,xMax);
  const y = (p: Sample) => 100-percent(p.y,yMin,yMax);
  const labelled = samples.some(p => p.label !== undefined);
  const columns = labelled ? ["Series","Sample","X","Value"] : ["Series","X","Value"];
  const rows = ordered.flatMap(s => s.points.map(p => labelled ? [s.label,p.label ?? "—",fx(p.x),fy(p.y)] : [s.label,fx(p.x),fy(p.y)]));
  const entries = ordered.map(s => { const end = s.points.at(-1); return {label:s.label,tone:s.tone,value:end ? fy(end.y) : "No samples"}; });
  const ends = ordered.flatMap((s,i) => {
    const end = s.points.at(-1);
    return end ? [{i, top:y(end), name:s.label, value:String(fy(end.y)), valueOnly:s.endLabel === "value"}] : [];
  }).sort((a,b) => a.top-b.top);
  ends.forEach((e,i) => { e.top = Math.max(i ? ends[i-1].top+18 : 0, Math.min(100-18*(ends.length-i-1), e.top)); });
  return <Plot rows={rows} columns={columns} count={samples.length*2} label={label}>
    <div className="kc-line-layout"><div className="kc-line">
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[0,50,100].map(v => <line key={v} x1="0" x2="100" y1={v} y2={v}/>)}
        {connect && ordered.map((s,i) => <polyline key={s.label} data-kc-enter="draw" stroke={seriesColor(i, s.tone)} points={s.points.map(p => x(p)+","+y(p)).join(" ")}/>)}
      </svg>
      {ordered.map((s,i) => s.points.map((p,j) => {
        const text = [s.label,p.label ?? fx(p.x),fy(p.y)].join(", ");
        return <span key={s.label+"-"+j} className="kc-sample" data-end={!connect || j===s.points.length-1} data-mark={s.mark} data-kc-enter="point"
          style={{left:x(p)+"%",top:y(p)+"%",...(s.mark === "ring" ? {color:seriesColor(i, s.tone)} : {backgroundColor:seriesColor(i, s.tone)})}} {...tip.bind(text)}>
          {crosshair && tip.active === text && <i className="kc-cross" style={{top:`calc(-1 * ${y(p)/100} * var(--kc-line-height))`}}/>}</span>;
      }))}
      {now && <span className="kc-now" aria-hidden="true" style={{left:x(now)+"%"}}><i style={{top:y(now)+"%"}}/>
        {now.label && <em data-flip={x(now) > 60 || undefined} style={{top:y(now)+"%"}}>{now.label}</em>}</span>}</div>
      <div className="kc-ends">{ends.map(e => <span key={e.i} style={{top:e.top+"%"}} title={e.name+" "+e.value}>{!e.valueOnly && <Label text={e.name}/>}<b>{e.value}</b></span>)}</div>
    </div>
    <div className="kc-xlabels"><Label text={String(samples.find(p => p.x === xMin)?.label ?? fx(xMin))}/><Label text={String(samples.find(p => p.x === xMax)?.label ?? fx(xMax))}/></div>
    <Legend entries={entries}/>{tip.tooltip}</Plot>;
}
