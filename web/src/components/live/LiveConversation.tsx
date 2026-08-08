import { useEffect, useRef } from "react";
import {
	Camera,
	CameraOff,
	ChevronDown,
	Mic,
	MicOff,
	MonitorUp,
	PhoneOff,
	RefreshCw,
	Settings2,
	SwitchCamera,
	X,
} from "lucide-react";

import { css, cx } from "../../../styled-system/css";
import type { LiveFailure } from "../../keating/live-errors";
import LiveVisualizer, { type VisualizerState } from "./LiveVisualizer";
import type { LiveSessionController } from "./use-live-session";

/**
 * The live conversation surface.
 *
 * Modelled on a phone call rather than a dashboard: one big subject in the
 * middle, a single row of round controls at the bottom, and everything else
 * either folded away or absent. The previous version led with a telemetry HUD —
 * frames sent, tier labels, tool-call ledger — which is the wrong emphasis for
 * something a learner is meant to talk to.
 *
 * Rendered identically by the /live page and by the in-chat overlay; the only
 * difference is whether a close affordance is offered.
 */

export interface LiveConversationProps {
	session: LiveSessionController;
	/** Shown as a dismiss control; omitted on the standalone page. */
	onClose?: () => void;
	/** Opens the settings dialog on a given tab, when the host has one. */
	onOpenSettings?: (tab: "providers" | "speech") => void;
	/** Offered when a live session cannot start but dictation would still work. */
	onUseDictation?: () => void;
}

function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * A round call control.
 *
 * The size is expressed as matching min/max rather than `width`, because a
 * global rule forces `width: auto !important` on every button inside a
 * `[role="dialog"]` (and the compact-button escape hatch forces the same
 * thing). Bounds are not `width`, so they survive it — and the result collapses
 * to exactly one size, which is all `width` was doing here anyway.
 */
