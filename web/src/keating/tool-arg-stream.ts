// Progressive rendering of in-flight tool arguments.
//
// While the model writes an `animate` call, the agent emits `toolcall_delta`
// events carrying raw JSON argument text. That text is incomplete by
// definition — it stops mid-string, sometimes mid-escape-sequence — so it
// cannot be JSON.parse'd. These helpers pull a single string field out of the
// partial text so the authored HTML can be shown as it arrives.

/**
 * Extract the value of a top-level string field from partially-written JSON.
 *
 * Returns the decoded value so far, or null when the field has not started.
 * Handles the truncation cases that matter: a cut mid-escape (`\` or `\uXX`)
 * is dropped rather than mis-decoded.
 */
export function extractPartialJsonString(partialJson: string, field: string): string | null {
	const key = `"${field}"`;
	const keyIndex = partialJson.indexOf(key);
	if (keyIndex === -1) return null;

	// Advance past the key, its colon, and any whitespace to the opening quote.
	let i = keyIndex + key.length;
	while (i < partialJson.length && /\s/.test(partialJson[i])) i++;
	if (partialJson[i] !== ":") return null;
	i++;
	while (i < partialJson.length && /\s/.test(partialJson[i])) i++;
	if (partialJson[i] !== '"') return null;
	i++;

	let out = "";
	while (i < partialJson.length) {
		const ch = partialJson[i];
		if (ch === '"') break; // closing quote — the value is complete
		if (ch !== "\\") {
			out += ch;
			i++;
			continue;
		}
		// Escape sequence; if it is truncated, stop and keep what we have.
		const next = partialJson[i + 1];
		if (next === undefined) break;
		if (next === "u") {
			const hex = partialJson.slice(i + 2, i + 6);
			if (hex.length < 4) break;
			out += String.fromCharCode(parseInt(hex, 16));
			i += 6;
			continue;
		}
		const simple: Record<string, string> = {
			n: "\n",
			t: "\t",
			r: "\r",
			b: "\b",
			f: "\f",
			'"': '"',
			"\\": "\\",
			"/": "/",
		};
		out += simple[next] ?? next;
		i += 2;
	}
	return out;
}

// --- progress channel -------------------------------------------------------
// Mirrors the image progress channel: the agent subscription runs outside
// React, so partial animation source reaches the UI as a window event.

export const ANIMATION_PROGRESS_EVENT = "keating:animation-progress";

export interface AnimationProgressDetail {
	/** Tool call id, so concurrent calls stay separate. */
	callId: string;
	topic?: string;
	/** Authored HTML so far. Empty until the `body` field starts. */
	html: string;
	status: "streaming" | "done";
}

export function emitAnimationProgress(detail: AnimationProgressDetail): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent<AnimationProgressDetail>(ANIMATION_PROGRESS_EVENT, { detail }));
}

/**
 * Accumulates `toolcall_delta` text per content index and reports the authored
 * animation HTML as it grows.
 *
 * Re-rendering an iframe on every token is wasteful, so updates are gated on a
 * minimum growth step — enough to look live without thrashing the sandbox.
 */
export function createAnimationArgAccumulator(minGrowthChars = 400) {
	const buffers = new Map<number, { text: string; name: string; reported: number }>();

	return {
		start(contentIndex: number, name: string) {
			buffers.set(contentIndex, { text: "", name, reported: 0 });
		},
		/** Returns the HTML to render, or null when there is nothing new to show. */
		delta(contentIndex: number, delta: string, name?: string): string | null {
			const entry = buffers.get(contentIndex) ?? { text: "", name: name ?? "", reported: 0 };
			if (name && !entry.name) entry.name = name;
			entry.text += delta;
			buffers.set(contentIndex, entry);
			if (entry.name !== "animate") return null;

			const html = extractPartialJsonString(entry.text, "body");
			if (html === null) return null;
			if (html.length - entry.reported < minGrowthChars) return null;
			entry.reported = html.length;
			return html;
		},
		topic(contentIndex: number): string | undefined {
			const entry = buffers.get(contentIndex);
			if (!entry) return undefined;
			return extractPartialJsonString(entry.text, "topic") ?? undefined;
		},
		end(contentIndex: number) {
			buffers.delete(contentIndex);
		},
		clear() {
			buffers.clear();
		},
	};
}
