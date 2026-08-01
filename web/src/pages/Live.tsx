import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, MonitorUp, Power } from "lucide-react";

import { Nav } from "../components/Nav";
import { AssistantChatPanel } from "../components/AssistantChatPanel";
import { css, cx } from "../../styled-system/css";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import {
	getLiveSpeechBridge,
	getSpeechProvider,
	loadWebSpeechSettings,
	primeSpeechAudio,
	resolveSpeechRealtimeTier,
	speechErrorMessage,
	type LiveSpeechSession,
	type LiveSpeechState,
} from "../keating/speech";
import { startVideoCapture, type VideoCaptureHandle } from "../keating/video-capture";
import type { ConversationEvent } from "../keating/protocol";
import { getProviderApiKey } from "../lib/provider-models";

/**
 * The live session surface.
 *
 * Keating's mascot is a CRT monitor with a face, so a live A/V session gets
 * rendered as exactly that: the learner's camera feed becomes the phosphor
 * screen behind the bezel, and Keating's own face takes over whenever he has
 * nothing to look at. Status, tools, and transcript are all terminal readouts,
 * matching the boot sequence and the landing hero.
 */

const STATE_LABEL: Record<LiveSpeechState, string> = {
	connecting: "connecting",
	listening: "listening",
	speaking: "speaking",
	closed: "standby",
};

interface ToolEntry {
	callId: string;
	name: string;
	status: "running" | "completed" | "failed";
}

interface TranscriptEntry {
	role: "user" | "assistant";
	text: string;
}

/**
 * Keep the normal Keating agent lifecycle mounted when /live is opened
 * directly. Chat normally owns this hook, but the live surface still needs
 * its prompt, history, tools, executor, and canonical-event persistence.
 */
function StandaloneLiveAgentBridge() {
	const { chatPanelRef } = useKeatingAgent();

	return (
		<div aria-hidden="true" className={css({ display: "none" })}>
			<AssistantChatPanel ref={chatPanelRef} />
		</div>
	);
}

/**
 * Dotted leader between a label and its status, as in the boot sequence.
 *
 * The dots are a border rather than repeated glyphs: a run of non-breaking
 * characters contributes its full width to max-content sizing and will drag the
 * whole grid column wider than its cell.
 */
