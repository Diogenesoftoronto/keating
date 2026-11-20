import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { AppLink } from "../components/AppLink";
import { CodeLanguageIcon } from "../components/CodeLanguageIcon";
import { KeatingGlyph } from "../design-system/glyphs";
import { SYSTEMS_LESSONS, runSystemsLesson, type SystemsLesson, type SystemsLessonId } from "../keating/systems-lessons";
import "./systems-lab.css";

const subjects: Record<SystemsLessonId, string> = {
  linux: "Linux", kernel: "Kernel", kubernetes: "Kubernetes", nix: "Nix", wasm: "WebAssembly",
};
type RunResult = Awaited<ReturnType<typeof runSystemsLesson>>;

function SubjectIcon({ id, size = 20 }: { id: SystemsLessonId; size?: number }) {
  return <CodeLanguageIcon language={id === "kernel" ? "assembly" : id} size={size} />;
}

export function SystemsLab() {
  const search = useSearch({ from: "/labs/systems" });
  const lesson = SYSTEMS_LESSONS.find(item => item.id === (search.lesson ?? "linux"));
  const [drafts, setDrafts] = useState<Partial<Record<SystemsLessonId, string>>>({});

  return (
    <main className="systems-lab">
      <header className="systems-lab-bar">
        <div><KeatingGlyph name="kmark" size={25} /><span>Keating</span></div>
        <AppLink to="/chat"><KeatingGlyph name="left" size={16} />Back to chat</AppLink>
      </header>
      <div className="systems-lab-sheet">
        <h1>Systems lab</h1>
        <nav aria-label="Systems lessons" className="systems-lab-subjects">
          {SYSTEMS_LESSONS.map(item => (
            <Link key={item.id} to="/labs/systems" search={{ lesson: item.id }}
              aria-current={lesson?.id === item.id ? "page" : undefined}>
              <SubjectIcon id={item.id} /><span>{subjects[item.id]}</span>
            </Link>
          ))}
        </nav>
        {lesson
          ? <LessonWorkbench key={lesson.id} lesson={lesson} source={drafts[lesson.id] ?? lesson.starter}
              onEdit={source => setDrafts(previous => ({ ...previous, [lesson.id]: source }))} />
          : <p role="status">That lesson could not be found. Choose a subject above to open its exercise.</p>}
      </div>
    </main>
  );
}

function LessonWorkbench({ lesson, source, onEdit }: { lesson: SystemsLesson; source: string; onEdit: (source: string) => void }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [trace, setTrace] = useState(false);
  const shellLesson = lesson.id === "linux" || lesson.id === "kernel";
  const active = useRef<AbortController | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const dirty = source !== lesson.starter;
  useEffect(() => () => { active.current?.abort(); }, []);

  function edit(next: string) {
    onEdit(next);
    setResult(null);
    setStopped(false);
  }

  async function run() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setStopped(false);
    setResult(null);
    try {
      const outcome = await runSystemsLesson(lesson.id, source, controller.signal, { trace });
      if (!controller.signal.aborted) setResult(outcome);
    } catch (error) {
      if (!controller.signal.aborted) setResult({
        status: "unavailable", output: error instanceof Error ? error.message : String(error),
        feedback: "The run could not finish. Check the message and try again.",
      });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }

  function stop() {
    active.current?.abort();
    active.current = null;
    setRunning(false);
    setStopped(true);
  }

  const resultLabel = result?.status === "passed" ? "Checks passed" : result?.status === "failed" ? "Check the result"
    : result ? "Run unavailable" : stopped ? "Stopped" : running ? "Running…" : "Output";

  return (
    <div className="systems-lab-spread">
      <section className="systems-lab-brief" aria-labelledby="lab-title">
        <p className="systems-lab-runtime"><KeatingGlyph name="chip" size={16} />{lesson.environment}</p>
        <h2 id="lab-title">{lesson.title}</h2>
        <p className="systems-lab-goal">{lesson.goal}</p>
        <p className="systems-lab-prompt">{lesson.prompt}</p>
        <details className="systems-lab-target"><summary>Expected output</summary><pre>{lesson.expectedOutput}</pre></details>
        {shellLesson && <details className="systems-lab-target"><summary>About this guest</summary>
          <p>Run starts a fresh Alpine Linux guest on this device. Its files last for one run.
            {" "}<a href="https://github.com/pithings/unkernel/tree/0e4b2ec" target="_blank" rel="noreferrer">Unkernel source</a>
          </p>
        </details>}
      </section>

      <div className="systems-lab-bench">
        <section className="systems-lab-file" aria-labelledby="lab-filename">
          <div className="systems-lab-filebar">
            <span id="lab-filename"><CodeLanguageIcon language={lesson.language} />{lesson.filename}</span>
            <button type="button" disabled={!dirty || running} onClick={() => { edit(lesson.starter); editor.current?.focus(); }}>
              <KeatingGlyph name="undo" size={15} />Reset
            </button>
          </div>
          <div className="systems-lab-editor">
            <div className="systems-lab-gutter" aria-hidden="true" ref={gutter}>
              {Array.from({ length: source.split("\n").length }, (_, i) => i + 1).join("\n")}
            </div>
            <textarea ref={editor} aria-label={`Edit ${lesson.filename}`} aria-describedby="lab-run-command"
              value={source} onChange={event => edit(event.target.value)} readOnly={running}
              onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
              spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" maxLength={32768} />
          </div>
          <div className="systems-lab-runbar">
            <code id="lab-run-command">{lesson.command}</code>
            {shellLesson && <label className="systems-lab-trace">
              <input type="checkbox" checked={trace} disabled={running} onChange={event => {
                setTrace(event.target.checked);
                setResult(null);
                setStopped(false);
              }} />Trace commands
            </label>}
            <button type="button" className="systems-lab-run" onClick={running ? stop : run}
              disabled={!running && !source.trim()}><KeatingGlyph name={running ? "stop" : "play"} size={16} />{running ? "Stop" : "Run"}</button>
          </div>
        </section>
        <section className="systems-lab-result" data-status={result?.status} aria-label="Exercise result">
          <div className="systems-lab-result-title" role="status" aria-atomic="true">
            <KeatingGlyph name={result?.status === "passed" ? "check" : result ? "bug" : "terminal"} size={17} />
            {resultLabel}
          </div>
          {result ? <>
            {result.output && <pre tabIndex={0} aria-label="Run output">{result.output}</pre>}
            <p>{result.feedback}</p>
          </> : <p>{running ? "Executing your file…" : stopped ? "You can edit the file and run it again." : "Run the starter file to see what happens."}</p>}
        </section>
      </div>
    </div>
  );
}
