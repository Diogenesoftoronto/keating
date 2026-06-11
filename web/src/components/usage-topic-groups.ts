export type TopicArtifactType = "plan" | "map" | "animation" | "verification";

export interface TopicArtifactInput {
	topic?: string;
	type: TopicArtifactType;
}

export interface UsageTopicCategory {
	key: string;
	label: string;
	color: string;
	keywords: string[];
}

export interface TopicArtifactGroup {
	key: string;
	label: string;
	count: number;
	color: string;
	topics: Array<{ topic: string; count: number }>;
	types: Record<TopicArtifactType, number>;
}

const CATEGORIES: UsageTopicCategory[] = [
	{
		key: "math",
		label: "Math",
		color: "#2563eb",
		keywords: ["algebra", "calculus", "derivative", "integral", "geometry", "probability", "statistic", "bayes", "matrix", "vector", "theorem", "proof", "number theory", "topology", "differential", "linear algebra", "discrete math", "combinatorics", "graph theory", "set theory", "logic", "equation", "formula", "trigonometry"],
	},
	{
		key: "physics",
		label: "Physics",
		color: "#4f46e5",
		keywords: ["physics", "quantum", "relativity", "mechanics", "wave", "field", "thermodynamic", "entropy", "electromagnetic", "optics", "particle", "nuclear", "astrophysics", "cosmology", "string theory", "gravity", "motion", "force", "energy", "momentum", "velocity", "acceleration", "fluid", "plasma", "condensed matter"],
	},
	{
		key: "computing",
		label: "Computing",
		color: "#8b5cf6",
		keywords: ["algorithm", "api", "code", "compiler", "computer", "database", "function", "javascript", "machine learning", "neural", "programming", "python", "react", "recursion", "rust", "software", "typescript"],
	},
	{
		key: "web-development",
		label: "Web Development",
		color: "#3b82f6",
		keywords: ["react", "vue", "angular", "html", "css", "frontend", "backend", "node", "express", "nextjs", "webpack", "dom", "spa", "rest", "graphql", "http", "browser", "cdn", "responsive", "web component", "jsx", "tailwind", "sass", "web socket", "oauth", "jwt", "cookie", "cors", "pwa"],
	},
	{
		key: "data-science-ai",
		label: "Data Science & AI",
		color: "#06b6d4",
		keywords: ["machine learning", "deep learning", "neural network", "dataset", "model", "training", "regression", "classification", "clustering", "tensorflow", "pytorch", "pandas", "numpy", "llm", "reinforcement learning", "supervised learning", "unsupervised learning", "overfitting", "cross-validation", "feature engineering", "nlp", "computer vision", "generative ai", "transformer", "embedding", "gradient descent", "loss function"],
	},
	{
		key: "systems-infrastructure",
		label: "Systems & Infrastructure",
		color: "#f59e0b",
		keywords: ["operating system", "kernel", "linux", "docker", "kubernetes", "network", "protocol", "tcp", "server", "cloud", "aws", "terraform", "ci/cd", "microservices", "distributed", "load balancer", "nginx", "virtual machine", "container", "orchestration", "monitoring", "logging", "dns", "vpn", "firewall", "ssl", "tls", "ssh", "rpc", "message queue", "kafka", "redis", "postgres", "nosql", "elasticsearch"],
	},
	{
		key: "software-engineering",
		label: "Software Engineering",
		color: "#ec4899",
		keywords: ["design pattern", "architecture", "refactoring", "testing", "tdd", "agile", "scrum", "git", "version control", "ci", "code review", "solid", "dry", "api design", "dependency injection", "unit test", "integration test", "e2e test", "clean code", "monolith", "event-driven", "cqrs", "microservice", "domain-driven", "observability", "sla", "sre", "devops"],
	},
	{
		key: "life-science",
		label: "Life Science",
		color: "#16a34a",
		keywords: ["biology", "cell", "dna", "ecosystem", "enzyme", "evolution", "genetic", "mitosis", "organism", "photosynthesis", "plant", "protein"],
	},
	{
		key: "molecular-biology",
		label: "Molecular Biology",
		color: "#059669",
		keywords: ["dna", "rna", "gene", "genetic", "protein", "enzyme", "chromosome", "replication", "transcription", "translation", "mutation", "genome", "nucleotide", "amino acid", "polymerase", "mitosis", "meiosis", "cell cycle", "molecular"],
	},
	{
		key: "ecology-environment",
		label: "Ecology & Environment",
		color: "#65a30d",
		keywords: ["ecosystem", "biodiversity", "conservation", "habitat", "species", "population", "community", "biosphere", "niche", "symbiosis", "food web", "trophic", "sustainability", "pollution", "climate change", "extinction", "biome", "ecological"],
	},
	{
		key: "human-anatomy",
		label: "Human Anatomy & Physiology",
		color: "#dc2626",
		keywords: ["anatomy", "physiology", "organ", "tissue", "muscle", "bone", "cardiovascular", "nervous system", "endocrine", "digestion", "respiratory", "immune system", "lymphatic", "renal", "skeletal", "homeostasis", "neuron", "synapse", "hormone", "circulatory"],
	},
	{
		key: "microbiology",
		label: "Microbiology & Disease",
		color: "#7c3aed",
		keywords: ["bacteria", "virus", "pathogen", "infection", "microbiology", "antibiotic", "vaccine", "microbiome", "fungus", "parasite", "epidemiology", "pandemic", "immunology", "antibody", "antigen", " host", "vector", "transmission", "virulence", "sterilization"],
	},
	{
		key: "chemistry",
		label: "Chemistry",
		color: "#0891b2",
		keywords: ["chemistry", "atom", "molecule", "reaction", "compound", "element", "periodic", "acid", "base", "bond", "ionic", "covalent", "organic chemistry", "inorganic", "biochemistry", "catalysis", "stoichiometry", "equilibrium", "redox", "electrochemistry", "polymer"],
	},
	{
		key: "earth-science",
		label: "Earth Science",
		color: "#0d9488",
		keywords: ["geology", "earth", "plate tectonic", "volcano", "earthquake", "mineral", "rock", "fossil", "sediment", "metamorphic", "igneous", "weather", "climate", "ocean", "atmosphere", "hydrology", "meteorology", "glacier", "erosion", "geologic"],
	},
	{
		key: "astronomy",
		label: "Astronomy & Space",
		color: "#1e40af",
		keywords: ["astronomy", "astrophysics", "planet", "star", "galaxy", "universe", "cosmology", "black hole", "nebula", "supernova", "telescope", "exoplanet", "orbit", "gravity", "solar system", "constellation", "dark matter", "dark energy", "big bang", "space"],
	},
	{
		key: "materials-science",
		label: "Materials Science",
		color: "#9333ea",
		keywords: ["material", "nanotechnology", "semiconductor", "metallurgy", "ceramic", "composite", "polymer", "crystallography", "alloy", "superconductor", "graphene", "carbon fiber", "biomaterial", "smart material", "phase transition", "diffusion", "strain", "stress", "fatigue", "corrosion"],
	},
	{
		key: "mind-medicine",
		label: "Mind & Medicine",
		color: "#db2777",
		keywords: ["anxiety", "brain", "cognition", "diagnosis", "health", "medicine", "memory", "neuron", "psychology", "therapy"],
	},
	{
		key: "law",
		label: "Law",
		color: "#ea580c",
		keywords: ["law", "legal", "court", "statute", "litigation", "jurisdiction", "precedent", "contract", "tort", "constitutional", "criminal law", "civil law", "property", "evidence", "procedure", "appeal", "injunction", "liability", "compliance", "regulation"],
	},
	{
		key: "politics",
		label: "Politics & Governance",
		color: "#dc2626",
		keywords: ["politics", "government", "democracy", "election", "parliament", "congress", "policy", "diplomacy", "international relation", "democratic", "authoritarian", "ideology", "campaign", "lobbying", "bureaucracy", "public administration", "civic", "voting", "legislation", "executive"],
	},
	{
		key: "economics",
		label: "Economics",
		color: "#ca8a04",
		keywords: ["economics", "economy", "market", "supply", "demand", "inflation", "gdp", "recession", "fiscal", "monetary", "microeconomics", "macroeconomics", "trade", "tariff", "exchange rate", "investment", "stock", "bond", "banking", "finance", "capitalism", "socialism"],
	},
	{
		key: "philosophy",
		label: "Philosophy & Ethics",
		color: "#7c3aed",
		keywords: ["philosophy", "ethics", "moral", "epistemology", "metaphysics", "logic", "existentialism", "utilitarianism", "deontology", "virtue", "aesthetics", "ontology", "phenomenology", "consciousness", "free will", "determinism", "skepticism", "empiricism", "rationalism", "philosophical"],
	},
	{
		key: "history",
		label: "History",
		color: "#eab308",
		keywords: ["ancient", "century", "civilization", "colonial", "dynasty", "empire", "historical", "history", "medieval", "renaissance", "revolution", "treaty", "war"],
	},
	{
		key: "visual-arts",
		label: "Visual Arts",
		color: "#ec4899",
		keywords: ["painting", "drawing", "sculpture", "photography", "printmaking", "ceramic", "installation", "collage", "watercolor", "oil painting", "acrylic", "charcoal", "pastel", "mixed media", "figure drawing", "landscape", "portrait", "abstract", "realism", "art history"],
	},
	{
		key: "music",
		label: "Music",
		color: "#d946ef",
		keywords: ["music", "composition", "melody", "harmony", "rhythm", "orchestra", "symphony", "jazz", "classical", "opera", "piano", "violin", "guitar", "drum", "singing", "choir", "band", "music theory", "notation", "improvisation", "conducting", "recording", "mixing"],
	},
	{
		key: "performing-arts",
		label: "Performing Arts",
		color: "#f43f5e",
		keywords: ["theatre", "drama", "acting", "dance", "ballet", "modern dance", "choreography", "play", "scene", "monologue", "stage", "directing", "playwright", "improvisation", "mime", "puppetry", "circus", "performance art", "stand-up", "opera", "musical theatre"],
	},
	{
		key: "design",
		label: "Design",
		color: "#fb7185",
		keywords: ["design", "graphic design", "ui design", "ux design", "interior design", "industrial design", "fashion design", "typography", "layout", "branding", "logo", "illustration", "3d modeling", "animation", "motion graphics", "color theory", "grid system", "wireframe", "prototype", "user research"],
	},
	{
		key: "linguistics",
		label: "Linguistics",
		color: "#f59e0b",
		keywords: ["linguistics", "phonology", "phonetic", "morphology", "syntax", "semantics", "pragmatics", "sociolinguistics", "psycholinguistics", "historical linguistics", "language acquisition", "dialect", "accent", "register", "discourse", "grammar", "generative", "transformational", " corpus", "phoneme", "morpheme"],
	},
	{
		key: "literature",
		label: "Literature",
		color: "#f97316",
		keywords: ["literature", "novel", "short story", "fiction", "nonfiction", "poetry", "poem", "drama", "play", "literary criticism", "genre", "narrative", "protagonist", "antagonist", "theme", "symbolism", "metaphor", "allegory", "satire", "romanticism", "modernism", "postmodernism"],
	},
	{
		key: "creative-writing",
		label: "Creative Writing",
		color: "#fb923c",
		keywords: ["creative writing", "fiction writing", "storytelling", "plot", "character", "setting", "dialogue", "narrative arc", "worldbuilding", "fan fiction", "flash fiction", "memoir", "autobiography", "journal", "blog", "copywriting", "scriptwriting", "screenplay", "pitch", "outline", "draft"],
	},
	{
		key: "language-learning",
		label: "Language Learning",
		color: "#fbbf24",
		keywords: ["language learning", "spanish", "french", "german", "chinese", "japanese", "arabic", "russian", "portuguese", "italian", "korean", "vocabulary", "grammar", "conjugation", "tense", "pronunciation", "listening", "speaking", "reading", "writing", "translation", "bilingual", "multilingual", "fluency"],
	},
	{
		key: "general",
		label: "General Learning",
		color: "#64748b",
		keywords: [],
	},
];

