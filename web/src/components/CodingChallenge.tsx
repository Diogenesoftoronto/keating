import { IconButton, Loading } from "../design-system/kit";
import { LessonFrame } from "./lesson/LessonFrame";
import "./specialist-lessons.css";
import { useEffect, useId, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import type { UiCodingChallengeNode } from "@keating/learner-contracts";
import { MarkdownBlock } from "./MarkdownBlock";
import { runCodingChallenge, type CodingRunResult } from "./labs/coding-runner";
import type { SharedUiActionEvent } from "../keating/openui/shared-renderer";
import { formatCodingTime } from "./labs/coding-timing";
import { useCodingTimer } from "./labs/use-coding-timer";
import { formatQuizDuration } from "./quiz/game";
import "./labs/learning-labs.css";

type CodingChallengeProps = { node: UiCodingChallengeNode; disabled?: boolean; onAction?: (event: SharedUiActionEvent) => boolean };

const valueText = (value: unknown) => JSON.stringify(value) ?? "undefined";

export function CodingChallenge({ node, disabled = false, onAction }: CodingChallengeProps) {
	return <CodingExercise key={JSON.stringify([node.id, node.starterCode, node.tests, node.language, node.entrypoint])} node={node} disabled={disabled} onAction={onAction} />;
}

function CodingExercise({ node, disabled, onAction }: CodingChallengeProps) {
	const id = useId();
	const [code, setCode] = useState(node.starterCode);
	const [running, setRunning] = useState(false);
	const timer = useCodingTimer(Boolean(disabled), running);
	const [result, setResult] = useState<CodingRunResult | null>(null);
	const [error, setError] = useState("");
	const [checkedCode, setCheckedCode] = useState("");
	const [pendingAction, setPendingAction] = useState<SharedUiActionEvent | null>(null);
	const deliver = (event: SharedUiActionEvent) => {
		try { setPendingAction(onAction?.(event) === true ? null : event); }
		catch { setPendingAction(event); }
	};
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	useEffect(() => { if (disabled) controller.current?.abort(); }, [disabled]);
	const run = async () => {
		if (running || disabled) return;
		timer.engage();
		timer.beginRun();
		const abort = new AbortController();
		controller.current = abort;
		setRunning(true);
		setError("");
		setResult(null);
		setCheckedCode(code);
		setPendingAction(null);
		try {
			const outcome = await runCodingChallenge(node, code, abort.signal);
			if (abort.signal.aborted) return;
			setResult(outcome);
			const timing = timer.finishRun(outcome.cases.every(item => item.passed));
			if (onAction) deliver({
				intent: { type: "run-coding-challenge", nodeId: node.id, runId: crypto.randomUUID(), code,
					cases: outcome.cases.map(item => ({ testId: item.id, passed: item.passed,
						...(item.actual !== undefined ? { actual: valueText(item.actual).slice(0, 4096) } : {}), ...(item.error ? { error: item.error } : {}) })),
					durationMs: outcome.durationMs, timing },
				humanFriendlyMessage: `Ran ${node.title}: ${outcome.cases.filter(item => item.passed).length}/${node.tests.length} sample tests passed. ${formatQuizDuration(timing.workingMs)} work time, attempt ${timing.runNumber}.`,
			});
		}
		catch (error) { setError(error instanceof DOMException && error.name === "AbortError" ? "Run stopped." : error instanceof Error ? error.message : "The tests could not run."); }
		finally { if (controller.current === abort) { controller.current = null; setRunning(false); } }
	};
	const passed = result?.cases.filter((item) => item.passed).length ?? 0;
	const stale = result !== null && checkedCode !== code;
	const language = node.language === "typescript" ? "TypeScript" : "JavaScript";
	const statusTone = error ? "bad" : result ? stale ? "warn" : passed === node.tests.length ? "ok" : "bad" : undefined;
	return <LessonFrame glyph="code" title={node.title} kind="Coding challenge" footer={<>
			<button className="lesson-quiet" type="button" disabled={disabled || running || code === node.starterCode} onClick={() => { setCode(node.starterCode); setResult(null); setError(""); }}><KeatingGlyph name="undo" size={13} />Reset code</button>
			<button className="lesson-primary k-lift" data-glyph-surface="inverse" type="button" disabled={disabled || (!running && !code.trim())} onClick={() => running ? controller.current?.abort() : void run()}>{running ? <KeatingGlyph name="stop" size={13} /> : <KeatingGlyph name="play" size={13} />}{running ? "Stop run" : "Run tests"}</button>
		</>} tools={<span className="coding-challenge__timer">
			<KeatingGlyph name="clock" size={13} />
			<span className="lesson-sr">Work time</span>
			<span className="coding-challenge__timer-digits" role="timer" aria-live="off" aria-label={`Work time: ${formatQuizDuration(timer.workingMs)}`} aria-describedby={`${id}-timing`}>{formatCodingTime(timer.workingMs)}</span>
			<span className="coding-challenge__timer-state">{timer.completed ? "Complete" : !timer.started ? "Ready" : timer.paused ? "Paused" : "Counting"}</span>
			<IconButton size="sm" glyph={timer.paused ? "play" : "pause"} label={timer.paused ? "Resume work timer" : "Pause work timer"} disabled={disabled || running || !timer.started || timer.completed} onClick={timer.togglePause} />
			<span id={`${id}-timing`} className="lesson-sr">Starts when you use the editor. Pauses while this tab is hidden or tests run. Stops when all sample tests pass. Time is shared with your test results.</span>
		</span>} className="learning-lab coding-challenge" data-coding-challenge={node.id} aria-label={node.title}>
		<div className="learning-lab__brief"><MarkdownBlock content={node.prompt} /></div>
		<div className="coding-challenge__editor">
			<div className="coding-challenge__file"><label htmlFor={`${id}-code`}>{node.language === "typescript" ? "solution.ts" : "solution.js"}</label><span>{language}</span></div>
			<textarea maxLength={32768} id={`${id}-code`} aria-label={`Your ${language} solution`} value={code} onFocus={timer.engage} onChange={(event) => { timer.engage(); setCode(event.currentTarget.value); }} disabled={disabled || running} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void run(); } }} />
		</div>

		{pendingAction ? <div role="status" className="lesson-status coding-challenge__retry" data-tone="warn">Your test results have not been sent to the tutor. <button type="button" className="lesson-quiet" disabled={disabled || running} onClick={() => deliver(pendingAction)}><KeatingGlyph name="refresh" size={13} />Send results again</button></div> : null}
		<section className="lesson-section coding-challenge__results">
			<h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="checklist" size={13} />Sample tests<span className="lesson-meta">{result && !stale ? `${passed}/${node.tests.length}` : node.tests.length}</span></h4>
			{running ? <Loading size="inline" label="Testing your solution…" aria-live="polite" /> : <div className="lesson-status coding-challenge__status" data-tone={statusTone} role="status" aria-live="polite">{error || (result ? stale ? "Code changed. Run tests again." : `${passed} / ${node.tests.length} sample tests passed` : "Write your solution, then run the sample tests.")}</div>}
			{result && !stale && <span className="lesson-progress" role="progressbar" aria-label="Sample tests passed" aria-valuemin={0} aria-valuemax={node.tests.length} aria-valuenow={passed}><i style={{ width: `${node.tests.length ? passed / node.tests.length * 100 : 0}%` }} /></span>}
			<ul className="lesson-rows coding-challenge__cases">{node.tests.map((item, index) => {
				const outcome = !stale ? result?.cases[index] : undefined;
				return <li key={item.id} data-test-result={outcome ? outcome.passed ? "passed" : "failed" : "pending"}><details>
					<summary><span className="lesson-index coding-challenge__case-icon">{outcome ? outcome.passed ? <KeatingGlyph name="check" size={13} /> : <KeatingGlyph name="x" size={13} /> : index + 1}</span><span>{item.label}</span><span className="lesson-meta coding-challenge__case-state">{outcome ? outcome.passed ? "Correct" : "Not quite" : "Sample"}</span></summary>
					<dl><div><dt>Input</dt><dd><code>{item.args.map(valueText).join(", ")}</code></dd></div><div><dt>Expected</dt><dd><code>{valueText(item.expected)}</code></dd></div>{outcome && !outcome.passed ? <div><dt>{outcome.error ? "Error" : "Your result"}</dt><dd><code>{outcome.error ?? valueText(outcome.actual)}</code></dd></div> : null}</dl>
				</details></li>;
			})}</ul>
		</section>
		{node.hint ? <details className="learning-lab__hint"><summary><KeatingGlyph name="bulb" size={13} />Need a hint?</summary><MarkdownBlock content={node.hint} /></details> : null}
	</LessonFrame>;
}
