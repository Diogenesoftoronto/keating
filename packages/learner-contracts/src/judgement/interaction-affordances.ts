import type { ActiveWork } from "./active-work.js";
import type { CodePracticeLanguage } from "./code-practice-language.js";
import { TEACHING_INTERACTION_FEATURES } from "./teaching-policy-catalog.js";
import type { TeachingPolicyTurn } from "./teaching-policy-types.js";

export type InteractionFamily = "question" | "retrieval" | "manipulable" | "workspace" | "away" | "perform";

export const INTERACTION_REASONS = ["requested-variable-exploration", "not-learning", "learning-uncertain", "plain-reply", "assessment-declined", "no-supported-family"] as const;
export type InteractionReason = typeof INTERACTION_REASONS[number];

export interface InteractionFamilyRecommendation {
  readonly family: InteractionFamily;
  /** OpenUI component names from `web/src/keating/openui/library.tsx`. */
  readonly components: readonly string[];
  /** Feature ids that selected this family. */
  readonly features: readonly string[];
}

export interface InteractionRecommendation {
  readonly action: "none" | "create" | "continue" | "grade-first";
  /** Content-free explanation for a suppressed offer or a recovered variable exploration. */
  readonly reason?: InteractionReason;
  /** Explicit language for a new coding exercise. A Python fence is editable outside OpenUI. */
  readonly codePracticeLanguage?: CodePracticeLanguage;
  readonly families: readonly InteractionFamilyRecommendation[];
  readonly continueInteraction?: { readonly documentId: string; readonly nodeId: string; readonly component: string; readonly typedAttempt?: true };
  readonly lead?: "answer-first";
}

interface AffordanceRow {
  readonly family: InteractionFamily;
  readonly components: readonly string[];
  /** Every listed feature must be true. */
  readonly features: readonly string[];
  /** During practice some surfaces need evidence the learner wants to operate them. */
  readonly practice?: true | "hands_on_requested";
  readonly needsInlineLab?: boolean;
  readonly note?: string;
}

/**
 * Code-owned map from material features to OpenUI components. The judge
 * decides what is true of the material; this table decides what to offer.
 */
export const INTERACTION_AFFORDANCES: readonly AffordanceRow[] = [
  { family: "question", components: ["Question"], features: ["prediction_opportunity"], practice: true },
  { family: "question", components: ["Question"], features: ["category_distinction"], practice: true },
  { family: "question", components: ["Question"], features: ["ordered_procedure"], note: "an ordering question", practice: true },
  { family: "question", components: ["Question"], features: ["learner_response_due"], practice: true },
  { family: "retrieval", components: ["Quiz", "Flashcards"], features: ["discrete_recall", "untested_coverage"], practice: true },
  { family: "retrieval", components: ["LanguagePractice"], features: ["language_learning"], practice: true },
  { family: "manipulable", components: ["Simulation"], features: ["variable_relationship"], practice: "hands_on_requested" },
  { family: "manipulable", components: ["CodingChallenge"], features: ["executable_code"], practice: true },
  { family: "manipulable", components: ["Lab"], features: ["executable_code", "hands_on_requested"], practice: true, needsInlineLab: true },
  { family: "perform", components: ["Lab"], features: ["performed_skill", "hands_on_requested"], practice: true, needsInlineLab: true },
  { family: "manipulable", components: ["Lab"], features: ["outside_observation", "hands_on_requested"], practice: true, needsInlineLab: true },
  { family: "perform", components: ["AudioResponse", "VideoResponse", "MusicLab"], features: ["performed_skill"], practice: "hands_on_requested" },
  { family: "workspace", components: ["ConceptMap"], features: ["structure_relations"], practice: "hands_on_requested" },
  { family: "manipulable", components: ["Diagram"], features: ["structure_relations", "extended_production"], practice: true },
  { family: "workspace", components: ["LearningImage"], features: ["visual_reference"] },
  { family: "away", components: ["Assignment", "Draft"], features: ["extended_production"], practice: "hands_on_requested" },
  { family: "away", components: ["Fieldwork"], features: ["outside_observation"], practice: "hands_on_requested" },
];

