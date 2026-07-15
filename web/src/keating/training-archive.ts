import { strToU8, zipSync } from "fflate";
import type { WebFineTuneExportResult } from "./export";
import {
	canonicalTrainingRecordJsonSchema,
	TrainingManifestSchema,
	type TrainingManifest,
} from "./training-schema";

interface TrainingFile {
	path: string;
	purpose: string;
	content: string;
	records?: number;
}

export interface WebTrainingArchive {
	bytes: Uint8Array;
	filename: string;
	files: Array<Omit<TrainingFile, "content">>;
}

function lineCount(content: string): number {
	return content.trim() ? content.trim().split("\n").length : 0;
}

function addJsonl(
	files: TrainingFile[],
	path: string,
	purpose: string,
	content: string | undefined,
): void {
	if (!content) return;
	files.push({ path, purpose, content, records: lineCount(content) });
}

function trainingRecordSchema(): string {
	return `${JSON.stringify(canonicalTrainingRecordJsonSchema(), null, 2)}\n`;
}

function buildDataCard(manifest: TrainingManifest, files: TrainingFile[]): string {
	const counts = manifest.counts ?? {};
	const quality = manifest.quality ?? {};
	const fileRows = files
		.map((file) => `| \`${file.path}\` | ${file.records ?? "n/a"} | ${file.purpose} |`)
		.join("\n");
	return `# Keating training export

This bundle separates captured evidence from trainer-specific compatibility files. Start with \`data/keating.training.jsonl\`: it preserves provenance, full prompt context, model and thinking metadata, quality signals, deterministic split assignment, and character counts for every record.

## Dataset summary

- Generated: ${manifest.generatedAt ?? "unknown"}
- Source selection: ${manifest.source ?? "unknown"}
- Canonical records: ${counts.canonicalRecords ?? 0}
- SFT-compatible examples: ${counts.examplesWritten ?? 0}
- Train / validation: ${counts.trainRecords ?? 0} / ${counts.validationRecords ?? 0}
- Exact duplicates removed: ${counts.duplicatesRemoved ?? 0}
- Responses excluded from SFT because of low scores: ${counts.sftExcluded ?? 0}
- Redactions applied: ${counts.redactions ?? 0}

## Quality labels

- \`accepted\` (${quality.accepted ?? 0}): suitable for supervised fine-tuning.
- \`unscored\` (${quality.unscored ?? 0}): retained with full context, but should be reviewed before high-stakes training.
- \`review\` (${quality.review ?? 0}): has mixed or middling evidence and is excluded from SFT compatibility files.
- \`rejected\` (${quality.rejected ?? 0}): negative training evidence. Use for KTO or preference learning, not as a positive SFT completion.
- \`reference\` (${quality.reference ?? 0}): sandbox source or checkpoint context. It is preserved for analysis and is not recommended as direct SFT data.

## Files

| Path | Records | Use |
| --- | ---: | --- |
${fileRows}

## Recommended workflow

1. Validate \`data/keating.training.jsonl\` against \`schemas/keating-training-record.schema.json\`.
2. Review records where \`quality.recommendedForSft\` is false.
3. Use ChatML or Alpaca files for SFT only after reviewing unscored examples.
4. Use KTO and DPO files for preference training. Rejected completions are intentionally kept out of SFT files.
5. Keep records with the same session or source in one split. Keating assigns splits from a stable source-group hash to reduce leakage.

## Privacy

Redaction was ${manifest.redactionEnabled ? "enabled" : "disabled"}. Pattern-based redaction cannot guarantee removal of every personal or confidential value. Inspect the canonical file before sharing or uploading it.
`;
}

function archiveTimestamp(generatedAt: unknown): string {
	const parsed = typeof generatedAt === "string" ? new Date(generatedAt) : new Date();
	const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
	return safe.toISOString().replace(/[:.]/g, "-");
}

export function buildWebTrainingArchive(result: WebFineTuneExportResult): WebTrainingArchive {
	const files: TrainingFile[] = [];
	addJsonl(files, "data/keating.training.jsonl", "Canonical, information-rich records. Start here.", result.canonicalJsonl);
	addJsonl(files, "data/sft/train.chatml.jsonl", "ChatML compatibility data for supervised fine-tuning.", result.chatmlJsonl);
	addJsonl(files, "data/sft/train.alpaca.jsonl", "Alpaca compatibility data for supervised fine-tuning.", result.alpacaJsonl);
	addJsonl(files, "data/rewards/train.rewarded.jsonl", "Per-turn rewards and their source signals.", result.rewardedJsonl);
	addJsonl(files, "data/preferences/train.kto.jsonl", "Binary desirable and undesirable KTO examples.", result.ktoJsonl);
	addJsonl(files, "data/preferences/train.dpo.chat.jsonl", "Chat-array DPO preference pairs.", result.preferenceJsonl);
	addJsonl(files, "data/preferences/train.dpo.text.jsonl", "Text-prompt DPO preference pairs.", result.dpoTextJsonl);
	addJsonl(files, "data/rl/prompts.grpo.jsonl", "Unique prompt contexts for GRPO-style generation.", result.grpoPromptsJsonl);

	const schema = trainingRecordSchema();
	files.push({
		path: "schemas/keating-training-record.schema.json",
		purpose: "JSON Schema for each canonical JSONL record.",
		content: schema,
	});

	const manifest = TrainingManifestSchema.parse(JSON.parse(result.manifestJson));
	const fileCatalog = files.map(({ path, purpose, records }) => ({ path, purpose, records }));
	const dataCard = buildDataCard(manifest, files);
	files.unshift({ path: "README.md", purpose: "Dataset card and training guidance.", content: dataCard });
	fileCatalog.unshift({ path: "README.md", purpose: "Dataset card and training guidance.", records: undefined });
	const enrichedManifest = { ...manifest, files: fileCatalog };
	files.unshift({
		path: "manifest.json",
		purpose: "Machine-readable export settings, counts, quality summary, and file catalog.",
		content: `${JSON.stringify(enrichedManifest, null, 2)}\n`,
	});

	const zipped = zipSync(Object.fromEntries(files.map((file) => [file.path, strToU8(file.content)])), { level: 6 });
	return {
		bytes: zipped,
		filename: `keating-training-${archiveTimestamp(enrichedManifest.generatedAt)}.zip`,
		files: files.map(({ content: _content, ...file }) => file),
	};
}
