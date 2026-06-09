/**
 * Pure string-based source edit engine for property testing.
 * No filesystem or NodePod dependencies — just string → string transformations.
 */

export interface StringEdit {
	search: string;
	replace: string;
	reason?: string;
}

export interface StringEditResult {
	success: boolean;
	message: string;
	diff?: {
		linesRemoved: number;
		linesAdded: number;
		charDelta: number;
	};
}

/**
 * Apply a search/replace to a string, matching the exact algorithm used
 * by both CLI `applySourceEdit` and NodePod `nodePodApplyEdit`.
 */
export function applyStringEdit(
	content: string,
	edit: StringEdit
): StringEditResult {
	const searchNormalized = edit.search.replace(/\r\n/g, "\n");
	const contentNormalized = content.replace(/\r\n/g, "\n");

	if (!contentNormalized.includes(searchNormalized)) {
		return {
			success: false,
			message: `Search block not found. Ensure exact match including indentation and newlines.`,
		};
	}

	const occurrences = contentNormalized.split(searchNormalized).length - 1;
	if (occurrences > 1) {
		return {
			success: false,
			message: `Search block appears ${occurrences} times — rejected for safety. Include more context to make it unique.`,
		};
	}

	const output = contentNormalized.replace(searchNormalized, edit.replace);
	return {
		success: true,
		message: `Edited: replaced ${searchNormalized.split("\n").length} lines with ${edit.replace.split("\n").length} lines`,
		diff: {
			linesRemoved: searchNormalized.split("\n").length,
			linesAdded: edit.replace.split("\n").length,
			charDelta: edit.replace.length - searchNormalized.length,
		},
	};
}

/**
 * Compute diff between two strings line-by-line.
 */
export interface LineDiff {
	lineNumber: number;
	type: "removed" | "added" | "unchanged";
	content: string;
}

export function diffStrings(baseline: string, current: string): LineDiff[] {
	const base = baseline.replace(/\r\n/g, "\n").split("\n");
	const curr = current.replace(/\r\n/g, "\n").split("\n");
	const diffs: LineDiff[] = [];
	let i = 0;
	let j = 0;

	while (i < base.length || j < curr.length) {
		if (i < base.length && j < curr.length && base[i] === curr[j]) {
			diffs.push({ lineNumber: i + 1, type: "unchanged", content: base[i] });
			i++;
			j++;
		} else if (i < base.length && (!curr[j] || base[i] !== curr[j])) {
			// Try to find base[i] later in curr
			const matchInCurr = curr.slice(j).findIndex((l) => l === base[i]);
			if (matchInCurr === -1 || matchInCurr > 3) {
				diffs.push({ lineNumber: i + 1, type: "removed", content: base[i] });
				i++;
			} else {
				// Lines were added in between
				for (let k = 0; k < matchInCurr; k++) {
					diffs.push({ lineNumber: j + 1, type: "added", content: curr[j + k] });
				}
				j += matchInCurr;
			}
		} else {
			diffs.push({ lineNumber: j + 1, type: "added", content: curr[j] });
			j++;
		}
	}

	return diffs;
}

/**
 * Check whether a file path is within the mutable source allowlist.
 */
const MUTABLE_PATTERNS = [
	/src\/core\/(lesson-plan|benchmark|animation|topics|map|policy|mutation|map-elites|prompt-evolution)\.ts$/,
	/pi\/prompts\/.*\.md$/,
];

const IMMUTABLE_PATTERNS = [
	/src\/core\/(self-improve|types|config|paths|random)\.ts$/,
];

export function isMutablePath(path: string): boolean {
	if (IMMUTABLE_PATTERNS.some((p) => p.test(path))) return false;
	return MUTABLE_PATTERNS.some((p) => p.test(path));
}

/**
 * Build a search block from a known single line in context.
 */
export function buildSearchBlock(content: string, targetLine: string, contextLines = 2): string | null {
	const normalized = content.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	const index = lines.findIndex((l) => l === targetLine);
	if (index === -1) return null;
	const start = Math.max(0, index - contextLines);
	const end = Math.min(lines.length, index + contextLines + 1);
	return lines.slice(start, end).join("\n");
}
