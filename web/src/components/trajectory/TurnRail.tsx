import type { TrajectoryAnnotation } from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { eyebrow, reviewPanel } from "../../../styled-system/recipes";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import type { TrajectorySessionMessage } from "./types";
import { metaTextClass } from "./styles";

export interface TurnRailProps {
	messages: TrajectorySessionMessage[];
	annotations: TrajectoryAnnotation[];
	activeMessageId?: string;
	onSelect: (messageId: string) => void;
	selectionIndicator?: "edge" | "surface";
	className?: string;
}

function annotationMessageId(annotation: TrajectoryAnnotation): string | undefined {
	if (annotation.target.kind === "message" || annotation.target.kind === "message-span") {
		return annotation.target.messageId;
	}
	return undefined;
}

/**
 * The transcript's cast. The tutor gets a chalkboard rather than a robot: the
 * thing under review is a teaching performance, and the rail should read that
 * way at a glance.
 */
function RoleIcon({ role, active }: { role: string; active: boolean }) {
	const icon = role === "assistant"
		? reviewIcon.teacher
		: role === "user"
			? reviewIcon.learner
			: role === "tool"
				? reviewIcon.tool
				: reviewIcon.message;
	return <KeatingIcon icon={icon} size={14} active={active} />;
}

function preview(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized || "Empty turn";
}

export function TurnRail({ messages, annotations, activeMessageId, onSelect, selectionIndicator = "edge", className }: TurnRailProps) {
	const counts = new Map<string, { total: number; problems: number }>();
	for (const annotation of annotations) {
		const messageId = annotationMessageId(annotation);
		if (!messageId) continue;
		const count = counts.get(messageId) ?? { total: 0, problems: 0 };
		count.total += 1;
		if (annotation.kind === "problem") count.problems += 1;
		counts.set(messageId, count);
	}

	return (
		<nav
			aria-label="Session turns"
			className={cx(reviewPanel({ tone: "contents" }), css({ height: "100%" }), className)}
		>
			<div className={css({ borderBottom: "1px solid var(--line)", padding: "0.75rem" })}>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: "var(--mono-display)", fontSize: "0.75rem", fontWeight: 700, color: "var(--ink)" })}>
					<KeatingIcon icon={reviewIcon.contents} size={14} />
					Contents
				</div>
				<div className={cx(metaTextClass, css({ marginTop: "0.125rem" }))}>
					{messages.length} recorded
				</div>
			</div>
			<ol className={css({ minHeight: 0, flex: 1, overflowY: "auto", paddingBlock: "0.25rem" })}>
				{messages.map((message, index) => {
					const count = counts.get(message.id);
					const active = message.id === activeMessageId;
					return (
						<li key={message.id}>
							<button
								type="button"
								aria-current={active ? "true" : undefined}
								className={css({
									display: "grid",
									width: "100%",
									gridTemplateColumns: "1.5rem minmax(0, 1fr) auto",
									alignItems: "start",
									gap: "0.375rem",
									borderLeft: selectionIndicator === "edge" && active ? "3px solid var(--accent-dim)" : "3px solid transparent",
									background: active ? "var(--card)" : "transparent",
									padding: "0.625rem 0.5rem",
									textAlign: "left",
									color: "var(--ink)",
									cursor: "pointer",
									transitionProperty: "background-color, border-color",
									transitionDuration: "{durations.base}",
									_hover: {
										background: "var(--card)",
										borderLeftColor: active ? "var(--accent-dim)" : "var(--line)",
									},
									_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-3px" },
								})}
								onClick={() => onSelect(message.id)}
							>
								<span
									className={css({
										display: "inline-flex",
										width: "1.5rem",
										height: "1.5rem",
										alignItems: "center",
										justifyContent: "center",
										borderRadius: "9999px",
										background: active ? "var(--ink)" : "color-mix(in srgb, var(--ink) 8%, transparent)",
										color: active ? "var(--paper)" : "var(--ink-soft)",
										transitionProperty: "background-color, color",
										transitionDuration: "{durations.base}",
									})}
								>
									<RoleIcon role={message.role} active={active} />
								</span>
								<span className={css({ minWidth: 0 })}>
									<span className={cx(eyebrow(), css({ display: "block", fontSize: "10px" }))}>
										{message.label ?? `${message.role === "assistant" ? "Tutor" : message.role === "user" ? "Learner" : message.role} ${index + 1}`}
									</span>
									<span className={css({ display: "block", marginTop: "0.1rem", maxHeight: "1.9rem", overflow: "hidden", fontSize: "0.6875rem", lineHeight: 1.35, color: "var(--ink-soft)" })}>
										{preview(message.text)}
									</span>
								</span>
								{count ? (
									<span
										className={css({
											display: "inline-flex",
											minWidth: "1.25rem",
											height: "1.25rem",
											alignItems: "center",
											justifyContent: "center",
											gap: "0.125rem",
											borderRadius: "9999px",
											background: count.problems ? "color-mix(in srgb, var(--destructive) 12%, transparent)" : "color-mix(in srgb, var(--accent) 55%, transparent)",
											paddingInline: "0.25rem",
											fontSize: "0.625rem",
											fontWeight: 700,
											color: count.problems ? "var(--destructive)" : "var(--foreground)",
										})}
										aria-label={`${count.total} annotation${count.total === 1 ? "" : "s"}`}
									>
										{count.problems > 0 ? <KeatingIcon icon={reviewIcon.problem} size={10} active /> : null}
										{count.total}
									</span>
								) : null}
							</button>
						</li>
					);
				})}
			</ol>
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
			<span className={css({ flex: "0 0 auto", fontSize: "0.6875rem", fontWeight: 700, color: "var(--muted-foreground)" })}>
				Turn
			</span>
			<select
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
					_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
				})}
				onChange={(event) => onSelect(event.currentTarget.value)}
			>
				{messages.map((message, index) => (
					<option key={message.id} value={message.id}>
						{index + 1}. {message.label ?? message.role}
					</option>
				))}
			</select>
		</label>
	);
}