const controlButton = css({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	flex: "0 0 auto",
	minWidth: "3.5rem",
	maxWidth: "3.5rem",
	minHeight: "3.5rem",
	maxHeight: "3.5rem",
	padding: 0,
	marginBottom: 0,
	borderRadius: "9999px",
	border: "1px solid var(--border)",
	backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
	color: "var(--foreground)",
	cursor: "pointer",
	transition: "background-color 120ms ease, transform 120ms ease, opacity 120ms ease",
	_hover: { backgroundColor: "color-mix(in srgb, var(--foreground) 16%, transparent)" },
	_active: { transform: "scale(0.94)" },
	_disabled: { opacity: 0.4, cursor: "not-allowed", _hover: { backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)" } },
});

const controlActive = css({
	backgroundColor: "var(--foreground)",
	color: "var(--background)",
	borderColor: "var(--foreground)",
	_hover: { backgroundColor: "var(--foreground)" },
});

const controlDanger = css({
	backgroundColor: "var(--destructive)",
	borderColor: "var(--destructive)",
	color: "var(--destructive-foreground, white)",
	_hover: { backgroundColor: "color-mix(in srgb, var(--destructive) 85%, black)" },
});

const controlLabel = css({
	fontSize: "0.6875rem",
	letterSpacing: "0.04em",
	textTransform: "uppercase",
	color: "var(--muted-foreground)",
	textAlign: "center",
	marginTop: "0.375rem",
});

function Control({
	icon,
	label,
	onClick,
	active,
	danger,
	disabled,
	title,
}: {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	active?: boolean;
	danger?: boolean;
	disabled?: boolean;
	title?: string;
}) {
	return (
		<div
			className={css({
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				// Wide enough that a two-word label ("Share screen") does not push
				// its neighbours around.
				minWidth: "5.5rem",
			})}
		>
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				title={title ?? label}
				aria-label={title ?? label}
				aria-pressed={active}
				className={cx(controlButton, active ? controlActive : undefined, danger ? controlDanger : undefined)}
			>
				{icon}
			</button>
			<span className={controlLabel}>{label}</span>
		</div>
	);
}

/**
 * A failure, rendered as the thing to do about it rather than as an error code.
 *
 * Every button here comes from a flag on the classification, so a new failure
 * kind gets the right recovery affordances without touching this component.
 */
function FailureCard({
	failure,
	session,
	onOpenSettings,
	onUseDictation,
	onDismiss,
	tone,
}: {
	failure: LiveFailure;
	session: LiveSessionController;
	onOpenSettings?: (tab: "providers" | "speech") => void;
	onUseDictation?: () => void;
	onDismiss?: () => void;
	tone: "fatal" | "notice";
}) {
	const alternative = session.alternativeModel;
	return (
		<div
			role={tone === "fatal" ? "alert" : "status"}
			className={css({
				width: "100%",
				maxWidth: "30rem",
				borderRadius: "0.875rem",
				border: "1px solid",
				borderColor: tone === "fatal" ? "color-mix(in srgb, var(--destructive) 45%, transparent)" : "var(--border)",
				backgroundColor: tone === "fatal"
					? "color-mix(in srgb, var(--destructive) 10%, var(--background))"
					: "color-mix(in srgb, var(--foreground) 5%, var(--background))",
				padding: "1rem 1.125rem",
				display: "flex",
				flexDirection: "column",
				gap: "0.5rem",
				textAlign: "left",
			})}
		>
			<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.75rem" })}>
				<div className={css({ flex: 1, minWidth: 0 })}>
					<p className={css({ fontWeight: 600, fontSize: "0.9375rem" })}>{failure.title}</p>
					<p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", marginTop: "0.25rem" })}>
						{failure.message}
					</p>
					{failure.hint ? (
						<p className={css({ fontSize: "0.875rem", marginTop: "0.375rem" })}>{failure.hint}</p>
					) : null}
				</div>
				{onDismiss ? (
					<button
						type="button"
						onClick={onDismiss}
						aria-label="Dismiss"
						className={cx("dialog-compact-button", css({
							flexShrink: 0,
							padding: "0.25rem",
							borderRadius: "0.375rem",
							color: "var(--muted-foreground)",
							cursor: "pointer",
							_hover: { color: "var(--foreground)" },
						}))}
					>
						<X size={16} />
					</button>
				) : null}
			</div>

			<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" })}>
				{failure.retry ? (
					<button type="button" onClick={session.retry} className={cx("dialog-compact-button", primaryActionClass)}>
						<RefreshCw size={14} /> Try again
					</button>
				) : null}
				{failure.switchModel && alternative ? (
					<button
						type="button"
						onClick={() => session.switchModel(alternative.value)}
						className={cx("dialog-compact-button", secondaryActionClass)}
					>
						Use {alternative.label}
					</button>
				) : null}
				{failure.settings && onOpenSettings ? (
					<button
						type="button"
						onClick={() => onOpenSettings(failure.settings as "providers" | "speech")}
						className={cx("dialog-compact-button", secondaryActionClass)}
					>
						<Settings2 size={14} /> {failure.settings === "providers" ? "Providers & Models" : "Speech settings"}
					</button>
				) : null}
				{failure.dictation && onUseDictation ? (
					<button type="button" onClick={onUseDictation} className={cx("dialog-compact-button", secondaryActionClass)}>
						<Mic size={14} /> Type or dictate instead
					</button>
				) : null}
			</div>

			{failure.detail && failure.detail !== failure.message ? (
				<details className={css({ marginTop: "0.25rem" })}>
					<summary className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)", cursor: "pointer" })}>
						Technical detail
					</summary>
					<p className={css({
						fontSize: "0.75rem",
						fontFamily: "var(--mono-body)",
						color: "var(--muted-foreground)",
						marginTop: "0.375rem",
						wordBreak: "break-word",
					})}>
						{failure.detail}
					</p>
				</details>
			) : null}
		</div>
	);
}

const primaryActionClass = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.375rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--primary)",
	backgroundColor: "var(--primary)",
	color: "var(--primary-foreground)",
	paddingInline: "0.75rem",
	paddingBlock: "0.4375rem",
	fontSize: "0.8125rem",
	fontWeight: 600,
	cursor: "pointer",
});

const secondaryActionClass = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.375rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	backgroundColor: "transparent",
	color: "var(--foreground)",
	paddingInline: "0.75rem",
	paddingBlock: "0.4375rem",
	fontSize: "0.8125rem",
	cursor: "pointer",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
});

/**
 * Which animation the visualizer should be running.
 *
 * A running tool outranks everything else: a session that has gone quiet
 * because it is fetching something looks exactly like one that has died, and
 * that ambiguity is what makes people give up and reload.
 */
function visualizerState(session: LiveSessionController): VisualizerState {
	if (session.phase === "failed" || session.phase === "ended") return "idle";
	if (session.phase === "connecting") return "connecting";
	if (session.tools.some((tool) => tool.status === "running")) return "working";
	if (session.speechState === "speaking") return "speaking";
	// A muted mic has nothing to meter, so it gets the still state rather than
	// a listening animation that would never move.
	return session.micMuted ? "idle" : "listening";
}

