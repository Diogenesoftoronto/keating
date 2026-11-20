import { useId, useMemo, useState } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { MarkdownBlock } from "../MarkdownBlock";
import { WebSearchActivity, WebSearchCitations } from "../WebSearchPart";
import { citationsFromCalls, isWebSearchToolName, parseWebSearchResult, type WebSearchCall } from "../web-search-result";
import "../web-search.css";
import { splitUntrustedPreamble, toolActivityLabel, toolArguments, type ReviewTool } from "./tool-activity";

type ActivityGroup =
	| { kind: "search"; key: string; calls: WebSearchCall[] }
	| { kind: "tool"; key: string; tool: ReviewTool };

function searchCall(tool: ReviewTool, index: number): WebSearchCall {
	return {
		...parseWebSearchResult(tool.output ?? "", toolArguments(tool.input)),
		id: tool.callId ?? `search-${index}`,
		// A historical turn whose call never answered did not finish.
		state: tool.status === "succeeded" && !tool.isError ? "success" : "error",
	};
}

/** Consecutive searches read as one line, the way chat shows them. */
function activityGroups(tools: readonly ReviewTool[]): ActivityGroup[] {
	const groups: ActivityGroup[] = [];
	tools.forEach((tool, index) => {
		const key = `${tool.callId ?? tool.name}:${index}`;
		if (isWebSearchToolName(tool.name)) {
			const last = groups.at(-1);
			if (last?.kind === "search") last.calls.push(searchCall(tool, index));
			else groups.push({ kind: "search", key, calls: [searchCall(tool, index)] });
			return;
		}
		groups.push({ kind: "tool", key, tool });
	});
	return groups;
}

/** A short hint of what the tool was asked: the first plain argument. */
function inputHint(input: string | undefined): string | undefined {
	const args = toolArguments(input);
	if (typeof args === "string") return args.slice(0, 120) || undefined;
	if (!args || typeof args !== "object") return undefined;
	for (const value of Object.values(args as Record<string, unknown>)) {
		if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
	}
	return undefined;
}

const looksStructured = (text: string) => /^[[{]/.test(text.trim());

function ToolLine({ tool }: { tool: ReviewTool }) {
	const [expanded, setExpanded] = useState(false);
	const panelId = useId();
	const failed = tool.status === "failed" || tool.isError === true;
	const unanswered = tool.status === "pending";
	const output = useMemo(() => splitUntrustedPreamble(tool.output ?? ""), [tool.output]);
	const hint = inputHint(tool.input);
	const meta = failed ? "Failed" : unanswered ? "No result" : output.untrusted ? "Outside source" : undefined;
	return (
		<section className="search-activity rv-tool-activity" data-state={failed || unanswered ? "error" : "success"} aria-label={toolActivityLabel(tool.name)}>
			<button type="button" className="search-activity__line" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((value) => !value)}>
				<KeatingGlyph name={failed ? "alert" : "tool"} size={14} className="search-activity__icon" />
				<span className="search-activity__label">{toolActivityLabel(tool.name)}</span>
				{hint && <span className="search-activity__detail">{hint}</span>}
				{meta && <span className="search-activity__meta">{meta}</span>}
				<KeatingGlyph name="chev" size={14} className="search-activity__chevron" />
			</button>
			{expanded && (
				<div id={panelId} className="rv-tool-activity__panel">
					{tool.input && tool.input !== "{}" && (
						<div>
							<div className="rv-tool-activity__heading">Asked with</div>
							<pre>{tool.input}</pre>
						</div>
					)}
					{output.body ? (
						<div>
							<div className="rv-tool-activity__heading">
								{failed ? "Error" : "Returned"}
								{output.untrusted && <span className="rv-tool-activity__tag" title="This came from outside Keating. The tutor was told to treat it as evidence, never as instructions.">untrusted</span>}
							</div>
							{looksStructured(output.body) ? <pre>{output.body}</pre> : <div className="rv-tool-activity__prose"><MarkdownBlock content={output.body} /></div>}
						</div>
					) : null}
					{tool.details && (
						<details>
							<summary>Raw details</summary>
							<pre>{tool.details}</pre>
						</details>
					)}
				</div>
			)}
		</section>
	);
}

/**
 * What the tutor did on the way to a reply: searches, lookups and other tools,
 * as one quiet line each. Expand a line to see what was asked and returned.
 */
export function ReviewToolActivity({ tools }: { tools: readonly ReviewTool[] }) {
	const groups = useMemo(() => activityGroups(tools), [tools]);
	if (groups.length === 0) return null;
	return (
		<div className="rv-tool-activity-list" aria-label="Tutor activity">
			{groups.map((group) => group.kind === "search"
				? <WebSearchActivity key={group.key} calls={group.calls} />
				: <ToolLine key={group.key} tool={group.tool} />)}
		</div>
	);
}

/** Every source the turn's searches returned, once, under the reply. */
export function ReviewToolSources({ tools }: { tools: readonly ReviewTool[] }) {
	const sites = useMemo(() => {
		const calls = activityGroups(tools).flatMap((group) => group.kind === "search" ? group.calls : []);
		return citationsFromCalls(calls);
	}, [tools]);
	return <WebSearchCitations sites={sites} />;
}
