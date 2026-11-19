import { Label, Legend, Plot, limitSeries, percent, seriesColor, useChartTooltip } from "./shared";

type Sample = {x: number; y: number; label?: string};
type Series = {label: string; points: readonly Sample[]};
export function LineChart({series, label, domain, connect=true, crosshair=false}: {
  series: readonly Series[]; label?: string; domain?: readonly [number,number]; connect?: boolean; crosshair?: boolean;
}) {
  limitSeries(series);
  const tip = useChartTooltip();
  const ordered = series.map(s => ({...s, points:[...s.points].sort((a,b) => a.x-b.x)}));
  const samples = ordered.flatMap(s => s.points);
  const xs = samples.map(p => p.x), ys = samples.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = domain?.[0] ?? Math.min(...ys), yMax = domain?.[1] ?? Math.max(...ys);
  const x = (p: Sample) => percent(p.x,xMin,xMax);
  const y = (p: Sample) => 100-percent(p.y,yMin,yMax);
  const labelled = samples.some(p => p.label !== undefined);
  const columns = labelled ? ["Series","Sample","X","Value"] : ["Series","X","Value"];
  const rows = ordered.flatMap(s => s.points.map(p => labelled ? [s.label,p.label ?? "—",p.x,p.y] : [s.label,p.x,p.y]));
  const entries = ordered.map(s => ({label:s.label,value:s.points.at(-1)?.y ?? "No samples"}));
  const ends = ordered.flatMap((s,i) => {
    const end = s.points.at(-1);
    return end ? [{i, top:y(end), text:s.label+" "+end.y}] : [];
  }).sort((a,b) => a.top-b.top);
  ends.forEach((e,i) => { e.top = Math.max(i ? ends[i-1].top+18 : 0, Math.min(100-18*(ends.length-i-1), e.top)); });
  return <Plot rows={rows} columns={columns} count={samples.length*2} label={label}>
    <div className="kc-line-layout"><div className="kc-line">
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[0,50,100].map(v => <line key={v} x1="0" x2="100" y1={v} y2={v}/>)}
        {connect && ordered.map((s,i) => <polyline key={s.label} data-kc-enter="draw" stroke={seriesColor(i)} points={s.points.map(p => x(p)+","+y(p)).join(" ")}/>)}
      </svg>
      {ordered.map((s,i) => s.points.map((p,j) => {
        const text = [s.label,p.label ?? p.x,p.y].join(", ");
        return <span key={s.label+"-"+j} className="kc-sample" data-end={!connect || j===s.points.length-1} data-kc-enter="point"
          style={{left:x(p)+"%",top:y(p)+"%",backgroundColor:seriesColor(i)}} {...tip.bind(text)}>
          {crosshair && tip.active === text && <i className="kc-cross" style={{top:`calc(-1 * ${y(p)/100} * var(--kc-line-height))`}}/>}</span>;
      }))}</div>
      <div className="kc-ends">{ends.map(e => <span key={e.i} style={{top:e.top+"%"}}><Label text={e.text}/></span>)}</div>
    </div>
    <div className="kc-xlabels"><Label text={String(samples.find(p => p.x === xMin)?.label ?? xMin)}/><Label text={String(samples.find(p => p.x === xMax)?.label ?? xMax)}/></div>
    <Legend entries={entries}/>{tip.tooltip}</Plot>;
}