export default function LiveConversation({ session, onClose, onOpenSettings, onUseDictation }: LiveConversationProps) {
	const transcriptRef = useRef<HTMLDivElement | null>(null);

	// Keep the newest line in view without stealing focus from the controls.
	useEffect(() => {
		const node = transcriptRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [session.transcript]);

	const videoOn = session.videoSource !== null;
	const failed = session.phase === "failed";
	const runningTools = session.tools.filter((tool) => tool.status === "running");
	const visualState = visualizerState(session);

	const statusText = failed
		? "Not connected"
		: session.phase === "connecting"
			? "Connecting…"
			: session.speechState === "speaking"
				? "Keating is speaking"
				: session.micMuted
					? "Muted"
					: "Listening";

	return (
		<div
			className={css({
				position: "relative",
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				backgroundColor: "var(--background)",
				color: "var(--foreground)",
			})}
		>
			{/* Header: identity and state, nothing actionable except leaving. */}
			<header
				className={css({
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "0.75rem",
					paddingInline: "1rem",
					paddingBlock: "0.75rem",
					borderBottom: "1px solid var(--border)",
				})}
			>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 })}>
					<span
						className={css({ width: "0.5rem", height: "0.5rem", borderRadius: "9999px", flexShrink: 0 })}
						style={{
							backgroundColor: failed
								? "var(--destructive)"
								: session.phase === "connecting"
									? "var(--amber, orange)"
									: "var(--accent-green, limegreen)",
						}}
					/>
					<div className={css({ minWidth: 0 })}>
						<p className={css({ fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.2 })}>{statusText}</p>
						<p
							className={css({
								fontSize: "0.75rem",
								color: "var(--muted-foreground)",
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							})}
						>
							{session.model.label}
							{session.phase === "live" ? ` · ${formatElapsed(session.elapsedMs)}` : ""}
						</p>
					</div>
				</div>

				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					{/* Model switching is available at any time, not only after a failure. */}
					<div className={css({ position: "relative", display: { base: "none", sm: "block" } })}>
						<select
							value={session.model.value}
							onChange={(event) => session.switchModel(event.target.value)}
							aria-label="Live model"
							className={css({
								appearance: "none",
								borderRadius: "0.5rem",
								border: "1px solid var(--border)",
								backgroundColor: "transparent",
								color: "var(--muted-foreground)",
								fontSize: "0.75rem",
								paddingInline: "0.625rem 1.5rem",
								paddingBlock: "0.3125rem",
								cursor: "pointer",
							})}
						>
							{session.models.some((entry) => entry.value === session.model.value) ? null : (
								<option value={session.model.value}>{session.model.label}</option>
							)}
							{session.models.map((entry) => (
								<option key={entry.value} value={entry.value}>
									{entry.label}
									{entry.grade === "recommended" ? " · recommended" : entry.video === "none" ? " · no vision" : ""}
								</option>
							))}
						</select>
						<ChevronDown
							size={12}
							className={css({ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--muted-foreground)" })}
						/>
					</div>
					{onClose ? (
						<button
							type="button"
							onClick={onClose}
							aria-label="Close live conversation"
							className={cx("dialog-compact-button", css({
								padding: "0.375rem",
								borderRadius: "0.5rem",
								color: "var(--muted-foreground)",
								cursor: "pointer",
								_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
							}))}
						>
							<X size={18} />
						</button>
					) : null}
				</div>
			</header>

			{/* Stage: video if there is any, otherwise the orb. */}
			<div
				className={css({
					position: "relative",
					flex: 1,
					minHeight: 0,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: "1rem",
					padding: "1rem",
					overflow: "hidden",
				})}
			>
				<video
					ref={session.previewRef}
					muted
					playsInline
					autoPlay
					aria-label="Your camera or shared screen"
					className={css({
						position: "absolute",
						inset: 0,
						width: "100%",
						height: "100%",
						objectFit: "contain",
						backgroundColor: "black",
					})}
					style={{
						display: videoOn ? "block" : "none",
						// Only a front camera is mirrored; a rear camera or a shared
						// screen shown flipped is disorienting.
						transform: session.videoSource === "camera" && session.cameraFacing === "user" ? "scaleX(-1)" : undefined,
					}}
				/>

				{videoOn ? (
					// Over video the visualizer shrinks into a corner badge, so the
					// learner's own work stays the largest thing on screen while turn
					// taking is still readable.
					<div className={css({ position: "absolute", top: "0.75rem", right: "0.75rem", pointerEvents: "none" })}>
						<LiveVisualizer state={visualState} inputStream={session.inputStream} size={84} />
					</div>
				) : (
					<LiveVisualizer state={visualState} inputStream={session.inputStream} size={208} />
				)}

				{failed && session.failure ? (
					<div className={css({ position: "relative", width: "100%", display: "flex", justifyContent: "center" })}>
						<FailureCard
							failure={session.failure}
							session={session}
							onOpenSettings={onOpenSettings}
							onUseDictation={onUseDictation}
							tone="fatal"
						/>
					</div>
				) : null}

				{!failed && session.notice ? (
					<div className={css({ position: "relative", width: "100%", display: "flex", justifyContent: "center" })}>
						<FailureCard
							failure={session.notice}
							session={session}
							onOpenSettings={onOpenSettings}
							onDismiss={session.dismissNotice}
							tone="notice"
						/>
					</div>
				) : null}

				{runningTools.length > 0 ? (
					<p
						className={css({
							position: "relative",
							fontSize: "0.8125rem",
							color: "var(--muted-foreground)",
							backgroundColor: "color-mix(in srgb, var(--background) 80%, transparent)",
							borderRadius: "9999px",
							paddingInline: "0.75rem",
							paddingBlock: "0.25rem",
						})}
					>
						Working on {runningTools.map((tool) => tool.name).join(", ")}…
					</p>
				) : null}
			</div>

			{/* Transcript: present, scrollable, but never the main event. */}
			<div
				ref={transcriptRef}
				className={css({
					flexShrink: 0,
					maxHeight: "9rem",
					overflowY: "auto",
					paddingInline: "1rem",
					paddingBlock: "0.5rem",
					borderTop: "1px solid var(--border)",
					fontSize: "0.875rem",
					lineHeight: 1.5,
					display: "flex",
					flexDirection: "column",
					gap: "0.375rem",
				})}
			>
				{session.transcript.turns.length === 0 && !session.transcript.draft.user && !session.transcript.draft.assistant ? (
					<p className={css({ color: "var(--muted-foreground)" })}>
						{failed ? "Nothing was said." : "Say something to begin — Keating is listening."}
					</p>
				) : null}
				{session.transcript.turns.map((turn, index) => (
					<div key={index} className={css({ display: "flex", flexDirection: "column", gap: "0.125rem" })}>
						{turn.user ? <p><span className={css({ color: "var(--muted-foreground)" })}>You: </span>{turn.user}</p> : null}
						{turn.assistant ? <p><span className={css({ color: "var(--primary)" })}>Keating: </span>{turn.assistant}</p> : null}
					</div>
				))}
				{session.transcript.draft.user ? (
					<p className={css({ opacity: 0.65 })}><span className={css({ color: "var(--muted-foreground)" })}>You: </span>{session.transcript.draft.user}</p>
				) : null}
				{session.transcript.draft.assistant ? (
					<p className={css({ opacity: 0.65 })}><span className={css({ color: "var(--primary)" })}>Keating: </span>{session.transcript.draft.assistant}</p>
				) : null}
			</div>

			{/* Controls. One row, thumb-reachable, same order every time. */}
			<div
				className={css({
					flexShrink: 0,
					display: "flex",
					alignItems: "flex-start",
					justifyContent: "center",
					flexWrap: "wrap",
					gap: "1.25rem",
					paddingInline: "1rem",
					paddingBlock: "1rem",
					paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
					borderTop: "1px solid var(--border)",
				})}
			>
				<Control
					icon={session.micMuted ? <MicOff size={22} /> : <Mic size={22} />}
					label={session.micMuted ? "Unmute" : "Mute"}
					onClick={session.toggleMic}
					active={session.micMuted}
					disabled={session.phase !== "live"}
				/>
				<Control
					icon={session.videoSource === "camera" ? <CameraOff size={22} /> : <Camera size={22} />}
					label={session.videoSource === "camera" ? "Camera off" : "Camera"}
					onClick={() => (session.videoSource === "camera" ? session.stopVideo() : session.startVideo("camera"))}
					active={session.videoSource === "camera"}
					disabled={!session.visionCapable || session.videoStarting || session.phase === "failed"}
					title={session.visionCapable ? undefined : `${session.model.label} cannot see — pick a model with vision`}
				/>
				<Control
					icon={<MonitorUp size={22} />}
					label={session.videoSource === "screen" ? "Stop sharing" : "Share screen"}
					onClick={() => (session.videoSource === "screen" ? session.stopVideo() : session.startVideo("screen"))}
					active={session.videoSource === "screen"}
					disabled={!session.visionCapable || session.videoStarting || session.phase === "failed"}
					title={session.visionCapable ? undefined : `${session.model.label} cannot see — pick a model with vision`}
				/>
				{session.videoSource === "camera" ? (
					<Control
						icon={<SwitchCamera size={22} />}
						label="Flip"
						onClick={session.flipCamera}
						disabled={session.videoStarting}
					/>
				) : null}
				<Control
					icon={<PhoneOff size={22} />}
					label="End"
					onClick={session.end}
					danger
				/>
			</div>
		</div>
	);
}
