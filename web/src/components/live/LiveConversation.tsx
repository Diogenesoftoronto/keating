import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { JudgementDiagnostics } from "../JudgementDiagnostics";
import { Button, EmptyState, Eyebrow, IconButton, Loading, Menu, Prose, SelectField, StatusDot } from "../../design-system/kit";
import { ChartFrame } from "../../design-system/charts";
import { KeatingGlyph, type GlyphName } from "../../design-system/glyphs";
import type { LiveFailure } from "../../keating/live-errors";
import { LIVE_IMAGE_ACCEPT } from "../../keating/live-image";
import LiveVisualizer, { type VisualizerState } from "./LiveVisualizer";
import TavusConversationSurface, { type TavusConversationControls } from "./TavusConversationSurface";
import type { LiveSessionController } from "./use-live-session";
import "../../pages/live.css";

export interface LiveConversationProps {
	session: LiveSessionController;
	diagnostics?: ReactNode;
	/** Delay a provider-hosted room during preflight and isolated component previews. */
	connectEmbeddedSurface?: boolean;
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
	return `${String(minutes).padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

type Action = {id: string; label: string; glyph: GlyphName; onSelect(): void; disabled?: boolean; description?: string};

function FailureCard({failure, session, onDismiss, onOpenSettings, onUseDictation, fatal}: LiveConversationProps & {
	failure: LiveFailure; onDismiss(): void; fatal: boolean;
}) {
	const actions: Action[] = [];
	if (failure.retry) actions.push({id: "retry", label: "Try again", glyph: "refresh", onSelect: session.retry});
	const alternative = session.alternativeModel;
	if (failure.switchModel && alternative) actions.push({id: "alternative", label: "Use " + alternative.label, glyph: "refresh", onSelect: () => session.switchModel(alternative.value)});
	const tab = failure.settings;
	if (tab && onOpenSettings) actions.push({id: "settings", label: tab === "providers" ? "Providers & Models" : "Speech settings", glyph: "gear", onSelect: () => onOpenSettings(tab)});
	if (failure.dictation && onUseDictation) actions.push({id: "dictation", label: "Type or dictate instead", glyph: "mic", onSelect: onUseDictation});
	return <section className="lv-failure" role={fatal ? "alert" : "status"}>
		<div className="lv-row"><strong>{failure.title}</strong><IconButton label="Dismiss" glyph="x" onClick={onDismiss}/></div>
		<p>{failure.message}</p>{failure.hint && <p>{failure.hint}</p>}
		<div className="lv-recover">{actions.map((a,i) => <Button key={a.id} variant={i === 0 ? "primary" : "line"} glyph={a.glyph} onClick={a.onSelect}>{a.label}</Button>)}</div>
		{failure.detail && failure.detail !== failure.message && <details><summary>Technical detail</summary><p>{failure.detail}</p></details>}
	</section>;
}

function TranscriptLine({speaker, text, draft}: {speaker: "You" | "Keating"; text: string; draft?: boolean}) {
	if (!text) return null;
	return <div className="lv-utterance"><Eyebrow muted={speaker === "You"}>{speaker}{draft && " · now"}</Eyebrow>
		{speaker === "Keating" ? <Prose><p>{draft ? <em>{text}</em> : text}</p></Prose> : <p>{draft ? <em>{text}</em> : text}</p>}
	</div>;
}

export default function LiveConversation({session, diagnostics, connectEmbeddedSurface = true, onClose, onOpenSettings, onUseDictation}: LiveConversationProps) {
	const transcriptRef = useRef<HTMLDivElement>(null);
	const imageInputRef = useRef<HTMLInputElement>(null);
	const [captions, setCaptions] = useState(true);
	const [dismissedFailure, setDismissedFailure] = useState<LiveFailure | null>(null);
	const [host, setHost] = useState<TavusConversationControls | null>(null);
	const onControls = useCallback((v: TavusConversationControls | null) => setHost(v), []);
	useEffect(() => {
		const node = transcriptRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [session.transcript, captions]);
	const embedded = session.embeddedSurface;
	const muted = embedded ? host?.microphoneOn === false : session.micMuted;
	const camera = embedded ? host?.cameraOn === true : session.videoSource === "camera";
	const screen = embedded ? Boolean(host?.screenOn) : session.videoSource === "screen";
	const failed = session.phase === "failed";
	const live = session.phase === "live";
	const tools = session.tools.filter(tool => tool.status === "running");
	const visualState: VisualizerState = failed || session.phase === "ended" ? "idle" : !live ? "connecting" :
		tools.length ? "working" : session.speechState === "speaking" ? "speaking" : muted ? "idle" : "listening";
	const stageState = visualState === "working" ? "thinking" : failed ? "not connected" :
		session.phase === "ended" ? "ended" : muted && visualState === "idle" ? "microphone muted" : visualState;
	const status = live ? "Live" : failed ? "Not connected" : session.phase === "ended" ? "Ended" : "Connecting…";
	const actions: Action[] = [{id: "mic", label: muted ? "Unmute your microphone" : "Mute your microphone",
		glyph: muted ? "micoff" : "mic", onSelect: embedded ? () => host?.toggleMicrophone() : session.toggleMic, disabled: embedded ? !host?.ready : !live}];
	if (embedded || session.videoCapable) {
		const disabled = embedded ? !host?.ready : session.videoStarting || failed;
		actions.push({id: "camera", label: camera ? "Turn your camera off" : "Turn your camera on", glyph: camera ? "camera" : "cameraoff",
			onSelect: embedded ? () => host?.toggleCamera() : () => camera ? session.stopVideo() : session.startVideo("camera"), disabled});
		actions.push({id: "screen", label: screen ? "Stop sharing your screen" : "Share your screen", glyph: "screen",
			onSelect: embedded ? () => host?.toggleScreen() : () => screen ? session.stopVideo() : session.startVideo("screen"),
			disabled: disabled || Boolean(embedded && !host?.screenShareSupported),
			description: embedded && host && !host.screenShareSupported ? "Screen sharing is unavailable in this browser" : undefined});
	}
	if (embedded || camera) actions.push({id: "flip", label: "Flip your camera", glyph: "refresh",
		onSelect: embedded ? () => host?.flipCamera() : session.flipCamera, disabled: embedded ? !host?.ready || !camera : session.videoStarting});
	if (!embedded && session.imageCapable) actions.push({id: "photo", label: session.imageSending ? "Preparing image…" : "Add an image",
		glyph: "image", onSelect: () => imageInputRef.current?.click(), disabled: session.imageSending || !live});
	const {turns, draft} = session.transcript;
	const failure = failed ? session.failure : session.notice;
	return <div className="lv-session">
		<header className="lv-header k-halftone"><b>Live with Keating</b><SelectField label="Live model" value={session.model.value} onValueChange={session.switchModel}>
			{!session.models.some(m => m.value === session.model.value) && <option value={session.model.value}>{session.model.label}</option>}
			{session.models.map(m => <option key={m.value} value={m.value}>{m.label}{m.grade === "recommended" ? " · recommended" :
				m.video === "none" ? m.image ? " · image input" : " · no vision" : ""}</option>)}
		</SelectField>{onClose && <IconButton glyph="x" label="Close live conversation" onClick={onClose}/>}</header>
		<main className="lv-call">
			<section className="lv-stage" aria-label="Conversation stage">
				{embedded ? <TavusConversationSurface key={embedded.url} url={embedded.url} title={embedded.title} onEvent={session.handleEmbeddedEvent} onControlsChange={onControls} connect={connectEmbeddedSurface}/>
					: <ChartFrame title="Audio activity" reading={"Keating · " + stageState}>
						<LiveVisualizer state={visualState} inputStream={session.inputStream} size={158}/></ChartFrame>}
				<span className="lv-speaker" role="status">Keating · {stageState}</span>
				{!embedded && <div className="lv-inset k-grid"><video ref={session.previewRef} muted playsInline autoPlay aria-label="Your camera or shared screen"
					hidden={!session.videoSource} style={{transform: camera && session.cameraFacing === "user" ? "scaleX(-1)" : undefined}}/>
					<span>{screen ? "Sharing your screen" : camera ? "Your camera is on" : "Your camera is off"}</span></div>}
				{tools.length > 0 && <Loading className="lv-tool" size="inline" label={`Working on ${tools.map(t => t.name).join(", ")}…`} />}
			</section>
			<div className="lv-controls"><div className="lv-clock">{visualState === "connecting" ? <Loading size="inline" label={status}/> : <><StatusDot tone={failed ? "bad" : live ? "ok" : "idle"} aria-hidden="true"/>{status}</>}
				{live && <time>{formatElapsed(session.elapsedMs)}</time>}</div>
				{actions.map((a,i) => <span className={i >= 2 && actions.length > 3 ? "lv-extra" : undefined} key={a.id} title={a.description}>
					<IconButton glyph={a.glyph} label={a.label} aria-description={a.description} disabled={a.disabled} onClick={a.onSelect}/></span>)}
				{actions.length > 3 && <Menu className="lv-more" label="More call controls" trigger={<IconButton glyph="more" label="More call controls"/>} items={actions.slice(2)}/>}
				<Button glyph="hangup" className="lv-end k-lift" onClick={session.end}>End</Button>
			</div>
			{!embedded && session.imageCapable && <input hidden ref={imageInputRef} type="file" accept={LIVE_IMAGE_ACCEPT} aria-label="Choose a still image" onChange={event => {
				const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void session.shareImage(file);
			}}/>}
			{session.sharedImage && !session.videoSource && <figure className="lv-image k-grid"><img src={session.sharedImage.previewUrl} alt={"Shared image: " + session.sharedImage.filename}/>
				<figcaption><b>Image shared</b><p>{session.sharedImage.filename}</p></figcaption></figure>}
			{session.imageError && <p className="lv-failure" role="alert">{session.imageError}</p>}
			{failure && (!failed || dismissedFailure !== failure) && <FailureCard failure={failure} fatal={failed} session={session}
				onOpenSettings={onOpenSettings} onUseDictation={failed ? onUseDictation : undefined} onDismiss={failed ? () => setDismissedFailure(failure) : session.dismissNotice}/>}
			{diagnostics}
			<section className="lv-said" aria-label="Transcript">
				<div ref={transcriptRef} hidden={!captions} className="lv-lines" tabIndex={0}>
					{!turns.length && !draft.user && !draft.assistant && <EmptyState heading={failed || session.phase === "ended" ? "Nothing was said." :
						live && !muted ? "Say something to begin — Keating is listening." : "No transcript yet."} />}
					{turns.map((t,i) => <div key={i}><TranscriptLine speaker="You" text={t.user}/><TranscriptLine speaker="Keating" text={t.assistant}/></div>)}
					<div aria-live="polite"><TranscriptLine speaker="You" text={draft.user} draft/><TranscriptLine speaker="Keating" text={draft.assistant} draft/></div>
				</div>
				<footer className="lv-footer"><span data-glyph-host><KeatingGlyph name="lock" size={14}/> Saved to this session when you end</span>
					<Button variant="line" aria-pressed={captions} onClick={() => setCaptions(!captions)}>Captions {captions ? "on" : "off"}</Button></footer>
			</section>
			{session.judgementSessionId && <JudgementDiagnostics sessionId={session.judgementSessionId}/>}
		</main>
	</div>;
}
