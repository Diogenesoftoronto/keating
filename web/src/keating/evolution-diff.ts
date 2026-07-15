import { z } from "zod";

export const TeacherPolicySnapshotSchema = z.object({
	name: z.string(),
	analogyDensity: z.number(),
	socraticRatio: z.number(),
	formalism: z.number(),
	retrievalPractice: z.number(),
	exerciseCount: z.number(),
	diagramBias: z.number(),
	reflectionBias: z.number(),
	interdisciplinaryBias: z.number(),
	challengeRate: z.number(),
}).strict();

const PolicyFieldSchema = TeacherPolicySnapshotSchema.keyof();

export const EvolutionParameterDeltaSchema = z.object({
	field: PolicyFieldSchema,
	before: z.union([z.number(), z.string()]),
	after: z.union([z.number(), z.string()]),
	delta: z.number(),
}).strict();

export const EvolutionTraceCandidateSchema = z.object({
	iteration: z.number().int().positive(),
	accepted: z.boolean(),
	novelty: z.number(),
	parentName: z.string().nullable(),
	policy: TeacherPolicySnapshotSchema,
	decision: z.object({
		improves: z.boolean(),
		safe: z.boolean(),
		novelEnough: z.boolean(),
		scoreDelta: z.number(),
		weakestTopicDelta: z.number(),
		reasons: z.array(z.string()),
	}).passthrough(),
	parameterDelta: z.array(EvolutionParameterDeltaSchema),
}).passthrough();

export type TeacherPolicySnapshot = z.infer<typeof TeacherPolicySnapshotSchema>;
export type EvolutionTraceCandidate = z.infer<typeof EvolutionTraceCandidateSchema>;
export type EvolutionPolicyDiff = {
	field: keyof TeacherPolicySnapshot;
	before: number | string | null;
	after: number | string;
	delta: number | null;
};

export type EvolutionDiffResolution =
	| {
		ok: true;
		policy: TeacherPolicySnapshot;
		previousPolicy: TeacherPolicySnapshot | null;
		diff: EvolutionPolicyDiff[];
	}
	| {
		ok: false;
		reason: "invalid-policy" | "invalid-baseline" | "no-changes";
	};

export function parseTeacherPolicySnapshot(value: string): TeacherPolicySnapshot | null {
	try {
		return TeacherPolicySnapshotSchema.parse(JSON.parse(value));
	} catch {
		return null;
	}
}

export function parseEvolutionTrace(value?: string): EvolutionTraceCandidate[] {
	if (!value) return [];
	try {
		return z.array(EvolutionTraceCandidateSchema).parse(JSON.parse(value));
	} catch {
		return [];
	}
}

export function diffTeacherPolicies(
	before: TeacherPolicySnapshot | null,
	after: TeacherPolicySnapshot,
): EvolutionPolicyDiff[] {
	const fields = Object.keys(after) as Array<keyof TeacherPolicySnapshot>;
	return fields.flatMap((field) => {
		const previous = before?.[field] ?? null;
		const next = after[field];
		if (previous === next) return [];
		return [{
			field,
			before: previous,
			after: next,
			delta: typeof previous === "number" && typeof next === "number" ? next - previous : null,
		}];
	});
}

export function resolveEvolutionPolicyDiff(
	currentPolicySource: string,
	previousPolicySource: string | null,
): EvolutionDiffResolution {
	const policy = parseTeacherPolicySnapshot(currentPolicySource);
	if (!policy) return { ok: false, reason: "invalid-policy" };

	const previousPolicy = previousPolicySource
		? parseTeacherPolicySnapshot(previousPolicySource)
		: null;
	if (previousPolicySource && !previousPolicy) {
		return { ok: false, reason: "invalid-baseline" };
	}

	const diff = diffTeacherPolicies(previousPolicy, policy);
	if (diff.length === 0) return { ok: false, reason: "no-changes" };

	return { ok: true, policy, previousPolicy, diff };
}
