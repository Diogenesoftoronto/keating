import type { ProviderModelDescriptor } from "../providers";
import type {
	NormalizedSearchResult,
	SearchCitation,
	SearchResultProvenance,
	SearchRoute,
} from "./types";

export interface SearchProvenanceSignal {
	untrusted: true;
	provider: string;
	modelId: string;
	sourceIds: readonly string[];
	retrievedAt: string;
}

export type SearchProvenanceSignalSink = (signal: SearchProvenanceSignal) => void;

let provenanceSignalSink: SearchProvenanceSignalSink | undefined;

/**
 * Override the browser signal boundary for tests or non-DOM runtimes.
 * Returns a cleanup that only removes the sink installed by this call.
 */
export function setSearchProvenanceSignalSink(sink: SearchProvenanceSignalSink): () => void {
	provenanceSignalSink = sink;
	return () => {
		if (provenanceSignalSink === sink) provenanceSignalSink = undefined;
	};
}

export function signalUntrustedSearchResult(result: NormalizedSearchResult): void {
	const signal: SearchProvenanceSignal = {
		untrusted: true,
		provider: result.provenance.provider,
		modelId: result.provenance.modelId,
		sourceIds: result.citations.map((citation) => citation.id),
		retrievedAt: result.provenance.retrievedAt,
	};
	if (provenanceSignalSink) {
		provenanceSignalSink(signal);
		return;
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("keating:search-provenance", { detail: signal }));
	}
}

/**
 * Conservatively taint a run once provider-hosted search has actually been
 * added to its request. Hosted providers do not expose a uniform result event,
 * so activation is the earliest reliable production boundary shared by all of
 * them. Client adapters should signal their normalized results instead.
 */
export function signalHostedSearchActivation(
	route: SearchRoute,
	retrievedAt = new Date().toISOString(),
): void {
	if (route.kind !== "native") return;
	signalUntrustedSearchResult({
		citations: [],
		provenance: createSearchProvenance(route, retrievedAt),
	});
}

export function createSearchProvenance(
	route: SearchRoute,
	retrievedAt = new Date().toISOString(),
): SearchResultProvenance {
	return {
		provider: route.provider,
		modelId: route.modelId,
		route: route.kind,
		tool: route.tool,
		citationKind: route.citationKind,
		untrusted: true,
		retrievedAt,
	};
}

export interface RawSearchCitation {
	id?: string;
	url?: string;
	uri?: string;
	title?: string;
	snippet?: string;
	text?: string;
	startIndex?: number;
	endIndex?: number;
}

/** Normalize provider annotations, grounding chunks, or adapter results. */
export function normalizeSearchCitations(
	values: readonly RawSearchCitation[],
	provenance: SearchResultProvenance,
): SearchCitation[] {
	const citations: SearchCitation[] = [];
	for (const [index, value] of values.entries()) {
		const url = value.url ?? value.uri;
		if (!url) continue;
		citations.push({
			id: value.id ?? `citation-${index + 1}`,
			url,
			title: value.title,
			snippet: value.snippet ?? value.text,
			startIndex: value.startIndex,
			endIndex: value.endIndex,
			provenance,
		});
	}
	return citations;
}

export function normalizeProviderSearchResult(input: {
	model: ProviderModelDescriptor;
	route: SearchRoute;
	query?: string;
	text?: string;
	citations?: readonly RawSearchCitation[];
	retrievedAt?: string;
}): NormalizedSearchResult {
	const provenance = createSearchProvenance({
		...input.route,
		provider: input.model.provider,
		modelId: input.model.id,
	}, input.retrievedAt);
	const result: NormalizedSearchResult = {
		query: input.query,
		text: input.text,
		citations: normalizeSearchCitations(input.citations ?? [], provenance),
		provenance,
	};
	signalUntrustedSearchResult(result);
	return result;
}
