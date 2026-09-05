import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DailyCall, DailyParticipant, DailyParticipantsObject } from "@daily-co/daily-js";

import { css } from "../../../styled-system/css";

export interface TavusConversationControls {
	ready: boolean;
	microphoneOn: boolean;
	cameraOn: boolean;
	screenOn: boolean;
	screenShareSupported: boolean;
	toggleMicrophone: () => void;
	toggleCamera: () => void;
	toggleScreen: () => void;
	flipCamera: () => void;
}

export interface TavusConversationSurfaceProps {
	url: string;
	title: string;
	onEvent: (event: unknown) => unknown | Promise<unknown>;
	onControlsChange?: (controls: TavusConversationControls | null) => void;
	/** Delay joining the Daily room while a host is still in preflight or preview. */
	connect?: boolean;
}

type CallState = "paused" | "connecting" | "waiting" | "live" | "failed";

function remoteParticipant(participants: DailyParticipantsObject | null): DailyParticipant | null {
	if (!participants) return null;
	return Object.values(participants).find((participant) => !participant.local) ?? null;
}

function playableTrack(participant: DailyParticipant | null, kind: "audio" | "video" | "screenVideo") {
	const track = participant?.tracks[kind];
	return track?.state === "playable" ? track.persistentTrack ?? track.track ?? null : null;
}

function attachTrack(element: HTMLMediaElement | null, track: MediaStreamTrack | null): void {
	if (!element) return;
	const current = element.srcObject;
	if (track && current instanceof MediaStream && current.getTracks()[0] === track) return;
	element.srcObject = track ? new MediaStream([track]) : null;
}

/**
 * A headless Daily call rendered entirely by Keating.
 *
 * `createCallObject` does not create or mount an iframe. Daily owns WebRTC and
 * device state; Keating owns every visible pixel and keeps Tavus app messages
 * on the same event path as the rest of the live session.
 */