const CATEGORY_BY_KEY = new Map(CATEGORIES.map((category) => [category.key, category]));
const GENERAL_CATEGORY = CATEGORY_BY_KEY.get("general")!;

function normalizeTopic(topic: string): string {
	return topic.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function categorizeUsageTopic(topic: string | undefined | null): UsageTopicCategory {
	const normalized = normalizeTopic(topic ?? "");
	if (!normalized) return GENERAL_CATEGORY;
	for (const category of CATEGORIES) {
		if (category.key === "general") continue;
		if (category.keywords.some((keyword) => normalized.includes(keyword))) return category;
	}
	return GENERAL_CATEGORY;
}

/* ── 3-level hierarchy ─────────────────────────────────────────────────── */

export interface HierarchyNode {
	key: string;
	label: string;
	color: string;
	count: number;
	children: HierarchyNode[];
	/* Only present on leaf nodes (level-3 topics). */
	topic?: string;
}

const CATEGORY_PARENTS: Record<string, { key: string; label: string; color: string }> = {
	math: { key: "mathematics-domain", label: "Mathematics", color: "#2563eb" },
	physics: { key: "physical-sciences-domain", label: "Physical Sciences", color: "#4f46e5" },
	chemistry: { key: "physical-sciences-domain", label: "Physical Sciences", color: "#4f46e5" },
	astronomy: { key: "physical-sciences-domain", label: "Physical Sciences", color: "#4f46e5" },
	"earth-science": { key: "physical-sciences-domain", label: "Physical Sciences", color: "#4f46e5" },
	"materials-science": { key: "physical-sciences-domain", label: "Physical Sciences", color: "#4f46e5" },
	computing: { key: "computing-domain", label: "Computing", color: "#8b5cf6" },
	"web-development": { key: "computing-domain", label: "Computing", color: "#8b5cf6" },
	"data-science-ai": { key: "computing-domain", label: "Computing", color: "#8b5cf6" },
	"systems-infrastructure": { key: "computing-domain", label: "Computing", color: "#8b5cf6" },
	"software-engineering": { key: "computing-domain", label: "Computing", color: "#8b5cf6" },
	"life-science": { key: "life-sciences-domain", label: "Life Sciences", color: "#16a34a" },
	"molecular-biology": { key: "life-sciences-domain", label: "Life Sciences", color: "#16a34a" },
	"ecology-environment": { key: "life-sciences-domain", label: "Life Sciences", color: "#16a34a" },
	"human-anatomy": { key: "life-sciences-domain", label: "Life Sciences", color: "#16a34a" },
	microbiology: { key: "life-sciences-domain", label: "Life Sciences", color: "#16a34a" },
	"mind-medicine": { key: "mind-medicine-domain", label: "Mind & Medicine", color: "#db2777" },
	law: { key: "society-domain", label: "Society", color: "#f97316" },
	politics: { key: "society-domain", label: "Society", color: "#f97316" },
	economics: { key: "society-domain", label: "Society", color: "#f97316" },
	philosophy: { key: "society-domain", label: "Society", color: "#f97316" },
	history: { key: "history-domain", label: "History", color: "#eab308" },
	"visual-arts": { key: "arts-domain", label: "Arts", color: "#ec4899" },
	music: { key: "arts-domain", label: "Arts", color: "#ec4899" },
	"performing-arts": { key: "arts-domain", label: "Arts", color: "#ec4899" },
	design: { key: "arts-domain", label: "Arts", color: "#ec4899" },
	linguistics: { key: "language-domain", label: "Language", color: "#f43f5e" },
	literature: { key: "language-domain", label: "Language", color: "#f43f5e" },
	"creative-writing": { key: "language-domain", label: "Language", color: "#f43f5e" },
	"language-learning": { key: "language-domain", label: "Language", color: "#f43f5e" },
	general: { key: "general-domain", label: "General", color: "#64748b" },
};

/**
 * Build a 3-level tree from flat artifact groups.
 * Level 1 = parent domain, Level 2 = category, Level 3 = individual topics.
 */
export function buildTopicHierarchy(groups: TopicArtifactGroup[]): HierarchyNode {
	const root: HierarchyNode = { key: "root", label: "All Topics", color: "#64748b", count: 0, children: [] };

	for (const group of groups) {
		const parentMeta = CATEGORY_PARENTS[group.key] ?? { key: "general-domain", label: "General", color: "#64748b" };
		let parent = root.children.find((c) => c.key === parentMeta.key);
		if (!parent) {
			parent = { key: parentMeta.key, label: parentMeta.label, color: parentMeta.color, count: 0, children: [] };
			root.children.push(parent);
		}
		const categoryNode: HierarchyNode = {
			key: group.key,
			label: group.label,
			color: group.color,
			count: group.count,
			children: group.topics.map((t) => ({
				key: `topic-${t.topic}`,
				label: t.topic,
				color: group.color,
				count: t.count,
				children: [],
				topic: t.topic,
			})),
		};
		parent.children.push(categoryNode);
		parent.count += group.count;
		root.count += group.count;
	}

	// Sort each level by count desc, then label asc
	root.children.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	for (const parent of root.children) {
		parent.children.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	}

	return root;
}

export function buildTopicArtifactGroups(artifacts: TopicArtifactInput[]): TopicArtifactGroup[] {
	const groups = new Map<string, TopicArtifactGroup>();

	for (const artifact of artifacts) {
		const topic = (artifact.topic ?? "").trim();
		if (!topic) continue;
		const category = categorizeUsageTopic(topic);
		const group = groups.get(category.key) ?? {
			key: category.key,
			label: category.label,
			color: category.color,
			count: 0,
			topics: [],
			types: { plan: 0, map: 0, animation: 0, verification: 0 },
		};
		group.count += 1;
		group.types[artifact.type] += 1;
		const existingTopic = group.topics.find((entry) => entry.topic.toLowerCase() === topic.toLowerCase());
		if (existingTopic) {
			existingTopic.count += 1;
		} else {
			group.topics.push({ topic, count: 1 });
		}
		groups.set(category.key, group);
	}

	return [...groups.values()]
		.map((group) => ({
			...group,
			topics: group.topics.sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
