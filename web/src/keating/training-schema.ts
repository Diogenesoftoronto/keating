import { z } from "zod";

export const TrainingMessageSchema = z.object({
	role: z.enum(["system", "user", "assistant"]),
	content: z.string(),
}).strict();

export const TrainingQualitySchema = z.object({
	status: z.enum(["accepted", "unscored", "review", "rejected", "reference"]),
	recommendedForSft: z.boolean(),
	scored: z.boolean(),
	reward: z.number().min(0).max(1).optional(),
	signals: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const CanonicalTrainingRecordSchema = z.object({
	schemaVersion: z.literal(2),
	id: z.string().min(1),
	split: z.enum(["train", "validation"]),
	task: z.enum(["supervised-finetuning", "preference-learning", "reference"]),
	source: z.object({
		type: z.enum(["artifact", "session", "sandbox"]),
		kind: z.string().min(1),
		topic: z.string().optional(),
		sessionId: z.string().optional(),
		sessionTitle: z.string().optional(),
		messageTimestamp: z.number().optional(),
		model: z.unknown().optional(),
		thinkingLevel: z.string().optional(),
		path: z.string().optional(),
		commitId: z.string().optional(),
	}).strict(),
	messages: z.array(TrainingMessageSchema).min(2),
	prompt: z.array(TrainingMessageSchema).min(1),
	completion: z.string().min(1),
	quality: TrainingQualitySchema,
	metrics: z.object({
		promptCharacters: z.number().int().nonnegative(),
		completionCharacters: z.number().int().positive(),
		messageCount: z.number().int().min(2),
	}).strict(),
}).strict();

export type CanonicalTrainingRecord = z.infer<typeof CanonicalTrainingRecordSchema>;
export type TrainingQualityStatus = CanonicalTrainingRecord["quality"]["status"];

export const TrainingManifestSchema = z.object({
	schemaVersion: z.literal(2),
	mode: z.literal("finetune"),
	generatedAt: z.string().datetime(),
	source: z.enum(["all", "artifacts", "sessions", "sandbox"]),
	format: z.enum(["chatml", "alpaca", "both"]),
	redactionEnabled: z.boolean(),
	minimumAssistantCharacters: z.number().int().positive(),
	judgeScoringEnabled: z.boolean(),
	recommendedDataset: z.string().min(1),
	splitStrategy: z.string().min(1),
	counts: z.object({
		artifactsRead: z.number().int().nonnegative(),
		sessionsRead: z.number().int().nonnegative(),
		sandboxFilesRead: z.number().int().nonnegative(),
		sandboxCommitsRead: z.number().int().nonnegative(),
		examplesWritten: z.number().int().nonnegative(),
		canonicalRecords: z.number().int().nonnegative(),
		trainRecords: z.number().int().nonnegative(),
		validationRecords: z.number().int().nonnegative(),
		sftExcluded: z.number().int().nonnegative(),
		duplicatesRemoved: z.number().int().nonnegative(),
		skipped: z.number().int().nonnegative(),
		redactions: z.number().int().nonnegative(),
		rewardedLines: z.number().int().nonnegative(),
		ktoLines: z.number().int().nonnegative(),
		preferenceLines: z.number().int().nonnegative(),
		dpoTextLines: z.number().int().nonnegative(),
		grpoPromptLines: z.number().int().nonnegative(),
	}).strict(),
	quality: z.object({
		accepted: z.number().int().nonnegative(),
		unscored: z.number().int().nonnegative(),
		review: z.number().int().nonnegative(),
		rejected: z.number().int().nonnegative(),
		reference: z.number().int().nonnegative(),
	}).strict(),
	rewardStats: z.unknown().optional(),
	warnings: z.array(z.string()),
}).passthrough();

export type TrainingManifest = z.infer<typeof TrainingManifestSchema>;

export function canonicalTrainingRecordJsonSchema(): Record<string, unknown> {
	return z.toJSONSchema(CanonicalTrainingRecordSchema, {
		target: "draft-2020-12",
		unrepresentable: "any",
	});
}
