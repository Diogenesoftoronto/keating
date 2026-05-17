import {
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";

const SUPERTONIC_HF_BASE = "https://huggingface.co/Supertone/supertonic-3/resolve/main";
const SUPERTONIC_FILES = {
	textEncoder: `${SUPERTONIC_HF_BASE}/onnx/text_encoder.onnx`,
	durationPredictor: `${SUPERTONIC_HF_BASE}/onnx/duration_predictor.onnx`,
	vectorEstimator: `${SUPERTONIC_HF_BASE}/onnx/vector_estimator.onnx`,
	vocoder: `${SUPERTONIC_HF_BASE}/onnx/vocoder.onnx`,
	ttsConfig: `${SUPERTONIC_HF_BASE}/onnx/tts.json`,
	unicodeIndexer: `${SUPERTONIC_HF_BASE}/onnx/unicode_indexer.json`,
} as const;

const SUPERTONIC_VOICES = [
	"M1", "M2", "M3", "F1", "F2", "F3",
];

const SUPERTONIC_MODELS = [
	{ value: "supertonic-3", label: "Supertonic-3 (local, ONNX)" },
];

interface SupertonicSessionBundle {
	textEncoder: any;
	durationPredictor: any;
	vectorEstimator: any;
	vocoder: any;
	ttsConfig: unknown;
	unicodeIndexer: unknown;
}

let sessionPromise: Promise<SupertonicSessionBundle> | null = null;

async function loadSupertonic(): Promise<SupertonicSessionBundle> {
	if (sessionPromise) return sessionPromise;
	sessionPromise = (async () => {
		// @ts-expect-error - onnxruntime-web ships types but they're not resolvable via package "exports"
		const ort = await import("onnxruntime-web");
		const [textEncoderBuf, durationBuf, vectorBuf, vocoderBuf, ttsJson, indexerJson] = await Promise.all([
			fetch(SUPERTONIC_FILES.textEncoder).then((r) => r.arrayBuffer()),
			fetch(SUPERTONIC_FILES.durationPredictor).then((r) => r.arrayBuffer()),
			fetch(SUPERTONIC_FILES.vectorEstimator).then((r) => r.arrayBuffer()),
			fetch(SUPERTONIC_FILES.vocoder).then((r) => r.arrayBuffer()),
			fetch(SUPERTONIC_FILES.ttsConfig).then((r) => r.json()),
			fetch(SUPERTONIC_FILES.unicodeIndexer).then((r) => r.json()),
		]);

		const opts = { executionProviders: ["wasm"] as const };
		const [textEncoder, durationPredictor, vectorEstimator, vocoder] = await Promise.all([
			ort.InferenceSession.create(textEncoderBuf, opts),
			ort.InferenceSession.create(durationBuf, opts),
			ort.InferenceSession.create(vectorBuf, opts),
			ort.InferenceSession.create(vocoderBuf, opts),
		]);

		return {
			textEncoder,
			durationPredictor,
			vectorEstimator,
			vocoder,
			ttsConfig: ttsJson,
			unicodeIndexer: indexerJson,
		};
	})().catch((err) => {
		sessionPromise = null;
		throw err;
	});
	return sessionPromise;
}

async function synthesize(_request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	// Eagerly trigger the ONNX download/load so the user can see progress in the network panel
	// and so subsequent calls hit a warm cache. The full text -> mel -> wav pipeline is not yet
	// implemented in JS because Supertonic ships its preprocessing only in the Python
	// `supertonic` package; reproducing it (unicode_indexer, duration alignment, voice-style
	// conditioning, vocoder windowing) needs a focused follow-up.
	await loadSupertonic().catch((err) => {
		throw new Error(`Supertonic-3 ONNX load failed: ${err instanceof Error ? err.message : String(err)}`);
	});

	throw new Error(
		"Supertonic-3 local synthesis is not yet wired in browser. The ONNX sessions load successfully, " +
			"but the text-encoder → duration-predictor → vector-estimator → vocoder pipeline needs to be " +
			"ported from the Python `supertonic` package. Pick another provider for now.",
	);
}

export const supertonicProvider: SpeechProvider = {
	id: "supertonic-3",
	label: "Supertonic-3 (local)",
	kind: "tts",
	status: "experimental",
	description:
		"Local on-device TTS via ONNX Runtime Web. ~400MB download (4 model files). Synthesis pipeline is pending — sessions load but text→audio is not wired yet.",
	models: SUPERTONIC_MODELS,
	voices: SUPERTONIC_VOICES,
	synthesize,
};

export const SUPERTONIC_FILE_URLS = SUPERTONIC_FILES;
