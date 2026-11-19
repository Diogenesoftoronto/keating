import { Meter } from "../design-system/charts";
import "./specialist-lessons.css";

export function PlaybackPosition({label,value,max,seconds=true,disabled,onSeek}: {
  label:string; value:number; max:number; seconds?:boolean; disabled?:boolean; onSeek:(value:number)=>void;
}) {
  const time = (n:number) => Math.floor(n/60) + ":" + String(Math.floor(n%60)).padStart(2,"0");
  const reading = seconds ? time(value)+" / "+time(max) : Math.round(value*100/max)+"%";
  return <div className="specialist-seek">
    <Meter value={value} max={max} label={label} valueText={reading}/>
    <input type="range" aria-label={label} aria-valuetext={reading} min={0} max={max} step="any"
      value={value} disabled={disabled} onChange={event=>onSeek(Number(event.currentTarget.value))}/>
  </div>;
}
