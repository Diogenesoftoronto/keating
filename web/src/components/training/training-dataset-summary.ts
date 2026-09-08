import type { WebFineTuneExportResult } from "../../keating/export";
import { CanonicalTrainingRecordSchema } from "../../keating/training-schema";

export interface TrainingDatasetSummaryValue {
	text: string;
	included: boolean;
	createdAt: string;
	model?: { provider: string; id: string; thinkingLevel: string };
}

/** Aggregate every canonical record; never include prompts, completions, or source identifiers. */
export function trainingDatasetSummaryMetadata(bundle: Pick<WebFineTuneExportResult, "canonicalJsonl" | "manifestJson">) {
	const records = (bundle.canonicalJsonl ?? "").split("\n").filter(line => line.trim()).map(line => CanonicalTrainingRecordSchema.parse(JSON.parse(line)));
	const manifest = JSON.parse(bundle.manifestJson) as Record<string, unknown>;
	const sources: Record<string, number> = Object.create(null);
	const kinds: Record<string, number> = Object.create(null);
	const quality: Record<string, number> = Object.create(null);
	const splits: Record<string, number> = Object.create(null);
	const topics = new Map<string, number>();
	let promptTotal = 0, responseTotal = 0, shortest = Infinity, longest = 0, scored = 0;
	for (const record of records) {
		sources[record.source.type] = (sources[record.source.type] ?? 0) + 1;
		kinds[record.source.kind] = (kinds[record.source.kind] ?? 0) + 1;
		quality[record.quality.status] = (quality[record.quality.status] ?? 0) + 1;
		splits[record.split] = (splits[record.split] ?? 0) + 1;
		const length = record.completion.length;
		promptTotal += record.prompt.reduce((sum, message) => sum + message.content.length, 0);
		responseTotal += length; shortest = Math.min(shortest, length); longest = Math.max(longest, length);
		if (record.quality.scored) scored++;
		if (record.source.topic) topics.set(record.source.topic, (topics.get(record.source.topic) ?? 0) + 1);
	}
	const orderedTopics = [...topics.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	return {
		coverage: "All canonical records; composition and quality metadata only. No individual prompts or responses.",
		recordCount: records.length, sources, kinds, quality, splits, scored, unscored: records.length - scored,
		lengths: { unit: "characters", promptTotal, responseTotal, responseMinimum: records.length ? shortest : 0, responseMaximum: longest, responseMean: records.length ? Math.round(responseTotal / records.length) : 0 },
		topics: orderedTopics.slice(0, 30).map(([topic, count]) => ({ topic: topic.slice(0, 240), count })),
		omittedTopicCount: Math.max(0, topics.size - 30), recordsWithoutTopic: records.filter(record => !record.source.topic).length,
		exportSettings: {
			format: manifest.format, source: manifest.source, minimumAssistantCharacters: manifest.minimumAssistantCharacters,
			redactionEnabled: manifest.redactionEnabled, judgeScoringEnabled: manifest.judgeScoringEnabled,
		},
	};
}

export function parseTrainingDatasetSummary(text: string): string {
	const result = text.trim();
	if (!result || result.length > 12000) throw new Error("The model returned an empty or oversized summary. Your existing draft is preserved.");
	return result;
}
