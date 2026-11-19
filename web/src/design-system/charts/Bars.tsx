import { Label, Legend, Plot, interval, limitSeries, markClass, percent, seriesColor, useChartTooltip, type Datum } from "./shared";

export function BarList({data, label, preserveOrder, onSelect}: {data: readonly Datum[]; label?: string; preserveOrder?: boolean; onSelect?: (label: string) => void}) {
  const ordered = preserveOrder ? data : [...data].sort((a,b) => b.value-a.value);
  const max = Math.max(0,...data.map(d => d.value));
  const tip = useChartTooltip();
  return <Plot rows={ordered.map(d => [d.label,d.value])} columns={["Category","Value"]} label={label}>
    {ordered.map(d => {
      const content = <><Label text={d.label}/><span className="kc-track"><i data-kc-enter="grow" style={{width:(max ? 100*d.value/max : 0)+"%"}}/></span><b>{d.value}</b></>;
      const props = tip.bind(d.label+" "+d.value);
      return onSelect ? <button className="kc-row" key={d.label} type="button" {...props} onClick={() => onSelect(d.label)}>{content}</button> : <div className="kc-row" key={d.label} {...props}>{content}</div>;
    })}{tip.tooltip}</Plot>;
}

export function StackBar({data,label,size="md",selected,onSelect}: {data: readonly (Datum & {pattern?: boolean})[]; label?: string; size?: "md"|"lg"; selected?: string; onSelect?: (label: string) => void}) {
  limitSeries(data);
  const tip = useChartTooltip();
  return <Plot rows={data.map(d => [d.label,d.value])} columns={["Category","Count"]} label={label}>
    <div className="kc-stack" data-size={size}>{data.map((d,i) => {
      if (d.value <= 0) return null;
      const props = {...tip.bind(d.label+" "+d.value), className:markClass(d), style:{flex:d.value,backgroundColor:seriesColor(i, d.tone)}};
      return onSelect ? <button key={d.label} type="button" data-kc-enter="grow" {...props} aria-pressed={selected === d.label} onClick={() => onSelect(d.label)}/> : <i key={d.label} data-kc-enter="grow" {...props}/>;
    })}</div><Legend entries={data} selected={selected} onSelect={onSelect}/>{tip.tooltip}</Plot>;
}

type Range = readonly [number, number];
export function IntervalPlot({data, label, domain=[0,100], band}: {data: readonly (Datum & {range?: Range})[]; label?: string; domain?: Range; band?: Range}) {
  const tip = useChartTooltip();
  const rows = data.map(d => [d.label,d.value,...(d.range ?? ["Too few signals","—"])]);
  const bandLabel = band && "Leader range "+band.join(" to ");
  const descriptions = data.map(d => d.label+" "+d.value+", "+(d.range ? "range "+d.range.join(" to ") : "Too few signals"));
  const name = [...descriptions, bandLabel].filter(Boolean).join(", ") || "No data";
  if (band && data.length) rows.push(["Leader range","—",...band]);
  return <Plot rows={rows} columns={["Model","Outcome","Low","High"]} label={label ?? name} count={data.length+data.filter(d=>d.range).length*2+(band ? 2 : 0)}>
    <div className="kc-row"><span/><div className="kc-axis-labels">{[domain[0],(domain[0]+domain[1])/2,domain[1]].map((v,i)=><span key={i}>{v}</span>)}</div><span/></div>
    {data.map(d => <div key={d.label} className="kc-row" {...tip.bind([d.label,d.value,d.range?.join(" to ") ?? "Too few signals"].join(", "))}><Label text={d.label}/>
      <div className="kc-axis">{band && <i className="kc-band" style={interval(...band,...domain)}/>}
        {d.range && <i className="kc-range" data-kc-enter="grow" style={interval(...d.range,...domain)}/>}
        <i className="kc-point" data-sparse={!d.range} data-kc-enter="point" style={{left:percent(d.value,...domain)+"%"}}/></div><b>{d.value}{!d.range && " *"}</b></div>)}
    {bandLabel && <small>{bandLabel}</small>}{data.some(d => !d.range) && <small>* Too few signals for a range</small>}{tip.tooltip}</Plot>;
}

type Lane = {label: string; bands: readonly {label: string; start: number; end: number; waiting?: boolean}[]};
export function Timeline({lanes, label, domain}: {lanes: readonly Lane[]; label?: string; domain?: Range}) {
  const tip = useChartTooltip();
  const bands = lanes.flatMap(l => l.bands);
  const min = domain?.[0] ?? Math.min(...bands.map(b => b.start));
  const max = domain?.[1] ?? Math.max(...bands.map(b => b.end));
  const rows = lanes.flatMap(l => l.bands.map(b => [l.label,b.label,b.start,b.end,b.waiting ? "Waiting" : "Active"]));
  return <Plot label={label} rows={rows} columns={["Lane","Phase","Start","End","State"]} count={rows.length*2}>
    <div className="kc-lane"><span/><div className="kc-axis-labels"><span>{min}</span><span>{max}</span></div></div>
    {lanes.map(l => <div className="kc-lane" key={l.label}><Label text={l.label}/><div className="kc-track">{l.bands.map((b,i) =>
      <i key={i} data-kc-enter="grow" className={b.waiting ? "kc-hatch" : undefined} style={interval(b.start,b.end,min,max)} {...tip.bind([l.label,b.label,b.start+" to "+b.end,b.waiting ? "Waiting" : "Active"].join(", "))}/>)}</div></div>)}{tip.tooltip}</Plot>;
}
