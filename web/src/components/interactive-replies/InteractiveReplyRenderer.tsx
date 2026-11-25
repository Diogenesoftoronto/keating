import { Component, Suspense, lazy, useState, type ComponentType, type ErrorInfo, type LazyExoticComponent, type ReactNode } from "react";
import {
	INTERACTIVE_LIMITS,
	INTERACTIVE_TITLES,
	type InteractiveKind,
	type UiActionReceipt,
	type UiInteractiveNode,
	type UiInteractiveShare,
} from "@keating/learner-contracts";
import { MarkdownBlock } from "../MarkdownBlock";
import type { SharedUiActionEvent } from "../../keating/openui/shared-renderer";
import { interactiveConfigProblems, loadInteractiveReply, type InteractiveReplySummary } from "./registry";
import "./reply.css";

export interface InteractiveReplyRendererProps {
	node: UiInteractiveNode;
	/** The latest completed share for this node, if any. */
	receipt?: UiActionReceipt;
	disabled?: boolean;
	onAction?: (event: SharedUiActionEvent) => boolean;
}

interface ViewProps {
	config: unknown;
	onChange: () => void;
	onShare?: (summary: InteractiveReplySummary) => void;
}

const views = new Map<InteractiveKind, LazyExoticComponent<ComponentType<ViewProps>>>();

/** One lazy view per kind: loads the module, runs its validator, and shows the fallback line on a misfit. */
function viewFor(kind: InteractiveKind): LazyExoticComponent<ComponentType<ViewProps>> {
	let view = views.get(kind);
	if (!view) {
		view = lazy(async () => {
			const module = await loadInteractiveReply(kind);
			function CheckedView({ config, onChange, onShare }: ViewProps) {
				const problems = interactiveConfigProblems(module, config);
				if (problems.length) return <InteractiveReplyFallback kind={kind} problems={problems} />;
				return <module.Component config={config} onChange={onChange} onShare={onShare} />;
			}
			return { default: CheckedView };
		});
		views.set(kind, view);
	}
	return view;
}

function clip(value: string, maximum: number): string {
	const text = value.trim();
	return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

/** The learner's share, bounded to the contract's limits. */
export function interactiveShare(summary: InteractiveReplySummary): UiInteractiveShare {
	return {
		learner: clip(summary.learner, INTERACTIVE_LIMITS.shareLearner) || "I shared my result.",
		data: clip(summary.data, INTERACTIVE_LIMITS.shareData) || "No data recorded.",
		analysis: clip(summary.reply, INTERACTIVE_LIMITS.shareAnalysis),
	};
}

export function interactiveShareEvent(node: UiInteractiveNode, summary: InteractiveReplySummary): SharedUiActionEvent {
	const share = interactiveShare(summary);
	return { intent: { type: "share-interactive", nodeId: node.id, kind: node.kind, share }, humanFriendlyMessage: share.learner };
}

export function InteractiveReplyFallback({ kind, problems }: { kind: InteractiveKind; problems?: string[] }) {
	return <p className="interactive-reply__fallback" role="note" data-interactive-fallback={kind} title={problems?.slice(0, 3).join("\n")}>
		This {INTERACTIVE_TITLES[kind].toLowerCase()} could not be shown here.
	</p>;
}

class ReplyBoundary extends Component<{ kind: InteractiveKind; children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch(error: unknown, info: ErrorInfo) {
		if (import.meta.env?.DEV) console.error(`[interactive-reply:${this.props.kind}]`, error, info.componentStack);
	}
	render() { return this.state.failed ? <InteractiveReplyFallback kind={this.props.kind} /> : this.props.children; }
}

/** Reset learner work when the authored config changes, not on parent renders. */
export function InteractiveReplyRenderer(props: InteractiveReplyRendererProps) {
	return <InteractiveReplyFrame key={JSON.stringify([props.node.id, props.node.kind, props.node.config])} {...props} />;
}

function InteractiveReplyFrame({ node, receipt, disabled = false, onAction }: InteractiveReplyRendererProps) {
	const View = viewFor(node.kind);
	const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "failed">("idle");
	const [changed, setChanged] = useState(false);
	const sharedBefore = receipt?.state === "completed" && receipt.action.type === "share-interactive" && receipt.action.nodeId === node.id;
	const canShare = Boolean(onAction) && !disabled;
	const share = canShare && onAction ? (summary: InteractiveReplySummary) => {
		setShareStatus(onAction(interactiveShareEvent(node, summary)) ? "shared" : "failed");
		setChanged(false);
	} : undefined;
	const onChange = () => { setChanged(true); setShareStatus("idle"); };
	const status = shareStatus === "failed" ? { tone: "warn", text: "Not sent yet. Your work is kept here; change something and share again." }
		: shareStatus === "shared" ? { tone: "ok", text: "Shared. Your tutor will look at it." }
		: sharedBefore ? (changed ? { tone: "", text: "Changed since you last shared." } : { tone: "ok", text: "Shared. Your tutor has your result." })
		: null;

	return <div className="interactive-reply" role="group" aria-label={node.title} data-interactive-kind={node.kind} data-interactive-node={node.id}
		data-shared={sharedBefore || shareStatus === "shared" ? "true" : undefined}>
		{node.brief ? <div className="interactive-reply__brief"><MarkdownBlock content={node.brief} /></div> : null}
		<div className="interactive-reply__locked" inert={disabled || undefined}>
			<ReplyBoundary kind={node.kind}>
				<Suspense fallback={<p className="interactive-reply__loading" aria-busy="true">Loading {INTERACTIVE_TITLES[node.kind].toLowerCase()}…</p>}>
					<View config={node.config} onChange={onChange} onShare={share} />
				</Suspense>
			</ReplyBoundary>
		</div>
		{status ? <p role="status" className="interactive-reply__status" data-tone={status.tone || undefined}>{status.text}</p> : null}
	</div>;
}