/** UI node types that can be continued, by the family that would create them. */
const CONTINUABLE: Readonly<Record<string, InteractionFamily>> = { question: "question", "question-group": "question", quiz: "retrieval" };

const FAMILY_ORDER: readonly InteractionFamily[] = ["question", "retrieval", "manipulable", "perform", "workspace", "away"];

type Flags = Readonly<Record<string, boolean | null>>;

export interface InteractionContext {
  readonly activeWork?: ActiveWork | null;
  readonly pendingSubmissions?: TeachingPolicyTurn["pendingSubmissions"];
  readonly domain?: TeachingPolicyTurn["domain"];
  readonly followsTutorTurn?: boolean;
  readonly codePracticeLanguage?: CodePracticeLanguage | null;
  readonly inlineLabAvailable?: boolean;
  readonly assessment?: TeachingPolicyTurn["assessment"];
}

const explanationComponents = new Set(["Simulation", "ConceptMap", "LearningImage", "Diagram"]);

function requestedVariableExploration(features: Flags, decisions: Flags, context: InteractionContext): boolean {
  if (features.hands_on_requested !== true || features.variable_relationship !== true) return false;
  // A setting or purchase can involve two changing quantities. Require evidence
  // that the learner is working with subject matter on this turn as well.
  const subjectMaterial = features.structure_relations === true || features.prediction_opportunity === true;
  const teachingReference = decisions.assessment_declined === true || decisions.attempt_present === true;
  const knownSubject = Boolean(context.activeWork?.focus) || (context.domain !== undefined && context.domain !== "unknown" && context.domain !== "general");
  return knownSubject ? teachingReference || subjectMaterial : context.followsTutorTurn === true && teachingReference && subjectMaterial;
}

/**
 * Each offered family needs positive material evidence. A specific request to
 * explore a subject variable can support that one family despite a broad negative.
 */
