export interface StarterPrompt {
	label: "Learn" | "Plan" | "Map" | "Assess" | "Create";
	text: string;
	domain: string;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
	{ label: "Learn", text: "How do vaccines train the immune system?", domain: "medicine" },
	{ label: "Learn", text: "How does jazz improvisation work?", domain: "arts" },
	{ label: "Learn", text: "Why do cities form where they do?", domain: "geography" },
	{ label: "Learn", text: "Explain quantum entanglement simply", domain: "physics" },
	{ label: "Learn", text: "How do memory biases shape decisions?", domain: "psychology" },
	{ label: "Plan", text: "Plan a household budget I can maintain", domain: "life-skills" },
	{ label: "Plan", text: "Plan a 4-week machine-learning course", domain: "computing" },
	{ label: "Plan", text: "Build a roadmap for conversational Spanish", domain: "languages" },
	{ label: "Map", text: "Compare the French and Haitian Revolutions", domain: "history" },
	{ label: "Map", text: "Map probability to statistics", domain: "mathematics" },
	{ label: "Map", text: "Map the arguments about free will", domain: "philosophy" },
	{ label: "Map", text: "How does a bill become law?", domain: "civics" },
	{ label: "Assess", text: "Quiz me on the Krebs cycle", domain: "biology" },
	{ label: "Assess", text: "Test my async/await knowledge", domain: "computing" },
	{ label: "Assess", text: "Help me practice reading a nutrition label", domain: "life-skills" },
	{ label: "Assess", text: "Give me a close-reading challenge for a poem", domain: "literature" },
	{ label: "Create", text: "Animate how DNS works", domain: "computing" },
	{ label: "Create", text: "Flashcards for Japanese particles", domain: "languages" },
	{ label: "Create", text: "Build a timeline of the Silk Roads", domain: "history" },
	{ label: "Create", text: "Show how climate feedback loops interact", domain: "earth-science" },
];

function shuffled<T>(items: readonly T[], random: () => number): T[] {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
	}
	return result;
}

/** Choose across domains before showing a second prompt from the same domain. */
export function pickDiverseStarterPrompts(
	pool: readonly StarterPrompt[],
	count: number,
	random: () => number = Math.random,
): StarterPrompt[] {
	if (count <= 0 || pool.length === 0) return [];
	const byDomain = new Map<string, StarterPrompt[]>();
	for (const prompt of shuffled(pool, random)) {
		const entries = byDomain.get(prompt.domain) ?? [];
		entries.push(prompt);
		byDomain.set(prompt.domain, entries);
	}
	const selected: StarterPrompt[] = [];
	let domains = shuffled([...byDomain.keys()], random);
	while (selected.length < Math.min(count, pool.length) && domains.length > 0) {
		const nextDomains: string[] = [];
		for (const domain of domains) {
			const prompt = byDomain.get(domain)?.shift();
			if (prompt) selected.push(prompt);
			if ((byDomain.get(domain)?.length ?? 0) > 0) nextDomains.push(domain);
			if (selected.length >= count) break;
		}
		domains = shuffled(nextDomains, random);
	}
	return selected;
}
