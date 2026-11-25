/**
 * Per-turn schemas for the interactive reply components.
 *
 * The base OpenUI prompt carries only a one-line guide per component. The full
 * schema for a component (its catalogue section) joins the draft prompt only
 * when the turn directive names it, which happens only when
 * `recommendInteraction` offers that component. Sections load lazily so the
 * boot chunk does not carry about 17k tokens of schema text.
 */
import { INTERACTIVE_COMPONENT_NAMES, INTERACTIVE_KINDS, type InteractiveKind } from "@keating/learner-contracts";

type Loader = () => Promise<{ default: string }>;

const LOADERS: Readonly<Record<InteractiveKind, Loader>> = {
	"state-machine": () => import("./state-machine.md?raw"),
	construction: () => import("./construction.md?raw"),
	"fraction-line": () => import("./fraction-line.md?raw"),
	equation: () => import("./equation.md?raw"),
	permutation: () => import("./permutation.md?raw"),
	"linked-model": () => import("./linked-model.md?raw"),
	"sort-board": () => import("./sort-board.md?raw"),
	"data-explorer": () => import("./data-explorer.md?raw"),
	"plan-timeline": () => import("./plan-timeline.md?raw"),
	"evidence-board": () => import("./evidence-board.md?raw"),
	anatomy: () => import("./anatomy.md?raw"),
	pharmacology: () => import("./pharmacology.md?raw"),
	methods: () => import("./methods.md?raw"),
	physics: () => import("./physics.md?raw"),
};

const loadShared: Loader = () => import("./_shared.md?raw");

/** The heading `buildCompactTeachingPrompt` puts before the turn's directives. */
const TURN_DECISIONS = "Turn decisions:";
/** Beyond this many named components the turn is not focused enough to be worth the schema text. */
export const MAX_INJECTED_SCHEMAS = 3;

/**
 * Interactive components named in the turn directives of a draft system prompt,
 * in the order they appear. Only the directive block is read, so a component
 * mentioned elsewhere (the learner's message, the base guide) never counts.
 */
export function interactiveComponentsInDirectives(systemPrompt: string): InteractiveKind[] {
	const start = systemPrompt.indexOf(TURN_DECISIONS);
	if (start < 0) return [];
	const block = systemPrompt.slice(start).split(/\n\n(?!- )/u, 1)[0] ?? "";
	const found = INTERACTIVE_KINDS.map((kind) => ({ kind, at: block.search(new RegExp(`\\b${INTERACTIVE_COMPONENT_NAMES[kind]}\\b`, "u")) }))
		.filter(({ at }) => at >= 0)
		.sort((a, b) => a.at - b.at)
		.map(({ kind }) => kind);
	return found;
}

/** The schema text for the named kinds, or "" when none are named or too many are. */
export async function interactiveSchemaSections(kinds: readonly InteractiveKind[]): Promise<string> {
	if (!kinds.length || kinds.length > MAX_INJECTED_SCHEMAS) return "";
	const [shared, ...sections] = await Promise.all([loadShared(), ...kinds.map((kind) => LOADERS[kind]())]);
	return [
		"## Interactive reply schemas for this turn",
		"Use one of these only if it fits the selection policy; prose remains acceptable. A config that breaks a rule below shows a fallback line instead of the component, so check every rule before sending.",
		shared!.default.trim(),
		...sections.map((section) => section.default.trim()),
	].join("\n\n");
}

/** Appends the schemas a draft prompt's directives call for. Unchanged when none apply. */
export async function withInteractiveSchemas(systemPrompt: string): Promise<string> {
	const schemas = await interactiveSchemaSections(interactiveComponentsInDirectives(systemPrompt));
	return schemas ? `${systemPrompt}\n\n${schemas}` : systemPrompt;
}
