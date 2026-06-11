import type { KeatingStorage } from "../keating/storage";

/**
 * Visual helpers for the mobile/tablet session card grid. Kept free of React/JSX
 * so the categorisation + sizing logic stays unit-testable.
 */

export type CategoryKey =
	| "science"
	| "math"
	| "physics"
	| "chemistry"
	| "astronomy"
	| "earth-science"
	| "materials-science"
	| "history"
	| "cs"
	| "language"
	| "arts"
	| "molecular-biology"
	| "ecology-environment"
	| "human-anatomy"
	| "microbiology"
	| "law"
	| "politics"
	| "economics"
	| "philosophy"
	| "visual-arts"
	| "music"
	| "performing-arts"
	| "design"
	| "linguistics"
	| "literature"
	| "creative-writing"
	| "language-learning"
	| "general";

export interface CategoryMeta {
	key: CategoryKey;
	label: string;
	/** Accent hex used to tint the hero band gradient (theme-agnostic via opacity). */
	accent: string;
}

const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
	science: { key: "science", label: "Science", accent: "#1e9b50" },
	math: { key: "math", label: "Math", accent: "#2563eb" },
	physics: { key: "physics", label: "Physics", accent: "#4f46e5" },
	chemistry: { key: "chemistry", label: "Chemistry", accent: "#0891b2" },
	astronomy: { key: "astronomy", label: "Astronomy & Space", accent: "#1e40af" },
	"earth-science": { key: "earth-science", label: "Earth Science", accent: "#0d9488" },
	"materials-science": { key: "materials-science", label: "Materials Science", accent: "#9333ea" },
	history: { key: "history", label: "History", accent: "#f59e0b" },
	cs: { key: "cs", label: "Computer Science", accent: "#8b5cf6" },
	language: { key: "language", label: "Language", accent: "#f43f5e" },
	arts: { key: "arts", label: "Arts", accent: "#ec4899" },
	"molecular-biology": { key: "molecular-biology", label: "Molecular Biology", accent: "#059669" },
	"ecology-environment": { key: "ecology-environment", label: "Ecology & Environment", accent: "#65a30d" },
	"human-anatomy": { key: "human-anatomy", label: "Human Anatomy & Physiology", accent: "#dc2626" },
	microbiology: { key: "microbiology", label: "Microbiology & Disease", accent: "#7c3aed" },
	law: { key: "law", label: "Law", accent: "#ea580c" },
	politics: { key: "politics", label: "Politics & Governance", accent: "#dc2626" },
	economics: { key: "economics", label: "Economics", accent: "#ca8a04" },
	philosophy: { key: "philosophy", label: "Philosophy & Ethics", accent: "#7c3aed" },
	"visual-arts": { key: "visual-arts", label: "Visual Arts", accent: "#ec4899" },
	music: { key: "music", label: "Music", accent: "#d946ef" },
	"performing-arts": { key: "performing-arts", label: "Performing Arts", accent: "#f43f5e" },
	design: { key: "design", label: "Design", accent: "#fb7185" },
	linguistics: { key: "linguistics", label: "Linguistics", accent: "#f59e0b" },
	literature: { key: "literature", label: "Literature", accent: "#f97316" },
	"creative-writing": { key: "creative-writing", label: "Creative Writing", accent: "#fb923c" },
	"language-learning": { key: "language-learning", label: "Language Learning", accent: "#fbbf24" },
	general: { key: "general", label: "General", accent: "#64748b" },
};

