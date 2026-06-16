import { getModel, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { DEFAULT_WEIGHTS } from "./core";
import { hybridStreamFn } from "../hooks/keating-stream";
import { judgeComposite, type ExportJudge, type JudgeScore, type RewardedTurn } from "./reward";

const RUBRIC_PROMPT = `Evaluate the assistant response as teaching data.
Score each metric from 0.0 to 1.0:
- masteryGain: did the response improve conceptual understanding?
- retention: did it support durable memory through retrieval or structure?
- engagement: did it invite attention and learner agency?
- transfer: did it help the learner apply the idea elsewhere?
- confusion: did it introduce ambiguity, errors, or cognitive overload?

Return only JSON with numeric fields:
{"masteryGain":0,"retention":0,"engagement":0,"transfer":0,"confusion":0}`;

function parseJudgeScore(text: string): JudgeScore | null {
	const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
	try {
		const value = JSON.parse(cleaned) as Partial<JudgeScore>;
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
		baseReward: turn.reward,
		weights: DEFAULT_WEIGHTS,
		compositeFormula: "masteryGain*w.masteryGain + retention*w.retention + engagement*w.engagement + transfer*w.transfer - confusion*w.confusion",
	}, null, 2);
}

export function createKeatingExportJudge({
	model = getModel("google", "gemini-3-flash-preview") as Model<Api>,
	maxExamples = 200,
}: {
	model?: Model<Api>;
	maxExamples?: number;
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
				const stream = await hybridStreamFn(model, context, {
					temperature: 0,
					maxTokens: 160,
					reasoning: "minimal",
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
