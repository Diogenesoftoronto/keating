export interface TrainingRecordSummary {
	text: string;
	recordId: string;
	contentFingerprint: string;
	createdAt: string;
	model: { provider: string; id: string; thinkingLevel: string };
}

export function parseTrainingSummary(text: string): string {
	const result = text.trim();
	if (!result || result.length > 6000) throw new Error("The model returned an empty or oversized summary. Your previous summary is preserved.");
	return result;
}

export interface TrainingRecordAnnotation {
	id: string;
	recordId: string;
	contentFingerprint: string;
	quote: string;
	note: string;
	suggestedAlternative?: string;
	origin: "human" | "model";
	status: "draft" | "accepted" | "rejected";
	createdAt: string;
	model?: { provider: string; id: string; thinkingLevel: string };
}

export async function trainingContentFingerprint(prompt: unknown, completion: string): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify({ prompt, completion }));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function parseTrainingAnnotations(text: string, completion: string): Array<{ quote: string; note: string; suggestedAlternative?: string }> {
	const parsed: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
	if (!Array.isArray(parsed) || parsed.length > 20) throw new Error("Review must contain a JSON array of at most 20 notes.");
	return parsed.map((value: unknown) => {
		if (!value || typeof value !== "object") throw new Error("The model returned an invalid note.");
		const item = value as Record<string, unknown>;
		if (typeof item.quote !== "string" || !item.quote.trim() || !completion.includes(item.quote)) throw new Error("A model note quotes text that is absent from this response. No drafts were added.");
		if (typeof item.note !== "string" || !item.note.trim() || item.note.length > 6000) throw new Error("The model returned an invalid review note.");
		if (item.suggestedAlternative !== undefined && (typeof item.suggestedAlternative !== "string" || item.suggestedAlternative.length > 12000)) throw new Error("The model returned an invalid alternative.");
		return { quote: item.quote, note: item.note, suggestedAlternative: item.suggestedAlternative as string | undefined };
	});
}
