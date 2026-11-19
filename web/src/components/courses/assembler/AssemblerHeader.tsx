import { Eyebrow, IconButton } from "../../../design-system/kit";

export function AssemblerHeader({ onClose }: { onClose(): void }) {
  return <header className="cb-assembly-head k-halftone">
    <div><Eyebrow>New course</Eyebrow><h2 id="course-assembler-title">Assemble the course you want.</h2>
      <p>Start empty, or bring in plans, quizzes, generated UI, visuals, maps, animations, and cards you already made with Keating. Everything stays editable.</p></div>
    <IconButton label="Close course assembler" glyph="x" onClick={onClose}/>
  </header>;
}
