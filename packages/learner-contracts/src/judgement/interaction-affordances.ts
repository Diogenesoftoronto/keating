import type { ActiveWork } from "./active-work.js";
import { TEACHING_INTERACTION_FEATURES } from "./teaching-policy-catalog.js";
import type { TeachingPolicyTurn } from "./teaching-policy-types.js";

export type InteractionFamily = "question" | "retrieval" | "manipulable" | "workspace" | "away" | "perform";

export interface InteractionFamilyRecommendation {
  readonly family: InteractionFamily;
  /** OpenUI component names from `web/src/keating/openui/library.tsx`. */
  readonly components: readonly string[];
  /** Feature ids that selected this family. */
  readonly features: readonly string[];
}

export interface InteractionRecommendation {
  readonly action: "none" | "create" | "continue" | "grade-first";
  readonly families: readonly InteractionFamilyRecommendation[];
  readonly continueInteraction?: { readonly documentId: string; readonly nodeId: string; readonly component: string };
  readonly lead?: "answer-first";
}

interface AffordanceRow {
  readonly family: InteractionFamily;
  readonly components: readonly string[];
  /** Every listed feature must be true. */
  readonly features: readonly string[];
  readonly note?: string;
}

/**
 * Code-owned map from material features to OpenUI components. The judge
 * decides what is true of the material; this table decides what to offer.
 */
export const INTERACTION_AFFORDANCES: readonly AffordanceRow[] = [
  { family: "question", components: ["Question"], features: ["prediction_opportunity"] },
  { family: "question", components: ["Question"], features: ["category_distinction"] },
  { family: "question", components: ["Question"], features: ["ordered_procedure"], note: "an ordering question" },
  { family: "retrieval", components: ["Quiz", "Flashcards"], features: ["discrete_recall", "untested_coverage"] },
  { family: "retrieval", components: ["LanguagePractice"], features: ["language_learning"] },
  { family: "manipulable", components: ["Simulation"], features: ["variable_relationship"] },
  { family: "manipulable", components: ["CodingChallenge"], features: ["executable_code"] },
  { family: "perform", components: ["AudioResponse", "VideoResponse", "MusicLab"], features: ["performed_skill"] },
  { family: "workspace", components: ["ConceptMap"], features: ["structure_relations"] },
  { family: "workspace", components: ["LearningImage"], features: ["visual_reference"] },
  { family: "away", components: ["Assignment", "Draft"], features: ["extended_production"] },
  { family: "away", components: ["Fieldwork"], features: ["outside_observation"] },
];

/** UI node types that can be continued, by the family that would create them. */
const CONTINUABLE: Readonly<Record<string, InteractionFamily>> = { question: "question", "question-group": "question", quiz: "retrieval" };

const FAMILY_ORDER: readonly InteractionFamily[] = ["question", "retrieval", "manipulable", "perform", "workspace", "away"];

type Flags = Readonly<Record<string, boolean | null>>;

export interface InteractionContext {
  readonly activeWork?: ActiveWork | null;
  readonly pendingSubmissions?: TeachingPolicyTurn["pendingSubmissions"];
}

const NONE: InteractionRecommendation = { action: "none", families: [] };

/**
 * Null (uncertain) counts as false throughout: an unsure judge never
 * earns the learner an activity.
 */
export function recommendInteraction(features: Flags, decisions: Flags, context: InteractionContext = {}): InteractionRecommendation {
  if (decisions.learning_task !== true && decisions.practice_requested !== true) return NONE;
  if ((context.pendingSubmissions?.length ?? 0) > 0 || (context.activeWork?.focus?.evidence.pendingGrade ?? 0) > 0) {
    return { action: "grade-first", families: [] };
  }
  const byFamily = new Map<InteractionFamily, { components: string[]; features: string[] }>();
  for (const row of INTERACTION_AFFORDANCES) {
    if (!row.features.every((id) => features[id] === true)) continue;
    const entry = byFamily.get(row.family) ?? { components: [], features: [] };
    for (const component of row.components) if (!entry.components.includes(component)) entry.components.push(component);
    for (const id of row.features) if (!entry.features.includes(id)) entry.features.push(id);
    byFamily.set(row.family, entry);
  }
  if (decisions.learner_stuck === true) byFamily.delete("away");
  if (decisions.practice_requested === true) for (const family of [...byFamily.keys()]) if (family !== "retrieval") byFamily.delete(family);
  const families = FAMILY_ORDER.filter((family) => byFamily.has(family)).map((family) => ({ family, ...byFamily.get(family)! }));
  if (families.length === 0) return NONE;
  const lead = decisions.direct_answer_requested === true || decisions.explanation_requested === true ? { lead: "answer-first" as const } : {};
  const work = context.activeWork;
  const focusItem = work?.focus?.itemId ?? null;
  const open = work?.openInteractions.find((interaction) => interaction.state === "awaiting"
    && (interaction.itemId ?? null) === focusItem
    && families.some(({ family }) => CONTINUABLE[interaction.component] === family));
  if (open) {
    return { action: "continue", families, continueInteraction: { documentId: open.documentId, nodeId: open.nodeId, component: open.component }, ...lead };
  }
  return { action: "create", families, ...lead };
}

const purposes = new Map(TEACHING_INTERACTION_FEATURES.map(({ id, purpose }) => [id, purpose]));
const WAITS: ReadonlySet<InteractionFamily> = new Set(["question", "retrieval"]);

/**
 * Tutor-facing directives. Never names features the judge answered as
 * uncertain. `require` is for the interactive draft of a paired turn.
 */
export function interactionDirectives(recommendation: InteractionRecommendation, mode: "offer" | "require" = "offer"): string[] {
  if (recommendation.action === "none") return [];
  if (recommendation.action === "grade-first") {
    return ["The learner has submitted work that still needs grading. Grade it before offering any new activity."];
  }
  const directives: string[] = [];
  if (recommendation.lead === "answer-first") directives.push("Answer the learner's request first; any activity comes after the answer.");
  if (recommendation.action === "continue" && recommendation.continueInteraction) {
    const { component, nodeId } = recommendation.continueInteraction;
    directives.push(`The learner has not yet answered the open ${component} ${nodeId} for the current focus. Refer back to it instead of posing a new one, unless the learner has moved on.`);
    return directives;
  }
  const options = recommendation.families.map(({ family, components, features }) => {
    const note = INTERACTION_AFFORDANCES.find((row) => row.family === family && row.note && row.features.every((id) => features.includes(id)))?.note;
    const why = features.map((id) => purposes.get(id)).filter(Boolean).join("; ");
    return `${components.join(" or ")}${note ? ` (${note})` : ""} to ${why}`;
  });
  directives.push(mode === "require"
    ? `Include exactly one OpenUI activity this turn: ${options.join("; or ")}.`
    : `At most one OpenUI activity may help this turn: ${options.join("; or ")}. Prose is acceptable when it serves the learner better.`);
  if (recommendation.families.some(({ family }) => WAITS.has(family))) {
    directives.push("If you pose a question or quiz, stop and wait for the learner's answer. Do not answer it yourself.");
  }
  return directives;
}
