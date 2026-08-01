/**
 * Microphone capture on the audio rendering thread.
 *
 * The deprecated ScriptProcessorNode runs its callback on the main thread, so
 * any React render or tool execution during a live session shows up as dropped
 * or glitched microphone audio. An AudioWorklet runs on the audio thread and is
 * unaffected by main-thread work.
 *
 * The worklet is shipped as a source string and loaded from a blob URL rather
 * than a separate bundled entry point — worklet modules cannot share the app's
 * module graph anyway, and this keeps it working under any bundler config.
 */

/** Frames per posted chunk. ~85ms at 16kHz: small enough to stay responsive. */
const CHUNK_FRAMES = 1365;

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkFrames = (options && options.processorOptions && options.processorOptions.chunkFrames) || ${CHUNK_FRAMES};
    this.buffer = new Float32Array(this.chunkFrames);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // No input yet (or the track ended): keep the processor alive regardless.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.offset] = channel[i];
      this.offset += 1;
      if (this.offset === this.chunkFrames) {
        // Convert on the audio thread so the main thread only sees bytes.
        const pcm = new Int16Array(this.chunkFrames);
        for (let j = 0; j < this.chunkFrames; j += 1) {
          const sample = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm[j] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("keating-pcm-capture", PcmCaptureProcessor);
`;

export const PCM_CAPTURE_PROCESSOR = "keating-pcm-capture";

let moduleUrl: string | null = null;

function workletModuleUrl(): string {
	if (moduleUrl === null) {
		moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
	}
	return moduleUrl;
}

export interface PcmCaptureHandle {
	readonly context: AudioContext;
	readonly stream: MediaStream;
	stop(): void;
}

/** Base64-encode raw PCM bytes for transports that carry audio inside JSON. */
export function encodePcmChunk(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	// Chunked to avoid blowing the argument limit on long buffers.
	const stride = 0x8000;
	for (let i = 0; i < bytes.length; i += stride) {
		binary += String.fromCharCode(...bytes.subarray(i, i + stride));
	}
	return btoa(binary);
}

/**
 * Capture microphone audio as base64 PCM chunks at the requested sample rate.
 * Falls back to a ScriptProcessorNode where AudioWorklet is unavailable.
 */
export async function startPcmCapture(options: {
	sampleRate: number;
	onChunk: (base64: string) => void;
}): Promise<PcmCaptureHandle> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		throw new Error("Microphone unavailable for live voice.");
	}
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	const context = new AudioContext({ sampleRate: options.sampleRate });
	const source = context.createMediaStreamSource(stream);

	let disposed = false;
	let teardown = () => {};

	if (context.audioWorklet) {
		await context.audioWorklet.addModule(workletModuleUrl());
		const node = new AudioWorkletNode(context, PCM_CAPTURE_PROCESSOR, {
			numberOfInputs: 1,
			// AudioWorklet processors are only pulled when they participate in an
			// active output graph. Keep one silent output connected to the
			// destination so microphone frames continue to reach the port without
			// echoing the microphone back to the learner.
			numberOfOutputs: 1,
			processorOptions: { chunkFrames: CHUNK_FRAMES },
		});
		const silentOutput = context.createGain();
		silentOutput.gain.value = 0;
		node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
			if (!disposed) options.onChunk(encodePcmChunk(event.data));
		};
		source.connect(node);
		node.connect(silentOutput);
		silentOutput.connect(context.destination);
		teardown = () => {
			node.port.onmessage = null;
			try { node.disconnect(); } catch {}
			try { silentOutput.disconnect(); } catch {}
		};
	} else {
		const processor = context.createScriptProcessor(4096, 1, 1);
		processor.onaudioprocess = (event) => {
			if (disposed) return;
			const input = event.inputBuffer.getChannelData(0);
			const pcm = new Int16Array(input.length);
			for (let i = 0; i < input.length; i += 1) {
				const sample = Math.max(-1, Math.min(1, input[i]));
				pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
			}
			options.onChunk(encodePcmChunk(pcm.buffer));
		};
		source.connect(processor);
		// A ScriptProcessorNode only runs while connected to a destination; the
		// output buffer is left silent so the mic is not echoed back.
		processor.connect(context.destination);
		teardown = () => {
			processor.onaudioprocess = null;
			try { processor.disconnect(); } catch {}
		};
	}

	return {
		context,
		stream,
		stop() {
			if (disposed) return;
			disposed = true;
			teardown();
			try { source.disconnect(); } catch {}
			try { void context.close(); } catch {}
			stream.getTracks().forEach((track) => track.stop());
		},
	};
}
