import { Timeline, useChartTooltip } from "../../design-system/charts";
import { Select } from "../Select";
import type { TrajectoryAnnotation } from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { IconButton } from "../../design-system/kit";
import type { TrajectorySessionMessage } from "./types";
import "./review.css";

export interface TurnRailProps {
	messages: TrajectorySessionMessage[];
	annotations: TrajectoryAnnotation[];
	activeMessageId?: string;
	onSelect: (messageId: string) => void;
	selectionIndicator?: "edge" | "surface";
	collapsed?: boolean;
	onToggle?: () => void;
	className?: string;
}

export function TurnRail({
	messages,
	annotations,
	activeMessageId,
	onSelect,
	selectionIndicator = "edge",
	collapsed = false,
	onToggle,
	className,
}: TurnRailProps) {
	const tip = useChartTooltip();
	const marks = new Map<string, TrajectoryAnnotation["kind"][]>();
	for (const { target, kind } of annotations) {
		if (target.kind !== "message" && target.kind !== "message-span") continue;
		const kinds = marks.get(target.messageId) ?? [];
		kinds.push(kind);
		marks.set(target.messageId, kinds);
	}
	return (
		<nav
			aria-label="Session turns"
			className={cx("rv-outline", className)}
			data-collapsed={collapsed}
			data-indicator={selectionIndicator}
		>
			<header className="k-halftone">
				<strong>Turns</strong>
				<small>{messages.length}</small>
				{onToggle && (
					<IconButton
						size="sm"
						glyph="panel"
						label={collapsed ? "Expand turn list" : "Collapse turn list"}
						aria-expanded={!collapsed}
						onClick={onToggle}
					/>
				)}
			</header>
			<ol>
				{messages.map((message, index) => {
					const role = message.role === "assistant" ? "Keating" : message.role === "user" ? "Learner" : message.role;
					const notes = marks.get(message.id) ?? [];
					const kinds = [...new Set(notes)];
					const label = ["Turn " + (index + 1), role, message.text.slice(0, 72), ...kinds.map(kind => kind + " " + notes.filter(note => note === kind).length)].join(" · ");
					return (
						<li key={message.id}>
							<button
								type="button"
								{...tip.bind(label)}
								aria-current={activeMessageId === message.id || undefined}
								onClick={() => onSelect(message.id)}
							>
								<span className="rv-ordinal">{index + 1}</span>
								<span className="rv-role" data-role={message.role}>
									{role.charAt(0).toUpperCase()}
								</span>
								<span className="rv-excerpt">{message.text || "Empty turn"}</span>
								<span className="rv-marks">
									{kinds.map((kind) => (
										<i key={kind + notes.filter(k => k === kind).length} className="rv-kind" data-kind={kind} />
									))}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
			{tip.tooltip}
			{!collapsed && messages.length > 0 && <details className="rv-outline-timeline">
				<summary>Turn timeline</summary>
				<Timeline label="Speakers and notes in transcript order" domain={[1, messages.length + 1]}
					lanes={messages.map((message, index) => {
						const role = message.role === "assistant" ? "Keating" : message.role === "user" ? "Learner" : message.role;
						const kinds = marks.get(message.id) ?? [];
						return { label: `Turn ${index + 1} · ${role}`, bands: [{
							label: kinds.length ? kinds.join(", ") : "No notes", start: index + 1, end: index + 2,
						}] };
					})}/>
			</details>}
			<footer>
				{(["problem", "strength", "suggestion"] as const).map((kind) => (
					<span key={kind}>
						<i className="rv-kind" data-kind={kind} />
						{kind}
					</span>
				))}
			</footer>
		</nav>
	);
}

export interface TurnPickerProps {
	messages: TrajectorySessionMessage[];
	activeMessageId?: string;
	onSelect: (messageId: string) => void;
	className?: string;
}

export function TurnPicker({ messages, activeMessageId, onSelect, className }: TurnPickerProps) {
	return (
		<label className={cx(css({ display: "flex", minWidth: 0, alignItems: "center", gap: "0.5rem" }), className)}>
			<span
				className={css({ flex: "0 0 auto", fontSize: "0.6875rem", fontWeight: 700, color: "var(--muted-foreground)" })}
			>
				Turn
			</span>
			<Select
				value={activeMessageId ?? ""}
				aria-label="Active session turn"
				className={css({
					minWidth: 0,
					width: "100%",
					height: "2rem",
					borderRadius: "0.375rem",
					border: "1px solid var(--border)",
					background: "var(--background)",
					paddingInline: "0.5rem",
					fontSize: "0.75rem",
					color: "var(--foreground)",
					_focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "1px" },
				})}
				onValueChange={(value) => onSelect(value)}
			>
				{messages.map((message, index) => (
					<option key={message.id} value={message.id}>
						{index + 1}. {message.label ?? message.role}
					</option>
				))}
			</Select>
		</label>
	);
}