// Ordered so earlier categories win ties. Keywords are matched as whole-ish
// tokens against the lower-cased title.
const CATEGORY_KEYWORDS: Array<[CategoryKey, string[]]> = [
	["physics", ["physics", "quantum", "relativ", "mechanics", "wave", "field", "thermodynamic", "entropy", "electromagnetic", "optics", "particle", "nuclear", "astrophysic", "cosmology", "string theory", "gravity", "motion", "force", "energy", "momentum", "velocity", "acceleration", "fluid", "plasma", "condensed matter"]],
	["math", ["math", "calculus", "algebra", "geometry", "equation", "theorem", "proof", "integral", "derivative", "vector", "matrix", "probability", "statistic", "trigonometry", "number theory", "topology", "differential", "linear algebra", "combinatorics", "graph theory", "set theory", "logic"]],
	["cs", ["programming", "javascript", "typescript", "python", "rust", "golang", "algorithm", "data structure", "compiler", "react", "function", "recursion", "code", "software", "api", "database", "machine learning", "neural", "computer"]],
	["chemistry", ["chemistry", "atom", "molecule", "reaction", "compound", "element", "periodic", "acid", "base", "bond", "ionic", "covalent", "organic chemistry", "inorganic", "biochemistry", "catalysis", "stoichiometry", "equilibrium", "redox", "electrochemistry", "polymer"]],
	["astronomy", ["astronomy", "astrophysics", "planet", "star", "galaxy", "universe", "cosmology", "black hole", "nebula", "supernova", "telescope", "exoplanet", "orbit", "gravity", "solar system", "constellation", "dark matter", "dark energy", "big bang", "space"]],
	["earth-science", ["geology", "earth", "plate tectonic", "volcano", "earthquake", "mineral", "rock", "fossil", "sediment", "metamorphic", "igneous", "weather", "climate", "ocean", "atmosphere", "hydrology", "meteorology", "glacier", "erosion", "geologic"]],
	["materials-science", ["material", "nanotechnology", "semiconductor", "metallurgy", "ceramic", "composite", "polymer", "crystallography", "alloy", "superconductor", "graphene", "carbon fiber", "biomaterial", "smart material", "phase transition", "diffusion", "strain", "stress", "fatigue", "corrosion"]],
	["molecular-biology", ["dna", "rna", "gene", "genome", "protein", "enzyme", "chromosome", "replication", "transcription", "translation", "mutation", "nucleotide", "amino acid", "polymerase", "mitosis", "meiosis", "cell cycle", "molecular"]],
	["human-anatomy", ["anatomy", "physiology", "organ", "tissue", "muscle", "bone", "cardiovascular", "nervous system", "endocrine", "digestion", "respiratory", "immune system", "lymphatic", "renal", "skeletal", "homeostasis", "neuron", "synapse", "hormone", "circulatory"]],
	["ecology-environment", ["ecosystem", "biodiversity", "conservation", "habitat", "species", "population", "community", "biosphere", "niche", "symbiosis", "food web", "trophic", "sustainability", "pollution", "climate change", "extinction", "biome", "ecological"]],
	["microbiology", ["bacteria", "virus", "pathogen", "infection", "microbiology", "antibiotic", "vaccine", "microbiome", "fungus", "parasite", "epidemiology", "pandemic", "immunology", "antibody", "antigen", "vector", "transmission", "virulence", "sterilization"]],
	["law", ["law", "legal", "court", "statute", "litigation", "jurisdiction", "precedent", "contract", "tort", "constitutional", "criminal law", "civil law", "property", "evidence", "procedure", "appeal", "injunction", "liability", "compliance", "regulation"]],
	["politics", ["politics", "government", "democracy", "election", "parliament", "congress", "policy", "diplomacy", "international relation", "democratic", "authoritarian", "ideology", "campaign", "lobbying", "bureaucracy", "public administration", "civic", "voting", "legislation", "executive"]],
	["economics", ["economics", "economy", "market", "supply", "demand", "inflation", "gdp", "recession", "fiscal", "monetary", "microeconomics", "macroeconomics", "trade", "tariff", "exchange rate", "investment", "stock", "bond", "banking", "finance", "capitalism", "socialism"]],
	["philosophy", ["philosophy", "ethics", "moral", "epistemology", "metaphysics", "logic", "existentialism", "utilitarianism", "deontology", "virtue", "aesthetics", "ontology", "phenomenology", "consciousness", "free will", "determinism", "skepticism", "empiricism", "rationalism", "philosophical"]],
	["visual-arts", ["painting", "drawing", "sculpture", "photography", "printmaking", "ceramic", "installation", "collage", "watercolor", "oil painting", "acrylic", "charcoal", "pastel", "mixed media", "figure drawing", "landscape", "portrait", "abstract", "realism", "art history"]],
	["music", ["music", "composition", "melody", "harmony", "rhythm", "orchestra", "symphony", "jazz", "classical", "opera", "piano", "violin", "guitar", "drum", "singing", "choir", "band", "music theory", "notation", "improvisation", "conducting", "recording", "mixing"]],
	["performing-arts", ["theatre", "drama", "acting", "dance", "ballet", "modern dance", "choreography", "play", "scene", "monologue", "stage", "directing", "playwright", "improvisation", "mime", "puppetry", "circus", "performance art", "stand-up", "opera", "musical theatre"]],
	["design", ["design", "graphic design", "ui design", "ux design", "interior design", "industrial design", "fashion design", "typography", "layout", "branding", "logo", "illustration", "3d modeling", "animation", "motion graphics", "color theory", "grid system", "wireframe", "prototype", "user research"]],
	["language-learning", ["language learning", "spanish", "french", "german", "chinese", "japanese", "arabic", "russian", "portuguese", "italian", "korean", "vocabulary", "conjugation", "tense", "pronunciation", "listening", "speaking", "reading", "translation", "bilingual", "multilingual", "fluency"]],
	["linguistics", ["linguistics", "phonology", "phonetic", "morphology", "syntax", "semantics", "pragmatics", "sociolinguistics", "psycholinguistics", "historical linguistics", "language acquisition", "dialect", "accent", "register", "discourse", "generative", "transformational", " corpus", "phoneme", "morpheme"]],
	["literature", ["literature", "novel", "short story", "fiction", "nonfiction", "poetry", "poem", "drama", "play", "literary criticism", "genre", "narrative", "protagonist", "antagonist", "theme", "symbolism", "metaphor", "allegory", "satire", "romanticism", "modernism", "postmodernism"]],
	["creative-writing", ["creative writing", "fiction writing", "storytelling", "plot", "character", "setting", "dialogue", "narrative arc", "worldbuilding", "fan fiction", "flash fiction", "memoir", "autobiography", "journal", "blog", "copywriting", "scriptwriting", "screenplay", "pitch", "outline", "draft"]],
	["science", ["biology", "cell", "photosynthesis", "chemistry", "molecule", "atom", "reaction", "evolution", "neuron", "physiology", "organism"]],
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
	return Math.max(6, Math.ceil((heightPx + MASONRY_GAP_PX) / (MASONRY_ROW_PX + MASONRY_GAP_PX)));
}
