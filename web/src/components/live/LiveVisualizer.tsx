import { useEffect, useRef } from "react";

import { css } from "../../../styled-system/css";
import { createLevelMeter } from "../../keating/live-audio-level";

/**
 * The one thing on the live surface that shows the conversation is alive.
 *
 * Four states, each with its own motion, so whose turn it is can be read at a
 * glance from across a desk:
 *
 *   connecting — a slow, dim breath; nothing is happening yet
 *   listening  — rings driven by the real microphone level, so a learner can
 *                see they are being heard rather than guessing
 *   speaking   — an outward travelling wave; Keating has the floor
 *   working    — a segment orbiting the rim; a tool is running and an answer
 *                is coming, which otherwise looks identical to a dead session
 *
 * Drawn on a canvas from a single rAF loop and never through React state:
 * re-rendering a component sixty times a second to move a ring would make the
 * rest of the surface stutter, and the level changes far faster than any
 * sensible render cadence.
 */

export type VisualizerState = "connecting" | "listening" | "speaking" | "working" | "idle";

export interface LiveVisualizerProps {
	state: VisualizerState;
	/** The live session's microphone, for real level metering. */
	inputStream?: MediaStream | null;
	/** Rendered size in CSS pixels. */
	size?: number;
}

/** Ring geometry as a fraction of the radius, from the mascot outwards. */
const RINGS = [0.62, 0.78, 0.94];

export default function LiveVisualizer({ state, inputStream, size = 208 }: LiveVisualizerProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	// The loop reads state through a ref so a state change never restarts it —
	// restarting would reset the phase and make the animation jump.
	const stateRef = useRef(state);
	stateRef.current = state;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("2d");
		if (!context) return;

		// Match the backing store to the display density, or the rings alias
		// badly on a retina screen.
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = size * ratio;
		canvas.height = size * ratio;
		context.scale(ratio, ratio);

		const meter = createLevelMeter(inputStream);
		const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

		// Read the theme's accent once per loop start; it is a CSS variable, so it
		// cannot be interpolated inside the canvas without resolving it first.
		const accent = getComputedStyle(canvas).getPropertyValue("--primary").trim() || "#1e9b50";

		let frame = 0;
		let phase = 0;
		let level = 0;
		let lastTime = performance.now();

		const draw = (now: number) => {
			const elapsed = Math.min((now - lastTime) / 1000, 0.1);
			lastTime = now;
			const current = stateRef.current;
			phase += elapsed;

			// Only the listening state is driven by the microphone. In the others
			// the learner's own voice is not the subject, and metering it would
			// make Keating's turn flicker with room noise.
			const target = current === "listening" ? meter.read() : 0;
			level += (target - level) * 0.25;

			const centre = size / 2;
			const radius = size / 2;
			context.clearRect(0, 0, size, size);

			if (current === "working") {
				drawWorking(context, centre, radius, phase, accent, reduceMotion);
			} else {
				drawRings(context, centre, radius, phase, level, current, accent, reduceMotion);
			}

			frame = requestAnimationFrame(draw);
		};

		frame = requestAnimationFrame(draw);
		return () => {
			cancelAnimationFrame(frame);
			meter.stop();
		};
	}, [inputStream, size]);

	return (
		<div
			className={css({ position: "relative", display: "grid", placeItems: "center" })}
			style={{ width: size, height: size }}
		>
			<canvas
				ref={canvasRef}
				aria-hidden="true"
				className={css({ position: "absolute", inset: 0 })}
				style={{ width: size, height: size }}
			/>
			<img
				src="/brand/mascot-head.png"
				alt=""
				className={css({
					position: "relative",
					height: "auto",
					transition: "transform 260ms ease",
				})}
				style={{
					width: size * 0.42,
					// Keating leans in a touch while speaking. Small enough not to be
					// a distraction, large enough to register.
					transform: state === "speaking" ? "scale(1.06)" : "scale(1)",
				}}
			/>
		</div>
	);
}

/** Turn an accent colour into a stroke at the given alpha. */
function stroke(context: CanvasRenderingContext2D, accent: string, alpha: number, width: number): void {
	context.globalAlpha = Math.max(0, Math.min(1, alpha));
	context.strokeStyle = accent;
	context.lineWidth = width;
}

function drawRings(
	context: CanvasRenderingContext2D,
	centre: number,
	radius: number,
	phase: number,
	level: number,
	state: VisualizerState,
	accent: string,
	reduceMotion: boolean,
): void {
	const speaking = state === "speaking";
	const connecting = state === "connecting";
	// Speaking animates on its own clock; listening rides the microphone.
	const drive = reduceMotion ? 0 : speaking ? 1 : level;
	const speed = speaking ? 1.5 : connecting ? 0.45 : 0.7;

	RINGS.forEach((fraction, index) => {
		// Each ring lags the one inside it, so energy visibly travels outward
		// while Keating speaks instead of every ring throbbing in unison.
		const lag = index * 0.35;
		const wave = reduceMotion ? 0 : Math.sin((phase - lag) * Math.PI * speed);
		const swell = drive * 0.09 * (1 + wave * 0.5);
		const ringRadius = radius * (fraction + swell);

		const baseAlpha = connecting ? 0.16 : 0.3;
		const alpha = baseAlpha + drive * 0.45 - index * 0.07;

		stroke(context, accent, alpha, speaking ? 2.5 : 2);
		context.beginPath();
		context.arc(centre, centre, Math.max(1, ringRadius), 0, Math.PI * 2);
		context.stroke();
	});

	// A soft fill under the mascot so it sits in light rather than on a line
	// drawing. Brightness follows the same drive as the rings.
	const glow = context.createRadialGradient(centre, centre, 0, centre, centre, radius * 0.8);
	glow.addColorStop(0, accent);
	glow.addColorStop(1, "transparent");
	context.globalAlpha = (connecting ? 0.06 : 0.1) + drive * 0.18;
	context.fillStyle = glow;
	context.beginPath();
	context.arc(centre, centre, radius * 0.8, 0, Math.PI * 2);
	context.fill();
	context.globalAlpha = 1;
}

function drawWorking(
	context: CanvasRenderingContext2D,
	centre: number,
	radius: number,
	phase: number,
	accent: string,
	reduceMotion: boolean,
): void {
	const ringRadius = radius * 0.88;

	// The full track, so the orbiting segment reads as travel around something
	// rather than as a lone mark drifting in space.
	stroke(context, accent, 0.14, 2);
	context.beginPath();
	context.arc(centre, centre, ringRadius, 0, Math.PI * 2);
	context.stroke();

	// Reduced motion still gets a static indicator: the state must remain
	// distinguishable, it just stops moving.
	const start = reduceMotion ? -Math.PI / 2 : phase * 2.2;
	const sweep = Math.PI * 0.45;

	stroke(context, accent, 0.85, 3);
	context.lineCap = "round";
	context.beginPath();
	context.arc(centre, centre, ringRadius, start, start + sweep);
	context.stroke();
	context.globalAlpha = 1;
}
