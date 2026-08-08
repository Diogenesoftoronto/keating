/**
 * Metering the learner's microphone so the live surface can react to it.
 *
 * A voice UI that animates on a timer looks alive whether or not the session
 * is actually hearing anything, which is exactly backwards: the one thing an
 * animation here should tell you is "you are getting through". So the visual
 * is driven by the real signal, and the maths that turns samples into a number
 * between 0 and 1 lives here, apart from the DOM, where it can be tested.
 */

/** Analyser resolution. 512 is ample for an amplitude envelope. */
const FFT_SIZE = 512;

/**
 * Root-mean-square level of a byte time-domain buffer, normalised to 0..1.
 *
 * `getByteTimeDomainData` centres silence on 128, so each sample is offset
 * before squaring. RMS rather than peak because peak jumps on a single click
 * and reads as noise.
 */
export function rmsFromTimeDomain(samples: ArrayLike<number>): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < samples.length; i += 1) {
		const centred = (samples[i] - 128) / 128;
		sum += centred * centred;
	}
	return Math.sqrt(sum / samples.length);
}

/**
 * Map a raw RMS onto the 0..1 range the visual uses.
 *
 * Speech RMS sits far below 1 — a normal voice is around 0.05–0.2 — so a
 * linear mapping would barely move. The noise floor is cut first so a quiet
 * room reads as still rather than as a permanent shimmer, then the remainder
 * is expanded and curved: the square root lifts quiet speech into visibility
 * without letting a loud voice peg the animation.
 */
export function normalizeLevel(rms: number, noiseFloor = 0.012, ceiling = 0.28): number {
	if (!Number.isFinite(rms) || rms <= noiseFloor) return 0;
	const span = Math.max(ceiling - noiseFloor, 1e-6);
	const scaled = Math.min(1, (rms - noiseFloor) / span);
	return Math.sqrt(scaled);
}

/**
 * Ease the displayed level towards the measured one.
 *
 * Raw frame-to-frame levels judder badly at 60fps. Attack is faster than
 * release so the visual answers the start of a word immediately but decays
 * smoothly through the gaps between them, which is what reads as "listening"
 * rather than "strobing".
 */
export function smoothLevel(previous: number, next: number, attack = 0.45, release = 0.12): number {
	const rate = next > previous ? attack : release;
	return previous + (next - previous) * rate;
}

export interface LevelMeter {
	/** Current smoothed level, 0..1. Safe to call every animation frame. */
	read(): number;
	stop(): void;
}

/** A meter that always reads silence, for when there is nothing to listen to. */
const SILENT_METER: LevelMeter = { read: () => 0, stop: () => {} };

/**
 * Attach an analyser to a microphone stream.
 *
 * The stream belongs to the live session, so this only ever reads from it: no
 * track is stopped here, and disconnecting the analyser node leaves the session
 * transmitting exactly as before.
 */
export function createLevelMeter(stream: MediaStream | null | undefined): LevelMeter {
	if (!stream || typeof window === "undefined") return SILENT_METER;
	const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
	if (!AudioContextCtor || stream.getAudioTracks().length === 0) return SILENT_METER;

	let context: AudioContext;
	try {
		context = new AudioContextCtor();
	} catch {
		return SILENT_METER;
	}

	const source = context.createMediaStreamSource(stream);
	const analyser = context.createAnalyser();
	analyser.fftSize = FFT_SIZE;
	source.connect(analyser);
	// Deliberately not connected to the destination: routing the microphone to
	// the speakers would feed the learner's own voice back at them.

	const buffer = new Uint8Array(analyser.fftSize);
	let smoothed = 0;
	let stopped = false;

	return {
		read() {
			if (stopped) return 0;
			// A muted track keeps delivering silent samples, so the level falls to
			// zero on its own — no special case needed for mute.
			analyser.getByteTimeDomainData(buffer);
			smoothed = smoothLevel(smoothed, normalizeLevel(rmsFromTimeDomain(buffer)));
			return smoothed;
		},
		stop() {
			if (stopped) return;
			stopped = true;
			try {
				source.disconnect();
				analyser.disconnect();
			} catch {
				// Already torn down with the stream.
			}
			void context.close().catch(() => {});
		},
	};
}
