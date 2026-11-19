import { useRef, useState, type ReactNode } from "react";
import { IconButton } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import "./specialist-lessons.css";

export function DiagramViewport({caption, tools, children, grid = true}: {caption:string; grid?:boolean; tools?:ReactNode; children:ReactNode}) {
  const [zoom,setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  function pan(direction:number) {
    const element = viewport.current;
    if (element) element.scrollLeft += direction * element.clientWidth / 2;
  }
  return <>
    <header className="specialist-toolbar" data-glyph-host><KeatingGlyph name="route" size={16}/><span className="specialist-caption">{caption}</span>
      <IconButton glyph="left" label="Pan left" onClick={() => pan(-1)} />
      <IconButton glyph="right" label="Pan right" onClick={() => pan(1)} />
      <IconButton glyph="minus" label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(zoom-.25)} />
      <output className="specialist-caption">{Math.round(zoom*100)}%</output>
      <IconButton glyph="plus" label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(zoom+.25)} />
      {tools}
    </header>
    <div className={grid ? "specialist-scroll k-grid" : "specialist-scroll"} ref={viewport} role="region" aria-label={caption} tabIndex={0}>
      <div style={{width:"max-content",minWidth:"100%",zoom}}>{children}</div>
    </div>
  </>;
}
