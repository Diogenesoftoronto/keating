import type { KeatingStorage } from "../keating/storage";

/**
 * Visual helpers for the mobile/tablet session card grid. Kept free of React/JSX
 * so the categorisation + sizing logic stays unit-testable.
 */

export type CategoryKey =
	| "science"
	| "physics-math"
	| "history"
	| "cs"
	| "language"
	| "arts"
	| "general";

export interface CategoryMeta {
	key: CategoryKey;
	label: string;
	/** Accent hex used to tint the hero band gradient (theme-agnostic via opacity). */
	accent: string;
}

const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
	science: { key: "science", label: "Science", accent: "#10b981" },
	"physics-math": { key: "physics-math", label: "Physics & Math", accent: "#3b82f6" },
	history: { key: "history", label: "History", accent: "#f59e0b" },
	cs: { key: "cs", label: "Computer Science", accent: "#8b5cf6" },
	language: { key: "language", label: "Language", accent: "#f43f5e" },
	arts: { key: "arts", label: "Arts", accent: "#ec4899" },
	general: { key: "general", label: "General", accent: "#64748b" },
};

// Ordered so earlier categories win ties. Keywords are matched as whole-ish
// tokens against the lower-cased title.
const CATEGORY_KEYWORDS: Array<[CategoryKey, string[]]> = [
	["physics-math", ["physic", "quantum", "relativ", "calculus", "algebra", "geometry", "math", "equation", "theorem", "integral", "derivative", "vector", "matrix", "probability", "statistic", "trigonometry"]],
	["cs", ["programming", "javascript", "typescript", "python", "rust", "golang", "algorithm", "data structure", "compiler", "react", "function", "recursion", "code", "software", "api", "database", "machine learning", "neural", "computer"]],
	["science", ["biology", "cell", "photosynthesis", "mitosis", "dna", "genetic", "chemistry", "molecule", "atom", "reaction", "evolution", "ecosystem", "neuron", "anatomy", "physiology", "organism", "enzyme", "protein"]],
	["history", ["history", "historical", "empire", "revolution", "ancient", "medieval", "war", "dynasty", "civilization", "century", "renaissance", "treaty", "colonial"]],
	["arts", ["art", "painting", "music", "pigment", "color theory", "composition", "sculpture", "design", "architecture", "film", "cinema", "photography", "drawing"]],
	["language", ["language", "grammar", "vocabulary", "essay", "writing", "poetry", "literature", "spanish", "french", "german", "rhetoric", "syntax", "verb", "sentence"]],
];

export function categorize(title: string | undefined | null): CategoryMeta {
	const text = (title ?? "").toLowerCase();
	if (text.trim()) {
		for (const [key, keywords] of CATEGORY_KEYWORDS) {
			if (keywords.some((kw) => text.includes(kw))) return CATEGORY_META[key];
		}
	}
	return CATEGORY_META.general;
}

export function categoryMeta(key: CategoryKey): CategoryMeta {
	return CATEGORY_META[key];
}

/** Soft gradient for a category hero band, usable as an inline `background`. */
export function categoryGradient(accent: string): string {
	return `linear-gradient(135deg, ${accent}33 0%, ${accent}1a 55%, ${accent}0d 100%)`;
}

/* ── Artifact heroes ───────────────────────────────────────────────────── */

export type ArtifactHeroType = "map" | "animation" | "plan";

export interface ArtifactHero {
	type: ArtifactHeroType;
	topic: string;
	/** Inline SVG markup for lesson maps; absent for other artifact types. */
	svg?: string;
}

// Richness order: a rendered map beats an animation beats a plan.
const HERO_RANK: Record<ArtifactHeroType, number> = { map: 3, animation: 2, plan: 1 };

/**
 * Build a `sessionId -> ArtifactHero` lookup so cards can show a real artifact
 * preview (lesson-map SVG) instead of a plain colour tile. One batched read of
 * the artifact stores; sessions without artifacts simply fall through to colour.
 */
export async function buildArtifactHeroMap(
	storage: Pick<KeatingStorage, "getLessonMaps" | "getAnimations" | "getLessonPlans">,
): Promise<Map<string, ArtifactHero>> {
	const [maps, animations, plans] = await Promise.all([
		storage.getLessonMaps(),
		storage.getAnimations(),
		storage.getLessonPlans(),
	]);

	const heroes = new Map<string, ArtifactHero>();
	const consider = (sessionId: string | undefined, hero: ArtifactHero) => {
		if (!sessionId) return;
		const existing = heroes.get(sessionId);
		if (!existing || HERO_RANK[hero.type] > HERO_RANK[existing.type]) {
			heroes.set(sessionId, hero);
		}
	};

	for (const m of maps) consider(m.sessionId, { type: "map", topic: m.topic, svg: m.svgContent });
	for (const a of animations) consider(a.sessionId, { type: "animation", topic: a.topic });
	for (const p of plans) consider(p.sessionId, { type: "plan", topic: p.topic });
	return heroes;
}

/* ── Masonry sizing ────────────────────────────────────────────────────── */

export const MASONRY_ROW_PX = 8;
export const MASONRY_GAP_PX = 12;

/**
 * Rough initial row span (used before the live ResizeObserver measurement kicks
 * in, and in tests). Generous on purpose so first paint never clips content.
 */
export function estimateRowSpan(opts: {
	titleLength: number;
	previewLength: number;
	hasSvgHero: boolean;
}): number {
	const titleLines = Math.min(3, Math.max(1, Math.ceil(opts.titleLength / 22)));
	const previewLines = Math.min(4, Math.max(1, Math.ceil(opts.previewLength / 30)));
	const heroPx = opts.hasSvgHero ? 132 : 72;
	const heightPx = 24 /* padding */ + heroPx + 12 + titleLines * 20 + previewLines * 16 + 24 /* meta */;
	return pxToSpan(heightPx);
}

export function pxToSpan(heightPx: number): number {
	return Math.max(12, Math.ceil((heightPx + MASONRY_GAP_PX) / (MASONRY_ROW_PX + MASONRY_GAP_PX)));
}
