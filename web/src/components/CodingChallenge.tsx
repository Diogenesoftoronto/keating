import { useEffect, useId, useRef, useState } from "react";
import { Check, Code2, Play, RotateCcw, Square, X } from "lucide-react";
import type { UiCodingChallengeNode } from "@keating/learner-contracts";
import { MarkdownBlock } from "./MarkdownBlock";
import { runCodingChallenge, type CodingRunResult } from "./labs/coding-runner";
import "./labs/learning-labs.css";

const valueText = (value: unknown) => JSON.stringify(value) ?? "undefined";

export function CodingChallenge({ node, disabled = false }: { node: UiCodingChallengeNode; disabled?: boolean }) {
	return <CodingExercise key={JSON.stringify([node.id, node.starterCode, node.tests, node.language, node.entrypoint])} node={node} disabled={disabled} />;
}

function CodingExercise({ node, disabled }: { node: UiCodingChallengeNode; disabled: boolean }) {
	const id = useId();
	const [code, setCode] = useState(node.starterCode);
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<CodingRunResult | null>(null);
	const [error, setError] = useState("");
	const [checkedCode, setCheckedCode] = useState("");
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	useEffect(() => { if (disabled) controller.current?.abort(); }, [disabled]);
	const run = async () => {
		if (running || disabled) return;
		const abort = new AbortController();
		controller.current = abort;
		setRunning(true);
		setError("");
		setResult(null);
		setCheckedCode(code);
		try { setResult(await runCodingChallenge(node, code, abort.signal)); }
		catch (error) { setError(error instanceof DOMException && error.name === "AbortError" ? "Run stopped." : error instanceof Error ? error.message : "The tests could not run."); }
		finally { if (controller.current === abort) { controller.current = null; setRunning(false); } }
	};
	const passed = result?.cases.filter((item) => item.passed).length ?? 0;
	const stale = result !== null && checkedCode !== code;
	return <section className="learning-lab coding-challenge" data-coding-challenge={node.id} aria-labelledby={`${id}-title`}>
		<header className="learning-lab__header"><h4 id={`${id}-title`}><Code2 size={18} aria-hidden="true" />{node.title}</h4><span className="learning-lab__language">{node.language === "typescript" ? "TypeScript" : "JavaScript"}</span></header>
		<div className="learning-lab__brief"><MarkdownBlock content={node.prompt} /></div>
		<div className="coding-challenge__editor">
			<div className="coding-challenge__file"><span>{node.language === "typescript" ? "solution.ts" : "solution.js"}</span><span>{node.tests.length} sample tests</span></div>
			<label className="learning-lab__sr-only" htmlFor={`${id}-code`}>Your {node.language === "typescript" ? "TypeScript" : "JavaScript"} solution</label>
			<textarea id={`${id}-code`} value={code} onChange={(event) => setCode(event.currentTarget.value)} disabled={disabled || running} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void run(); } }} />
		</div>
		<div className="learning-lab__toolbar">
			<button className="learning-lab__primary" type="button" disabled={disabled || (!running && !code.trim())} onClick={() => running ? controller.current?.abort() : void run()}>{running ? <Square size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{running ? "Stop run" : "Run tests"}</button>
			<button className="learning-lab__quiet" type="button" disabled={disabled || running || code === node.starterCode} onClick={() => { setCode(node.starterCode); setResult(null); setError(""); }}><RotateCcw size={14} aria-hidden="true" />Reset code</button>
		</div>
		<div className="coding-challenge__status" role="status" aria-live="polite">{running ? "Testing your solution…" : error || (result ? stale ? "Code changed. Run tests again." : `${passed} / ${node.tests.length} sample tests passed` : "Write your solution, then run the sample tests.")}</div>
		<ul className="coding-challenge__cases">{node.tests.map((item, index) => {
			const outcome = !stale ? result?.cases[index] : undefined;
			return <li key={item.id} data-test-result={outcome ? outcome.passed ? "passed" : "failed" : "pending"}><details>
				<summary><span className="coding-challenge__case-icon">{outcome ? outcome.passed ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" /> : index + 1}</span><span>{item.label}</span><span className="coding-challenge__case-state">{outcome ? outcome.passed ? "Passed" : "Try again" : "Sample"}</span></summary>
				<dl><div><dt>Input</dt><dd><code>{item.args.map(valueText).join(", ")}</code></dd></div><div><dt>Expected</dt><dd><code>{valueText(item.expected)}</code></dd></div>{outcome && !outcome.passed ? <div><dt>{outcome.error ? "Error" : "Your result"}</dt><dd><code>{outcome.error ?? valueText(outcome.actual)}</code></dd></div> : null}</dl>
			</details></li>;
		})}</ul>
		{node.hint ? <details className="learning-lab__hint"><summary>Need a hint?</summary><MarkdownBlock content={node.hint} /></details> : null}
	</section>;
}