export function recommendInteraction(features: Flags, decisions: Flags, context: InteractionContext = {}): InteractionRecommendation {
  const pausedExploration = decisions.learning_task === null && decisions.assessment_declined === true && features.hands_on_requested === true;
  const inScope = decisions.learning_task === true || decisions.practice_requested === true || pausedExploration;
  const simulationOnly = !inScope && requestedVariableExploration(features, decisions, context);
  const pendingGrade = (context.pendingSubmissions?.length ?? 0) > 0 || (context.activeWork?.focus?.evidence.pendingGrade ?? 0) > 0;
  if ((inScope || simulationOnly) && pendingGrade) {
    return { action: "grade-first", families: [] };
  }
  if (decisions.plain_reply_requested === true) return { action: "none", families: [], reason: "plain-reply" };
  if (!inScope && !simulationOnly) return { action: "none", families: [], reason: decisions.learning_task === false ? "not-learning" : "learning-uncertain" };
  const byFamily = new Map<InteractionFamily, { components: string[]; features: string[] }>();
  let assessmentSuppressed = false;
  for (const row of INTERACTION_AFFORDANCES) {
    if (row.needsInlineLab && (!context.inlineLabAvailable || context.codePracticeLanguage)) continue;
    if (simulationOnly && !row.components.includes("Simulation")) continue;
    if (!row.features.every((id) => features[id] === true)) continue;
    if (decisions.assessment_declined === true && !row.components.some(component => explanationComponents.has(component))) {
      assessmentSuppressed = true;
      continue;
    }
    const practiceFeature = typeof row.practice === "string" && features[row.practice] === true ? row.practice : null;
    if (decisions.practice_requested === true && decisions.assessment_declined !== true && row.practice !== true && !practiceFeature) continue;
    const entry = byFamily.get(row.family) ?? { components: [], features: [] };
    for (const component of row.components) if (!entry.components.includes(component)) entry.components.push(component);
    for (const id of row.features) if (!entry.features.includes(id)) entry.features.push(id);
    if (practiceFeature && !entry.features.includes(practiceFeature)) entry.features.push(practiceFeature);
    byFamily.set(row.family, entry);
  }
  if (decisions.learner_stuck === true) byFamily.delete("away");
  if (features.hands_on_requested === true && features.learner_response_due !== true
    && [...byFamily.values()].some(({ features: matched, components }) => matched.includes("hands_on_requested")
      || components.includes("CodingChallenge") || components.includes("Diagram"))) {
    byFamily.delete("question");
  }
  const families = FAMILY_ORDER.filter((family) => byFamily.has(family)).map((family) => ({ family, ...byFamily.get(family)! }));
  // A requested Python editor is useful on its own. It does not require the signal for a runnable OpenUI challenge.
  const independentPython = context.codePracticeLanguage === "python" && decisions.learning_task === true
    && decisions.practice_requested === true && features.hands_on_requested === true
    && decisions.assessment_declined !== true && context.assessment !== "assessed";
  if (!families.length && !independentPython) return { action: "none", families, reason: assessmentSuppressed ? "assessment-declined" : "no-supported-family" };
  const answerFirst = (features.learner_response_due !== true || decisions.assessment_declined === true) && (decisions.explanation_requested === true
    || decisions.direct_answer_requested === true && decisions.practice_requested !== true);
  const lead = answerFirst ? { lead: "answer-first" as const } : {};
  const work = context.activeWork;
  const focusItem = work?.focus?.itemId ?? null;
  const open = work?.openInteractions.find((interaction) => interaction.state === "awaiting"
    && (interaction.itemId ?? null) === focusItem
    && families.some(({ family }) => CONTINUABLE[interaction.component] === family));
  if (open) {
    return { action: "continue", families, continueInteraction: { documentId: open.documentId, nodeId: open.nodeId, component: open.component }, ...lead };
  }
  const coding = independentPython || families.some(f => f.components.includes("CodingChallenge")) ? context.codePracticeLanguage : null;
  if (coding === "python") {
    const submission = features.learner_response_due === true ? families.filter(f => f.family === "question") : [];
    return { action: submission.length ? "create" : "none", families: submission, codePracticeLanguage: coding };
  }
  return { action: "create", families, ...lead, ...(coding ? { codePracticeLanguage: coding } : {}),
    ...(simulationOnly ? { reason: "requested-variable-exploration" as const } : {}) };
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
  if (recommendation.action === "continue" && recommendation.continueInteraction?.typedAttempt) {
    const { component, nodeId } = recommendation.continueInteraction;
    return [`The learner typed an attempt while the preceding ${component} ${nodeId} still awaits a form submission. Read their answer against that item. Give concise feedback confirming what is correct or explaining the correction, then stop unless the learner explicitly requested another action. If their answer is incomplete or concerns something else, address what they actually wrote and leave the unanswered item open.`];
  }
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
    : `At most one OpenUI activity may help this turn: ${options.join("; or ")}. Prefer the option that gives the learner the action they asked to take. Prose is acceptable when it serves the learner better.`);
  if (recommendation.families.some(({ components }) => components.includes("CodingChallenge"))) {
    directives.push("CodingChallenge runs JavaScript or TypeScript. Preserve the requested language. Use a runnable fence when the conversation host supports that language; for other languages a short code sample and a Question can collect the learner's fix.");
  }
  if (recommendation.families.some(({ components }) => components.includes("Lab"))) {
    directives.push("Use Lab when you can check a systems program's output, a sequence of MIDI notes, or a numeric sensor reading. Supply the adapter, observable checkpoints and a hint for each tricky step. For a physical skill outside these capabilities choose an appropriate recording or fieldwork action.");
  }
  if (recommendation.families.some(({ family }) => family === "manipulable" || family === "workspace" || family === "perform")) {
    directives.push("If you include a working control, keep the surrounding prose to the context and first action the learner needs. Put units and assumptions in the control. Skip restating its labels or results. Include any explanation the learner explicitly requested.");
  }
  if (recommendation.families.some(({ family }) => WAITS.has(family))) {
    directives.push("If you pose a question or quiz, put all instructions in it and end the reply at its closing fence. Do not answer it yourself.");
  }
  return directives;
}
