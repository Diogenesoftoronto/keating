/**
 * Interactive replies: kind → lazily loaded component, validator and presets.
 *
 * Every component (and dragology, which only they use) sits in its own chunk, so the boot
 * chunk does not grow; three.js is a further chunk that Anatomy3D imports after mount. The
 * contract guarantees only bounded JSON for `config`; each module's own validator decides
 * whether the config fits the component.
 */
import type { ComponentType } from "react";
import type { InteractiveKind } from "@keating/learner-contracts";

/** What every component hands back when the learner shares: their words, the data, an advisory reply. */
export interface InteractiveReplySummary { learner: string; data: string; reply: string }

export interface InteractiveReplyComponentProps {
	config: unknown;
	onChange?: () => void;
	onShare?: (summary: InteractiveReplySummary) => void;
}

export interface InteractiveReplyModule {
	Component: ComponentType<InteractiveReplyComponentProps>;
	/** Problems with the config, in plain words; empty when it renders. */
	validate: (config: unknown) => string[];
	/** Reviewed example configs, keyed by preset name (stories and tests). */
	presets: Readonly<Record<string, unknown>>;
}

type Loader = () => Promise<InteractiveReplyModule>;

const as = (Component: unknown) => Component as ComponentType<InteractiveReplyComponentProps>;

export const INTERACTIVE_REPLY_LOADERS: Readonly<Record<InteractiveKind, Loader>> = {
	"state-machine": () => import("./state-machine/component").then((m) => ({ Component: as(m.StateMachineBuilder), validate: m.validateStateMachine, presets: m.presets })),
	construction: () => import("./construction/component").then((m) => ({ Component: as(m.CompassConstruction), validate: m.validateCompassConstruction, presets: m.presets })),
	"fraction-line": () => import("./fraction-line/component").then((m) => ({ Component: as(m.NumberLine), validate: m.validateNumberLine, presets: m.presets })),
	equation: () => import("./equation/component").then((m) => ({ Component: as(m.EquationWorkbench), validate: m.validateEquationWorkbench, presets: m.presets })),
	permutation: () => import("./permutation/component").then((m) => ({ Component: as(m.PermutationLab), validate: m.validatePermutationLab, presets: m.presets })),
	"linked-model": () => import("./linked-model/component").then((m) => ({ Component: as(m.LinkedLab), validate: m.validateLinked, presets: m.presets })),
	"sort-board": () => import("./sort-board/component").then((m) => ({ Component: as(m.SortBoard), validate: m.validateSortBoard, presets: m.presets })),
	"data-explorer": () => import("./data-explorer/component").then((m) => ({ Component: as(m.DataExplorer), validate: m.validateDataExplorer, presets: m.presets })),
	"plan-timeline": () => import("./plan-timeline/component").then((m) => ({ Component: as(m.PlanTimeline), validate: m.validatePlanTimeline, presets: m.presets })),
	"evidence-board": () => import("./evidence-board/component").then((m) => ({ Component: as(m.EvidenceBoard), validate: m.validateEvidenceBoard, presets: m.presets })),
	// Specialist labs. Anatomy3D loads three.js in a further chunk after mount, only when WebGL is available.
	anatomy: () => import("./anatomy/component").then((m) => ({ Component: as(m.Anatomy3D), validate: m.validateAnatomy3D, presets: m.presets })),
	pharmacology: () => import("./pharmacology/component").then((m) => ({ Component: as(m.PharmLab), validate: m.validatePharmLab, presets: m.presets })),
	methods: () => import("./methods/component").then((m) => ({ Component: as(m.MethodsLab), validate: m.validateMethodsLab, presets: m.presets })),
	physics: () => import("./physics/component").then((m) => ({ Component: as(m.PhysicsLab), validate: m.validatePhysicsLab, presets: m.presets })),
};

const loaded = new Map<InteractiveKind, Promise<InteractiveReplyModule>>();

/** Loads a kind's module once; a failed load is forgotten so a later render can retry. */
export function loadInteractiveReply(kind: InteractiveKind): Promise<InteractiveReplyModule> {
	let pending = loaded.get(kind);
	if (!pending) {
		pending = INTERACTIVE_REPLY_LOADERS[kind]();
		pending.catch(() => loaded.delete(kind));
		loaded.set(kind, pending);
	}
	return pending;
}

/** Runs a module's validator; a validator that throws counts as one problem rather than a crash. */
export function interactiveConfigProblems(module: InteractiveReplyModule, config: unknown): string[] {
	try {
		return module.validate(config);
	} catch (error) {
		return [error instanceof Error ? error.message : "The config could not be checked."];
	}
}