export default function TavusConversationSurface({
	url,
	title,
	onEvent,
	onControlsChange,
	connect = true,
}: TavusConversationSurfaceProps) {
	const callRef = useRef<DailyCall | null>(null);
	const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
	const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
	const localVideoRef = useRef<HTMLVideoElement | null>(null);
	const onEventRef = useRef(onEvent);
	const [participants, setParticipants] = useState<DailyParticipantsObject | null>(null);
	const [callState, setCallState] = useState<CallState>(connect ? "connecting" : "paused");
	const [error, setError] = useState<string | null>(null);
	const [microphoneOn, setMicrophoneOn] = useState(true);
	const [cameraOn, setCameraOn] = useState(true);
	const [screenOn, setScreenOn] = useState(false);
	const [screenShareSupported, setScreenShareSupported] = useState(false);
	onEventRef.current = onEvent;

	const primaryRemote = useMemo(() => remoteParticipant(participants), [participants]);
	const localParticipant = participants?.local ?? null;
	const remoteVideoTrack = playableTrack(primaryRemote, "screenVideo") ?? playableTrack(primaryRemote, "video");
	const remoteAudioTrack = playableTrack(primaryRemote, "audio");
	const localVideoTrack = playableTrack(localParticipant, "video");

	useEffect(() => attachTrack(remoteVideoRef.current, remoteVideoTrack), [remoteVideoTrack]);
	useEffect(() => attachTrack(remoteAudioRef.current, remoteAudioTrack), [remoteAudioTrack]);
	useEffect(() => attachTrack(localVideoRef.current, localVideoTrack), [localVideoTrack]);

	const reportLocalState = useCallback((call: DailyCall) => {
		setMicrophoneOn(call.localAudio());
		setCameraOn(call.localVideo());
		setScreenOn(call.localScreenVideo());
	}, []);

	useEffect(() => {
		let disposed = false;
		let call: DailyCall | null = null;
		if (!connect) {
			setCallState("paused");
			setError(null);
			setParticipants(null);
			return () => {
				disposed = true;
				onControlsChange?.(null);
			};
		}
		setCallState("connecting");

		void import("@daily-co/daily-js").then(async ({ default: Daily }) => {
			if (disposed) return;
			setScreenShareSupported(Daily.supportedBrowser().supportsScreenShare);
			call = Daily.createCallObject({
				startAudioOff: false,
				startVideoOff: false,
				subscribeToTracksAutomatically: true,
			});
			callRef.current = call;

			const updateParticipants = () => {
				if (disposed || !call) return;
				const next = call.participants();
				setParticipants({ ...next });
				reportLocalState(call);
				setCallState(remoteParticipant(next) ? "live" : "waiting");
			};
			const handleAppMessage = (event: { data?: unknown }) => {
				void Promise.resolve(onEventRef.current(event.data ?? event)).then((outbound) => {
					if (outbound !== undefined && call && !disposed) call.sendAppMessage(outbound, "*");
				}).catch((reason) => {
					if (!disposed) setError(reason instanceof Error ? reason.message : "Keating could not finish that PAL activity.");
				});
			};
			const handleError = (event: { errorMsg?: string }) => {
				if (disposed) return;
				const message = event.errorMsg || "The Tavus video connection was interrupted.";
				setError(message);
				setCallState("failed");
				onEventRef.current({
					message_type: "keating",
					event_type: "keating.embed_error",
					properties: { message },
				});
			};

			call.on("joined-meeting", updateParticipants);
			call.on("participant-joined", updateParticipants);
			call.on("participant-updated", updateParticipants);
			call.on("participant-left", updateParticipants);
			call.on("local-screen-share-started", updateParticipants);
			call.on("local-screen-share-stopped", updateParticipants);
			call.on("app-message", handleAppMessage);
			call.on("error", handleError);
			call.on("nonfatal-error", handleError);

			await call.join({ url });
			if (!disposed) updateParticipants();
		}).catch((reason) => {
			if (disposed) return;
			const message = reason instanceof Error ? reason.message : "Tavus video could not connect.";
			setError(message);
			setCallState("failed");
			onEventRef.current({
				message_type: "keating",
				event_type: "keating.embed_error",
				properties: { message },
			});
		});

		return () => {
			disposed = true;
			onControlsChange?.(null);
			if (callRef.current === call) callRef.current = null;
			if (call) void call.leave().catch(() => {}).finally(() => void call?.destroy().catch(() => {}));
		};
	}, [connect, onControlsChange, reportLocalState, url]);

	const toggleMicrophone = useCallback(() => {
		const call = callRef.current;
		if (!call) return;
		call.setLocalAudio(!call.localAudio());
		reportLocalState(call);
	}, [reportLocalState]);

	const toggleCamera = useCallback(() => {
		const call = callRef.current;
		if (!call) return;
		call.setLocalVideo(!call.localVideo());
		reportLocalState(call);
	}, [reportLocalState]);

	const toggleScreen = useCallback(() => {
		const call = callRef.current;
		if (!call) return;
		try {
			if (call.localScreenVideo()) call.stopScreenShare();
			else call.startScreenShare();
			reportLocalState(call);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Screen sharing could not start.");
		}
	}, [reportLocalState]);

	const flipCamera = useCallback(() => {
		const call = callRef.current;
		if (!call) return;
		void call.cycleCamera().catch((reason) => {
			setError(reason instanceof Error ? reason.message : "The camera could not be switched.");
		});
	}, []);

	const controls = useMemo<TavusConversationControls>(() => ({
		ready: callState === "waiting" || callState === "live",
		microphoneOn,
		cameraOn,
		screenOn,
		screenShareSupported,
		toggleMicrophone,
		toggleCamera,
		toggleScreen,
		flipCamera,
	}), [callState, cameraOn, flipCamera, microphoneOn, screenOn, screenShareSupported, toggleCamera, toggleMicrophone, toggleScreen]);

	useEffect(() => onControlsChange?.(controls), [controls, onControlsChange]);

	const status = callState === "paused"
		? "KeatingBot is ready to join."
		: callState === "connecting"
		? "Opening your camera and microphone…"
		: callState === "waiting"
			? "KeatingBot is joining…"
			: error;

	return (
		<section
			aria-label={title}
			className={css({
				position: "absolute",
				inset: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: "#080808",
				overflow: "hidden",
			})}
		>
			<video
				ref={remoteVideoRef}
				autoPlay
				playsInline
				aria-label={playableTrack(primaryRemote, "screenVideo") ? "KeatingBot shared activity" : "KeatingBot video"}
				className={css({ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: playableTrack(primaryRemote, "screenVideo") ? "contain" : "cover" })}
			/>
			<audio ref={remoteAudioRef} autoPlay aria-label="KeatingBot audio" />

			<video
				ref={localVideoRef}
				muted
				autoPlay
				playsInline
				aria-label="Your camera preview"
				className={css({
					position: "absolute",
					right: "0.75rem",
					top: "0.75rem",
					width: "min(25%, 11rem)",
					aspectRatio: "4 / 3",
					objectFit: "cover",
					transform: "scaleX(-1)",
					border: "1px solid rgba(255,255,255,0.4)",
					boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.35)",
					display: cameraOn && localVideoTrack ? "block" : "none",
				})}
			/>

			{status ? (
				<p
					role={callState === "failed" ? "alert" : "status"}
					aria-live="polite"
					className={css({
						position: "relative",
						maxWidth: "24rem",
						paddingInline: "0.875rem",
						paddingBlock: "0.5rem",
						backgroundColor: "rgba(0,0,0,0.72)",
						color: "white",
						fontSize: "0.8125rem",
						textAlign: "center",
					})}
				>
					{status}
				</p>
			) : null}
		</section>
	);
}
