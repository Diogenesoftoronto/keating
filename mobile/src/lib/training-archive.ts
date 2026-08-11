import { strToU8, zipSync } from "fflate";
import type { NativeFineTuneExportResult } from "./training-export";

interface TrainingFile {
  path: string;
  purpose: string;
  content: string;
  records?: number;
}

export interface NativeTrainingArchive {
  bytes: Uint8Array;
  filename: string;
  files: Array<Omit<TrainingFile, "content">>;
}

function lineCount(content: string | undefined): number {
  return content?.trim() ? content.trim().split("\n").length : 0;
}

function addJsonl(files: TrainingFile[], path: string, purpose: string, content: string | undefined): void {
  if (!content) return;
  files.push({ path, purpose, content, records: lineCount(content) });
}

function canonicalSchema(): string {
  return `${JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "id", "split", "task", "source", "messages", "prompt", "completion", "quality", "metrics"],
    properties: {
      schemaVersion: { const: 2 },
      id: { type: "string", minLength: 1 },
      split: { enum: ["train", "validation"] },
      task: { enum: ["supervised-finetuning", "preference-learning", "reference"] },
      source: { type: "object" },
      messages: { type: "array", minItems: 2 },
      prompt: { type: "array", minItems: 1 },
      completion: { type: "string", minLength: 1 },
      quality: { type: "object" },
      metrics: { type: "object" },
    },
  }, null, 2)}\n`;
}

function buildReadme(manifest: Record<string, any>, files: readonly TrainingFile[]): string {
  const counts = manifest.counts ?? {};
  const quality = manifest.quality ?? {};
  const rows = files.map((file) => `| \`${file.path}\` | ${file.records ?? "n/a"} | ${file.purpose} |`).join("\n");
  return `# Keating training export

Start with \`data/keating.training.jsonl\`. It preserves source provenance, prompt context, model identity, explicit quality signals, deterministic split assignment, and character counts. Compatibility files are derived views.

## Dataset summary

- Generated: ${manifest.generatedAt ?? "unknown"}
- Canonical records: ${counts.canonicalRecords ?? 0}
- SFT-compatible examples: ${counts.examplesWritten ?? 0}
- Train / validation: ${counts.trainRecords ?? 0} / ${counts.validationRecords ?? 0}
- Exact duplicates removed: ${counts.duplicatesRemoved ?? 0}
- Responses excluded from SFT: ${counts.sftExcluded ?? 0}
- Redactions applied: ${counts.redactions ?? 0}

## Quality labels

- \`accepted\` (${quality.accepted ?? 0}): an assistant response with explicit helpful feedback; suitable for SFT review.
- \`unscored\` (${quality.unscored ?? 0}): captured responses and generated artifacts without a quality claim; review before training.
- \`rejected\` (${quality.rejected ?? 0}): explicit missed feedback; excluded from positive SFT and retained for KTO/preference learning.
- \`review\` (${quality.review ?? 0}) and \`reference\` (${quality.reference ?? 0}): retained for inspection, not recommended as positive SFT.

## Files

| Path | Records | Use |
| --- | ---: | --- |
${rows}

## Recommended workflow

1. Validate the canonical JSONL against the bundled schema.
2. Review every record whose \`quality.recommendedForSft\` is false.
3. Use ChatML or Alpaca only after reviewing unscored completions.
4. Use KTO and DPO files only where explicit feedback supports the label or preference.
5. Keep source groups in their assigned split to reduce leakage.

## Privacy

Redaction was ${manifest.redactionEnabled ? "enabled" : "disabled"}. Pattern matching cannot guarantee removal of every personal or confidential value. Inspect the canonical file before sharing or uploading it.
`;
}

function archiveTimestamp(generatedAt: unknown): string {
  const date = typeof generatedAt === "string" ? new Date(generatedAt) : new Date();
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().replace(/[:.]/g, "-");
}

export function buildNativeTrainingArchive(result: NativeFineTuneExportResult): NativeTrainingArchive {
  const manifest = JSON.parse(result.manifestJson) as Record<string, any>;
  const files: TrainingFile[] = [];
  addJsonl(files, "data/keating.training.jsonl", "Canonical provenance-rich records; start here.", result.canonicalJsonl);
  addJsonl(files, "data/sft/train.chatml.jsonl", "ChatML compatibility data for supervised fine-tuning.", result.chatmlJsonl);
  addJsonl(files, "data/sft/train.alpaca.jsonl", "Alpaca compatibility data for supervised fine-tuning.", result.alpacaJsonl);
  addJsonl(files, "data/rewards/train.rewarded.jsonl", "Explicitly scored per-turn rewards.", result.rewardedJsonl);
  addJsonl(files, "data/preferences/train.kto.jsonl", "Explicit desirable and undesirable KTO examples.", result.ktoJsonl);
  addJsonl(files, "data/preferences/train.dpo.chat.jsonl", "Explicit chosen/rejected chat preference pairs.", result.preferenceJsonl);
  addJsonl(files, "data/preferences/train.dpo.text.jsonl", "Text-prompt DPO compatibility pairs.", result.dpoTextJsonl);
  addJsonl(files, "data/rl/prompts.grpo.jsonl", "Unique prompt contexts for GRPO-style generation.", result.grpoPromptsJsonl);
  files.push({
    path: "schemas/keating-training-record.schema.json",
    purpose: "JSON Schema for each canonical JSONL record.",
    content: canonicalSchema(),
  });
  files.unshift({ path: "README.md", purpose: "Dataset card and training guidance.", content: buildReadme(manifest, files) });
  const catalog = files.map(({ path, purpose, records }) => ({ path, purpose, records }));
  const enrichedManifest = { ...manifest, files: [{ path: "manifest.json", purpose: "Machine-readable export manifest." }, ...catalog] };
  files.unshift({
    path: "manifest.json",
    purpose: "Machine-readable export settings, counts, quality summary, and file catalog.",
    content: `${JSON.stringify(enrichedManifest, null, 2)}\n`,
  });
  return {
    bytes: zipSync(Object.fromEntries(files.map((file) => [file.path, strToU8(file.content)])), { level: 6 }),
    filename: `keating-training-${archiveTimestamp(manifest.generatedAt)}.zip`,
    files: files.map(({ content: _content, ...file }) => file),
  };
}