function Leader({ label, value, tone }: { label: string; value: string; tone?: "ok" | "fail" | "pending" }) {
	return (
		<div className={css({ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.8125rem", minWidth: 0 })}>
			<span className={css({ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
				{label}
			</span>
			<span
				aria-hidden="true"
				className={css({
					flex: "1 1 auto",
					minWidth: "0.75rem",
					alignSelf: "center",
					borderBottom: "1px dotted currentColor",
					opacity: 0.35,
				})}
			/>
			<span
				className={css({
					whiteSpace: "nowrap",
					flexShrink: 0,
					color: tone === "fail"
						? "var(--red)"
						: tone === "pending"
							? "var(--amber)"
							: "var(--phosphor)",
				})}
			>
				{value}
			</span>
		</div>
	);
}

export function Live() {
	const settings = useMemo(() => loadWebSpeechSettings(), []);
	const tier = useMemo(() => resolveSpeechRealtimeTier(settings), [settings]);

	const [state, setState] = useState<LiveSpeechState>("closed");
	const [active, setActive] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
	const [tools, setTools] = useState<ToolEntry[]>([]);
	const [framesSent, setFramesSent] = useState(0);
	const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
	const [videoLive, setVideoLive] = useState(false);

	const sessionRef = useRef<LiveSpeechSession | null>(null);
	const videoRef = useRef<VideoCaptureHandle | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const previewRef = useRef<HTMLVideoElement | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const startedAtRef = useRef<number>(0);

	const appendTranscript = useCallback((role: "user" | "assistant", text: string) => {
		if (!text) return;
		setTranscript((prev) => {
			const last = prev[prev.length - 1];
			// Deltas from the same speaker coalesce; a change of speaker starts a
			// new line.
			if (last && last.role === role) {
				return [...prev.slice(0, -1), { role, text: last.text + text }];
			}
			return [...prev, { role, text }];
		});
	}, []);

	// Keep the newest line in view without yanking the page around.
	useEffect(() => {
		const node = transcriptRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [transcript]);

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		void sessionRef.current?.stop().catch(() => {});
		sessionRef.current = null;
		videoRef.current?.stop();
		videoRef.current = null;
		if (previewRef.current) previewRef.current.srcObject = null;
		setVideoLive(false);
		setActive(false);
		setState("closed");
	}, []);

	// A live session holds the microphone, the camera, and a paid socket; it
	// must not survive the user navigating away.
	useEffect(() => stop, [stop]);

	const onConversationEvent = useCallback((event: ConversationEvent) => {
		switch (event.type) {
			case "tool.requested":
				setTools((prev) => [
					...prev,
					{ callId: event.payload.callId, name: event.payload.name, status: "running" },
				]);
				break;
			case "tool.completed":
			case "tool.failed":
				setTools((prev) => prev.map((entry) =>
					entry.callId === event.payload.callId
						? { ...entry, status: event.type === "tool.completed" ? "completed" : "failed" }
						: entry));
				break;
			default:
				break;
		}
	}, []);

	const start = useCallback(async () => {
		setError(null);
		setTranscript([]);
		setTools([]);
		setFramesSent(0);
		setFirstAudioMs(null);
		setState("connecting");
		setActive(true);
		startedAtRef.current = Date.now();

		const abort = new AbortController();
		abortRef.current = abort;
		// Screen sharing requires transient user activation. Begin the request
		// synchronously from the Start Session button before provider setup awaits
		// can consume that activation; the resolved handle is used below.
		const pendingScreenCapture = settings.videoEnabled && tier.video && settings.videoSource === "screen"
			? startVideoCapture({
				source: settings.videoSource,
				intervalMs: settings.frameIntervalMs,
			}).catch((err) => {
				console.warn("[keating:live] screen capture unavailable", err);
				return null;
			})
			: null;

		try {
			// Browsers only unlock audio playback inside a user gesture, and this
			// runs from the power button's handler.
			await primeSpeechAudio();

			const provider = await getSpeechProvider(settings.providerId);
			if (!provider?.startLiveSession) {
				throw new Error("This speech provider cannot hold a live session. Pick OpenAI Realtime or Gemini Live in Settings → Speech.");
			}

			let video: VideoCaptureHandle | null = null;
			if (settings.videoEnabled && tier.video) {
				try {
					video = await (pendingScreenCapture ?? startVideoCapture({
						source: settings.videoSource,
						intervalMs: settings.frameIntervalMs,
					}));
					if (!video) throw new Error("Video capture was unavailable.");
					videoRef.current = video;
					if (previewRef.current) {
						previewRef.current.srcObject = video.stream;
						void previewRef.current.play().catch(() => {});
					}
					video.onFrame(() => setFramesSent((count) => count + 1));
					setVideoLive(true);
				} catch (err) {
					// Vision is optional; a declined camera prompt must not cost the
					// learner their voice session.
					console.warn("[keating:live] video capture unavailable", err);
					setError(speechErrorMessage(err, "Camera or screen capture was unavailable. Continuing with audio only."));
				}
			}

			const bridge = getLiveSpeechBridge();
			const session = await provider.startLiveSession({
				settings,
				getApiKey: getProviderApiKey,
				signal: abort.signal,
				instructions: bridge?.instructions,
				history: bridge?.history,
				tools: bridge?.tools,
				video,
				onToolCall: bridge ? (call) => bridge.execute(call, abort.signal) : undefined,
				onConversationEvent,
				onState: (next) => {
					setState(next);
					if (next === "speaking") {
						setFirstAudioMs((current) => current ?? Date.now() - startedAtRef.current);
					}
				},
				onUserTranscript: (text) => appendTranscript("user", text),
				onAssistantTranscript: (text) => appendTranscript("assistant", text),
				onError: (err) => setError(err.message),
			});
			sessionRef.current = session;
		} catch (err) {
			setError(speechErrorMessage(err, "The live session could not be started."));
			stop();
		}
	}, [appendTranscript, onConversationEvent, settings, stop, tier.video]);

	const speaking = state === "speaking";

	return (
		<div className={cx("retro-layout", "retro-page")}>
			<StandaloneLiveAgentBridge />
			<Nav />
			<main className={css({ maxWidth: "68rem", marginInline: "auto", padding: "1.5rem", display: "grid", gap: "1.5rem" })}>
				<header className={css({ display: "grid", gap: "0.5rem" })}>
					<div className={cx("prompt", css({ fontSize: "0.8125rem", opacity: 0.75 }))}>
						keating --live --tier={tier.tier}
					</div>
					<h1 className={css({ fontFamily: "var(--mono-display)", fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.2 })}>
						{tier.label}
					</h1>
					{tier.capReason && (
						<p className={css({ fontSize: "0.875rem", opacity: 0.75, maxWidth: "48rem" })}>
							{tier.capReason}
						</p>
					)}
				</header>

				{error && (
					<div
						role="alert"
						className={css({
							border: "1px solid var(--red)",
							borderRadius: "0.375rem",
							padding: "0.75rem 1rem",
							fontSize: "0.875rem",
							color: "var(--red)",
							background: "color-mix(in srgb, var(--red) 8%, transparent)",
						})}
					>
						{error}
					</div>
				)}

				<div className={css({ display: "grid", gap: "1.5rem", gridTemplateColumns: "minmax(0, 1fr)", lg: { gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)" } })}>
					{/* The viewport — Keating's CRT face, showing whatever he can see. */}
					{/* minmax(0, 1fr) so a wide child can never stretch the column. */}
					<section className={css({ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "1rem", alignContent: "start", minWidth: 0 })}>
						<div
							className={cx(
								"crt",
								"terminal-glow",
								css({
									position: "relative",
									overflow: "hidden",
									aspectRatio: "4 / 3",
									// Never let the viewport eat a whole phone screen.
									maxHeight: "min(56dvh, 30rem)",
									minWidth: 0,
									borderRadius: "0.75rem",
									border: "3px solid var(--terminal-edge)",
									background: "var(--terminal)",
									// Column flow: content region above, status row below, so
									// nothing can overlap at any viewport size.
									display: "flex",
									flexDirection: "column",
									transitionProperty: "box-shadow, border-color",
									transitionDuration: "300ms",
								}),
								// The bezel brightens while Keating is talking, so the
								// speaking state is legible from across a room.
								speaking ? css({ borderColor: "var(--phosphor)" }) : "",
							)}
						>
						{/* Content region: the feed, or Keating's own face when blind. */}
							<div className={css({ position: "relative", flex: 1, minHeight: 0, display: "grid", placeItems: "center", overflow: "hidden" })}>
								<video
									ref={previewRef}
									muted
									playsInline
									className={css({
										position: "absolute",
										inset: 0,
										width: "100%",
										height: "100%",
										objectFit: "cover",
										// Tint the feed toward phosphor so it reads as part of
										// the monitor rather than a webcam pasted on top.
										filter: "saturate(0.75) contrast(1.05)",
										display: videoLive ? "block" : "none",
									})}
								/>

								{!videoLive && (
									<div className={css({ display: "grid", gap: "0.5rem", justifyItems: "center", padding: "0.75rem", textAlign: "center" })}>
										<img
											src="/brand/mascot-head.png"
											alt=""
											className={cx(
												css({ width: "4rem", md: { width: "5.5rem" }, height: "auto", imageRendering: "pixelated" }),
												speaking ? css({ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" }) : "",
											)}
										/>
										<p className={cx("font-terminal", css({ color: "var(--phosphor-dim)", fontSize: "0.9375rem", letterSpacing: "0.04em" }))}>
											{tier.video ? "NO VIDEO INPUT" : "THIS MODEL HAS NO VISION"}
										</p>
										{tier.video && (
											// Supplementary guidance; the phone viewport is too
											// short to carry it alongside the mascot.
											<p className={css({ display: "none", md: { display: "block" }, color: "var(--phosphor-dim)", fontSize: "0.75rem", opacity: 0.7, maxWidth: "16rem" })}>
												Enable the camera in Settings → Speech.
											</p>
										)}
									</div>
								)}
							</div>

						{/* Status bar, in flow along the bottom edge of the bezel. */}
							<div
								className={cx(
									"font-terminal",
									css({
										flexShrink: 0,
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										gap: "0.5rem",
										paddingInline: "0.75rem",
										paddingBlock: "0.375rem",
										borderTop: "1px solid color-mix(in srgb, var(--phosphor) 18%, transparent)",
										background: "color-mix(in srgb, var(--terminal) 88%, black)",
										fontSize: "0.875rem",
										letterSpacing: "0.06em",
									}),
								)}
							>
								<span
									className={cx(
										active && state !== "closed" ? "cursor-blink" : "",
										css({
											color: speaking ? "var(--phosphor)" : "var(--phosphor-dim)",
											textShadow: speaking ? "0 0 8px color-mix(in srgb, var(--phosphor) 60%, transparent)" : "none",
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
										}),
									)}
								>
									{`> ${STATE_LABEL[state]}`}
								</span>

								{videoLive && (
									<span
										className={css({
											display: "inline-flex",
											alignItems: "center",
											gap: "0.375rem",
											flexShrink: 0,
											color: "var(--phosphor)",
										})}
									>
										{settings.videoSource === "screen" ? <MonitorUp size={12} /> : <Camera size={12} />}
										{settings.videoSource === "screen" ? "SCREEN" : "CAM"}
										{tier.videoRoute === "sampled" ? " · SAMPLED" : " · LIVE"}
									</span>
								)}
							</div>
						</div>

						<button
							type="button"
							onClick={active ? stop : () => void start()}
							className={cx(
								"font-terminal",
								css({
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									gap: "0.5rem",
									width: "100%",
									minHeight: "3rem",
									borderRadius: "0.375rem",
									border: "2px solid",
									fontSize: "1.25rem",
									letterSpacing: "0.08em",
									cursor: "pointer",
									transitionProperty: "background-color, color, border-color, box-shadow, transform",
									transitionDuration: "150ms",
									_active: { transform: "translate(1px, 1px)" },
								}),
								active
									? css({
										borderColor: "var(--red)",
										color: "var(--red)",
										background: "color-mix(in srgb, var(--red) 10%, transparent)",
										boxShadow: "2px 2px 0 color-mix(in srgb, var(--red) 45%, transparent)",
									})
									: css({
										borderColor: "var(--accent-green)",
										color: "var(--accent-green)",
										background: "color-mix(in srgb, var(--accent-green) 10%, transparent)",
										boxShadow: "2px 2px 0 color-mix(in srgb, var(--accent-green) 45%, transparent)",
										_hover: { background: "color-mix(in srgb, var(--accent-green) 18%, transparent)" },
									}),
							)}
						>
							<Power size={18} />
							{active ? "END SESSION" : "START SESSION"}
						</button>

						{/* Boot-style capability readout. */}
						<div className={cx("font-terminal", css({ display: "grid", gap: "0.25rem", padding: "0.875rem 1rem", border: "1px solid var(--line)", borderRadius: "0.375rem" }))}>
							<Leader label="audio duplex" value="[OK]" />
							<Leader
								label="vision"
								value={tier.videoRoute === "native" ? "[LIVE LANE]" : tier.videoRoute === "sampled" ? "[SAMPLED]" : "[NONE]"}
								tone={tier.videoRoute === "none" ? "fail" : "ok"}
							/>
							<Leader label="tool calls" value={tier.tier > 0 ? "[OK]" : "[NONE]"} tone={tier.tier > 0 ? "ok" : "fail"} />
							<Leader label="frames sent" value={String(framesSent)} tone="pending" />
							<Leader
								label="first audio"
								value={firstAudioMs === null ? "--" : `${(firstAudioMs / 1000).toFixed(1)}s`}
								tone="pending"
							/>
						</div>
					</section>

					{/* Transcript and tool feed, as terminal output. */}
					{/* Flex column so the transcript reliably absorbs the leftover
					    height and the tool feed stays pinned below it. */}
					<section className={css({ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 })}>
						<div
							ref={transcriptRef}
							// `terminal-window` carries its own scanline ::before; adding
							// `crt` here would collide on the same pseudo-element.
							className={cx(
								"terminal-window",
								css({
									position: "relative",
									borderRadius: "0.5rem",
									border: "1px solid var(--terminal-edge)",
									padding: "1rem",
									// Fixed on phones so the transcript and the viewport both
									// stay reachable; on wide screens it fills the column.
									height: "14rem",
									md: { height: "18rem" },
									lg: { height: "auto", flex: 1, minHeight: "18rem" },
									overflowY: "auto",
									overflowWrap: "anywhere",
									fontSize: "0.9375rem",
									lineHeight: 1.55,
								}),
							)}
						>
							{transcript.length === 0 ? (
								<p className={css({ color: "var(--phosphor-dim)" })}>
									{active ? "> awaiting speech_" : "> press start to begin_"}
								</p>
							) : (
								transcript.map((entry, index) => (
									<p key={index} className={css({ marginBottom: "0.5rem" })}>
										<span className={css({ color: entry.role === "user" ? "var(--amber)" : "var(--phosphor)", opacity: 0.9 })}>
											{entry.role === "user" ? "YOU> " : "KEATING> "}
										</span>
										<span className={css({ color: entry.role === "user" ? "var(--phosphor-dim)" : "var(--phosphor)" })}>
											{entry.text}
										</span>
									</p>
								))
							)}
						</div>

						<div className={cx("font-terminal", css({ display: "grid", gap: "0.25rem", padding: "0.875rem 1rem", border: "1px solid var(--line)", borderRadius: "0.375rem", minHeight: "6rem", alignContent: "start" }))}>
							<div className={css({ fontSize: "0.9375rem", opacity: 0.6, letterSpacing: "0.06em", marginBottom: "0.25rem" })}>
								TOOL CALLS
							</div>
							{tools.length === 0 ? (
								<p className={css({ fontSize: "0.9375rem", opacity: 0.55 })}>none yet</p>
							) : (
								tools.map((tool) => (
									<Leader
										key={`${tool.callId}-${tool.name}`}
										label={tool.name}
										value={tool.status === "running" ? "[····]" : tool.status === "completed" ? "[OK]" : "[FAIL]"}
										tone={tool.status === "running" ? "pending" : tool.status === "completed" ? "ok" : "fail"}
									/>
								))
							)}
						</div>
					</section>
				</div>
			</main>
		</div>
	);
}

export default Live;
