import Fuse from "fuse.js";

export type SearchText = string | null | undefined;

interface SearchDocument<T> {
	item: T;
	index: number;
	text: string;
}

/**
 * Fuzzy full-text search with AND semantics across whitespace-delimited terms.
 * Each term may match any indexed field, so word order does not affect results.
 */
export function searchFullText<T>(
	items: readonly T[],
	query: string,
	getText: (item: T) => readonly SearchText[],
): T[] {
	const terms = Array.from(
		new Set(
			query
				.trim()
				.split(/\s+/)
				.map((term) => term.toLocaleLowerCase())
				.filter(Boolean),
		),
	);
	if (terms.length === 0) return [...items];

	const documents: SearchDocument<T>[] = items.map((item, index) => ({
		item,
		index,
		text: getText(item).filter((value): value is string => Boolean(value)).join(" "),
	}));
	const index = new Fuse(documents, {
		keys: ["text"],
		includeScore: true,
		ignoreLocation: true,
		threshold: 0.4,
	});

	let matches: Map<number, { document: SearchDocument<T>; score: number }> | undefined;
	for (const term of terms) {
		const termMatches = new Map(
			index.search(term).map((result) => [
				result.item.index,
				{ document: result.item, score: result.score ?? 0 },
			]),
		);
		if (!matches) {
			matches = termMatches;
			continue;
		}

		for (const [itemIndex, match] of matches) {
			const next = termMatches.get(itemIndex);
			if (!next) matches.delete(itemIndex);
			else match.score += next.score;
		}
		if (matches.size === 0) return [];
	}

	return [...(matches?.values() ?? [])]
		.sort((left, right) => left.score - right.score || left.document.index - right.document.index)
		.map(({ document }) => document.item);
}
