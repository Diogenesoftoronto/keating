export interface CommandSpec {
	name: string;
	args: string;
	section: string;
	description: string;
	shellOnly?: boolean;
	cliOnly?: boolean;
}

export const extensionCommandSpecs: CommandSpec[] = [
	{ name: "plan",         args: "<topic>",        section: "Teaching",      description: "Generate a deterministic lesson plan artifact." },
	{ name: "map",          args: "<topic>",        section: "Teaching",      description: "Generate a Mermaid concept map with oxdraw rendering." },
	{ name: "animate",      args: "<topic>",        section: "Teaching",      description: "Generate a manim-web animation bundle." },
	{ name: "learn",        args: "<topic>",        section: "Teaching",      description: "Start a Socratic teaching session.", shellOnly: true },
	{ name: "diagnose",     args: "<topic>",        section: "Teaching",      description: "Map prerequisites and knowledge gaps.", shellOnly: true },
	{ name: "quiz",         args: "<topic>",        section: "Assessment",    description: "Generate retrieval practice questions." },
	{ name: "verify",       args: "<topic>",        section: "Assessment",    description: "Generate a fact-checking checklist before teaching." },
	{ name: "bench",        args: "[topic]",        section: "Optimization",  description: "Benchmark the current teaching policy." },
	{ name: "evolve",       args: "[topic]",        section: "Optimization",  description: "Evolve teaching policies via MAP-Elites." },
	{ name: "prompt-evolve",args: "[name]",         section: "Optimization",  description: "Evolve a prompt template with ACE." },
	{ name: "improve",      args: "",               section: "Self-Improvement", description: "Generate a self-improvement proposal." },
	{ name: "feedback",     args: "<up|down|confused>", section: "Session",   description: "Record session feedback." },
	{ name: "timeline",     args: "",               section: "Review",        description: "Show engagement timeline for all topics." },
	{ name: "due",          args: "",               section: "Review",        description: "Show topics due for spaced-review." },
	{ name: "policy",       args: "",               section: "Session",       description: "Show the active hyperteacher policy." },
	{ name: "trace",        args: "[query]",        section: "Session",       description: "Browse debug traces and artifacts." },
	{ name: "outputs",      args: "",               section: "Session",       description: "Browse all Keating artifacts.", shellOnly: true },
];

export const cliCommandSpecs: CommandSpec[] = [
	{ name: "shell",        args: "[prompt]",       section: "Core",          description: "Launch the AI-powered hyperteacher shell." },
	{ name: "web",          args: "[port]",         section: "Core",          description: "Start the browser UI dev server." },
	{ name: "doctor",       args: "",               section: "Core",          description: "Inspect AI runtime and oxdraw availability." },
	...extensionCommandSpecs.filter(s => !s.shellOnly),
];

export interface CommandSection {
	title: string;
	commands: Array<{ usage: string; description: string }>;
}

export function shellCommandSections(): CommandSection[] {
	const map = new Map<string, Array<{ usage: string; description: string }>>();
	for (const spec of extensionCommandSpecs) {
		if (spec.cliOnly) continue;
		const usage = `/${spec.name}${spec.args ? ` ${spec.args}` : ""}`;
		if (!map.has(spec.section)) map.set(spec.section, []);
		map.get(spec.section)!.push({ usage, description: spec.description });
	}
	return Array.from(map.entries()).map(([title, commands]) => ({ title, commands }));
}

export function cliCommandSections(): CommandSection[] {
	const map = new Map<string, Array<{ usage: string; description: string }>>();
	for (const spec of cliCommandSpecs) {
		const usage = `keating ${spec.name}${spec.args ? ` ${spec.args}` : ""}`;
		if (!map.has(spec.section)) map.set(spec.section, []);
		map.get(spec.section)!.push({ usage, description: spec.description });
	}
	return Array.from(map.entries()).map(([title, commands]) => ({ title, commands }));
}

export function formatSlashUsage(spec: CommandSpec): string {
	return `/${spec.name}${spec.args ? ` ${spec.args}` : ""}`;
}

export function formatCliUsage(spec: CommandSpec): string {
	return `keating ${spec.name}${spec.args ? ` ${spec.args}` : ""}`;
}
