import type { ComponentProps, ReactNode } from "react";
import { KeatingGlyph, type GlyphName } from "../../design-system/glyphs";
import { StackBar, Stat } from "../../design-system/charts";
import "./lesson.css";

type FrameProps = Omit<ComponentProps<"section">, "title"> & {
  glyph: GlyphName;
  title?: ReactNode;
  kind: string;
  tools?: ReactNode;
  footer?: ReactNode;
};

export function LessonHeader({glyph,title,kind,tools}: Pick<FrameProps, "glyph" | "title" | "kind" | "tools">) {
  return <header className="lesson-head k-halftone" data-glyph-host><KeatingGlyph name={glyph} size={16}/>
      {title && <strong>{title}</strong>}<small>{kind}</small>
      {tools && <div className="lesson-tools">{tools}</div>}
    </header>;
}

export function LessonFrame({ glyph, title, kind, tools, children, footer, className = "", ...props }: FrameProps) {
  return <section {...props} className={`lesson-frame ${className}`}>
    <LessonHeader glyph={glyph} title={title} kind={kind} tools={tools}/>
    <div className="lesson-body">{children}</div>
    {footer && <footer className="lesson-foot">{footer}</footer>}
  </section>;
}

export function LessonCallout({tone,title,children}: {tone: string; title?: string; children: ReactNode}) {
  const glyph = tone === "success" || tone === "check" ? "check" : tone === "warning" || tone === "danger" ? "alert" : tone === "hint" ? "bulb" : "info";
  return <aside className="lesson-callout" data-glyph-host data-callout-tone={tone}>
    <KeatingGlyph name={glyph} size={16}/><div><span className="lesson-sr">{tone}. </span>{title && <strong>{title}</strong>}{children}</div>
  </aside>;
}

export function LessonScore({score,percent,time,correct,partly,missed}: {score: string; percent?: number; time?: string; correct: number; partly: number; missed: number}) {
  return <div className="lesson-score">
    <div className="lesson-stats"><Stat label="Score" value={score} support={percent === undefined ? undefined : `${percent}%`}/>
      {time && <Stat label="Time" value={time}/>}</div>
    <StackBar label="Graded answers" data={[{label:"Correct",value:correct,tone:"ok"},{label:"Partly",value:partly,tone:"warn",pattern:true},{label:"Not quite",value:missed,tone:"bad"}]}/>
  </div>;
}
