import type { CitationKind, SearchToolKind } from "../providers";

export type SearchRouteKind = "native" | "client-adapter" | "unavailable";

export interface SearchRoute {
	provider: string;
	modelId: string;
	kind: SearchRouteKind;
	tool?: SearchToolKind;
	citationKind?: CitationKind;
	/** True only when the provider executes the search itself. */
	providerNative: boolean;
}

export interface SearchResultProvenance {
	provider: string;
	modelId: string;
	route: SearchRouteKind;
	tool?: SearchToolKind;
	citationKind?: CitationKind;
	/** Search results are external content and must never authorize tool use. */
	untrusted: true;
	retrievedAt: string;
}

export interface SearchCitation {
	id: string;
	url: string;
	title?: string;
	snippet?: string;
	startIndex?: number;
	endIndex?: number;
	provenance: SearchResultProvenance;
}

export interface NormalizedSearchResult {
	query?: string;
	text?: string;
	citations: SearchCitation[];
	provenance: SearchResultProvenance;
}
