import { getModel, type Api, type Context, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai/compat";
import { hybridStreamFn } from "../hooks/keating-stream";
import { judgeComposite, type ExportJudge, type JudgeScore, type RewardedTurn } from "./reward";

const RUBRIC_PROMPT = `Evaluate the assistant response as teaching data.
These are rubric estimates of teaching behavior, not measurements of learner outcomes.
Score each metric from 0.0 to 1.0:
- masteryGain: did the response support conceptual understanding?
- retention: did it support retrieval practice or memory structure?
- engagement: did it invite attention and learner agency?
- transfer: did it help the learner apply the idea elsewhere?
- confusion: did it introduce ambiguity, errors, or cognitive overload?

Return only JSON with numeric fields:
{"masteryGain":0,"retention":0,"engagement":0,"transfer":0,"confusion":0}`;

export function parseJudgeScore(text: string): JudgeScore | null {
	const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
	try {
		const value = JSON.parse(cleaned) as Partial<JudgeScore>;
		if (!value || ["masteryGain", "retention", "engagement", "transfer", "confusion"].some((key) => typeof value[key as keyof JudgeScore] !== "number")) return null;
		const score: JudgeScore = {
			masteryGain: Number(value.masteryGain),
			retention: Number(value.retention),
			engagement: Number(value.engagement),
			transfer: Number(value.transfer),
			confusion: Number(value.confusion),
		};
		if (Object.values(score).some((item) => !Number.isFinite(item))) return null;
		return {
			masteryGain: Math.max(0, Math.min(1, score.masteryGain)),
			retention: Math.max(0, Math.min(1, score.retention)),
			engagement: Math.max(0, Math.min(1, score.engagement)),
			transfer: Math.max(0, Math.min(1, score.transfer)),
			confusion: Math.max(0, Math.min(1, score.confusion)),
		};
	} catch {
		return null;
	}
}

function examplePrompt(turn: RewardedTurn): string {
	return JSON.stringify({
		context: turn.context,
		completion: turn.completion,
	}, null, 2);
}

export function createKeatingExportJudge({
	model = getModel("google", "gemini-3-flash-preview") as Model<Api>,
	maxExamples = 200,
	thinkingLevel = "minimal",
	streamFn = hybridStreamFn,
}: {
	model?: Model<Api>;
	maxExamples?: number;
	thinkingLevel?: ModelThinkingLevel;
	/** Injectable transport for deterministic verification without provider calls. */
	streamFn?: typeof hybridStreamFn;
} = {}): ExportJudge {
	return async (examples) => {
		const results: Array<JudgeScore | null> = [];
		for (const example of examples.slice(0, maxExamples)) {
			try {
				const context: Context = {
					systemPrompt: RUBRIC_PROMPT,
					messages: [{
						role: "user",
						timestamp: Date.now(),
						content: examplePrompt(example),
					}],
				};
				const stream = await streamFn(model, context, {
					temperature: 0,
					maxTokens: thinkingLevel === "off" || thinkingLevel === "minimal" ? 512 : Math.min(model.maxTokens, 16384),
					reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
				});
				const message = await stream.result();
				const text = message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n");
				const score = parseJudgeScore(text);
				if (score) judgeComposite(score);
				results.push(score);
			} catch {
				results.push(null);
			}
		}
		while (results.length < examples.length) results.push(null);
		return results;
	};
}


export interface JudgeScorerConfig {
	model: Model<Api>;
	thinkingLevel: ModelThinkingLevel;
	maxTokens: number;
	temperature: number;
	timeoutMs: number;
	retries: number;
}

export interface JudgeProgress {
	total: number;
	completed: number;
	scored: number;
	failed: number;
	cached: number;
	fallbackScored: number;
	paused: boolean;
}

export interface JudgeCheckpoint {
	score: JudgeScore;
	provider: string;
	model: string;
	thinkingLevel: ModelThinkingLevel;
	fallback: boolean;
	scoredAt: number;
}

export interface ResumableExportJudgeOptions {
	primary: JudgeScorerConfig;
	fallback?: JudgeScorerConfig;
	maxExamples?: number;
	signal?: AbortSignal;
	onProgress?: (progress: JudgeProgress) => void;
	onPartial?: (scores: Array<JudgeScore | null>) => void;
	onCheckpoint?: (key: string, checkpoint: JudgeCheckpoint) => void;
	cache: {
		get(key: string): Promise<JudgeCheckpoint | null>;
		set(key: string, checkpoint: JudgeCheckpoint): Promise<void>;
	};
	streamFn?: typeof hybridStreamFn;
}

async function checkpointKey(turn: RewardedTurn, primary: JudgeScorerConfig): Promise<string> {
	const identity = JSON.stringify({
		version: "keating-judge-v1",
		rubric: RUBRIC_PROMPT,
		prompt: examplePrompt(turn),
		primary: {
			provider: primary.model.provider,
			model: primary.model.id,
			thinkingLevel: primary.thinkingLevel,
			maxTokens: primary.maxTokens,
			temperature: primary.temperature,
		},
	});
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Successful checkpoints contain only a hash, scores, and scorer provenance. */
export function createResumableExportJudge({
	primary, fallback, maxExamples = Number.MAX_SAFE_INTEGER, signal,
	onProgress, onPartial, onCheckpoint, cache, streamFn = hybridStreamFn,
}: ResumableExportJudgeOptions): ExportJudge {
	const attempt = async (turn: RewardedTurn, config: JudgeScorerConfig): Promise<JudgeScore | null> => {
		if (signal?.aborted) return null;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stop: () => void = () => {};
		const cancelled = new Promise<null>((resolve) => {
			stop = () => { controller.abort(); resolve(null); };
			signal?.addEventListener("abort", stop, { once: true });
			timer = setTimeout(stop, Math.max(1, config.timeoutMs));
		});
		try {
			const request = (async () => {
				const stream = await streamFn(config.model, {
					systemPrompt: RUBRIC_PROMPT,
					messages: [{ role: "user", timestamp: Date.now(), content: examplePrompt(turn) }],
				}, {
					temperature: config.temperature,
					maxTokens: config.maxTokens,
					reasoning: config.thinkingLevel === "off" ? undefined : config.thinkingLevel,
					signal: controller.signal,
				});
				const message = await stream.result();
				return parseJudgeScore(message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
			})().catch(() => null);
			return await Promise.race([request, cancelled]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", stop);
		}
	};
	return async (examples) => {
		const eligible = examples.slice(0, Math.max(0, Math.floor(maxExamples)));
		const results: Array<JudgeScore | null> = examples.map(() => null);
		const progress: JudgeProgress = { total: eligible.length, completed: 0, scored: 0, failed: 0, cached: 0, fallbackScored: 0, paused: false };
		const publish = () => { onProgress?.({ ...progress }); onPartial?.([...results]); };
		const keys = await Promise.all(eligible.map((turn) => checkpointKey(turn, primary)));
		const checkpoints = new Map<string, JudgeCheckpoint>();
		const apply = (index: number, checkpoint: JudgeCheckpoint, cached: boolean) => {
			results[index] = checkpoint.score;
			progress.completed += 1;
			progress.scored += 1;
			if (cached) progress.cached += 1;
			if (checkpoint.fallback) progress.fallbackScored += 1;
			onCheckpoint?.(keys[index], checkpoint);
			publish();
		};
		// Hydrate all existing scores first, even when paused, to keep the partial
		// result aligned and available without any provider calls.
		for (let index = 0; index < keys.length; index += 1) {
			const checkpoint = checkpoints.get(keys[index]) ?? await cache.get(keys[index]);
			if (checkpoint && parseJudgeScore(JSON.stringify(checkpoint.score))) {
				checkpoints.set(keys[index], checkpoint);
				apply(index, checkpoint, true);
			}
		}
		publish();
		for (let index = 0; index < eligible.length; index += 1) {
			if (results[index]) continue;
			if (signal?.aborted) break;
			const reused = checkpoints.get(keys[index]);
			if (reused) { apply(index, reused, true); continue; }
			let checkpoint: JudgeCheckpoint | null = null;
			for (const [config, isFallback] of [[primary, false], ...(fallback ? [[fallback, true]] : [])] as Array<[JudgeScorerConfig, boolean]>) {
				const retries = Math.min(3, Math.max(0, Math.floor(config.retries) || 0));
				for (let retry = 0; retry <= retries; retry += 1) {
					if (signal?.aborted) break;
					const score = await attempt(eligible[index], config);
					if (score) {
						checkpoint = { score, provider: config.model.provider, model: config.model.id, thinkingLevel: config.thinkingLevel, fallback: isFallback, scoredAt: Date.now() };
						break;
					}
				}
				if (checkpoint || signal?.aborted) break;
			}
			if (checkpoint) {
				await cache.set(keys[index], checkpoint);
				checkpoints.set(keys[index], checkpoint);
				apply(index, checkpoint, false);
			} else if (!signal?.aborted) {
				progress.completed += 1;
				progress.failed += 1;
				publish();
			}
		}
		progress.paused = Boolean(signal?.aborted && progress.completed < progress.total);
		publish();
		return results;
	};
}
