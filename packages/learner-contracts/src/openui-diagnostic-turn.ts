import type { UiDocumentNode } from "./ui.js";
import { INTERACTION_REASONS, type InteractionReason } from "./judgement/interaction-affordances.js";
import { requestedCodePracticeLanguage, type CodePracticeLanguage } from "./judgement/code-practice-language.js";
import { asksForNamedPrediction, contextualExerciseLanguage, learnerCueProse } from "./openui-cue-context.js";
import { inspectSimulationBrief } from "./judgement/assessment-opt-out.js";
import { DECISION_PLANNING_FAILURE_SCHEMA, isDecisionPlanningFailure, type DecisionPlanningFailure } from "./judgement/teaching-drafts/planning-failure.js";
import { OPENUI_DIAGNOSTIC_GATE_ISSUES, isOpenUiDiagnosticGateIssue } from "./openui-diagnostic-issues.js";
export { isOpenUiDiagnosticGateIssue } from "./openui-diagnostic-issues.js";
import { TEACHING_DRAFT_SELECTION_RULES, isTeachingDraftSelection, type TeachingDraftSelection } from "./judgement/teaching-selection.js";
import { OPENUI_PAIR_REVIEWS_SCHEMA, OPENUI_FINAL_COMPARISON_SCHEMA, validOpenUiPairReviews, validOpenUiFinalComparison, type OpenUiPairReview, type OpenUiFinalComparison } from "./openui-pair-reviews.js";
export { pairReviewOverlapMs, projectOpenUiPairReviews, projectOpenUiFinalComparison, type OpenUiPairReview, type OpenUiFinalComparison } from "./openui-pair-reviews.js";
export { projectTeachingDraftSelection, type TeachingDraftSelection, type TeachingDraftSelectionRule } from "./judgement/teaching-selection.js";

export const OPENUI_DIAGNOSTIC_MODES = ["guided", "offer-only", "baseline", "unknown"] as const;
export const OPENUI_DIAGNOSTIC_CUES = ["explicit-interface", "implicit-action", "direct-text", "none", "unknown"] as const;
const REPLIES = ["released", "withheld", "error", "cancelled", "pending", "unknown"] as const;
export type OpenUiDiagnosticMode = typeof OPENUI_DIAGNOSTIC_MODES[number];
export type OpenUiDiagnosticCueKind = typeof OPENUI_DIAGNOSTIC_CUES[number];
export const EDITABLE_CODE_LANGUAGES = ["python", "javascript", "typescript"] as const satisfies readonly CodePracticeLanguage[];
export const CODING_CHALLENGE_LANGUAGES = ["javascript", "typescript"] as const;
export type CodingChallengeLanguage = typeof CODING_CHALLENGE_LANGUAGES[number];
export interface OpenUiDiagnosticCue { kind: OpenUiDiagnosticCueKind; targets: string[]; repeat?: boolean; codeLanguage?: CodePracticeLanguage }

/** Per-turn observations. A turn with several calls can contain both a success and a failure. */
export const NATIVE_PAGE_STAGES = ["succeeded", "failed", "attached", "saved", "mounted", "ready", "visible", "opened", "frameFailed"] as const;
export type NativePageStage = typeof NATIVE_PAGE_STAGES[number];
export type NativePageEvidence = Record<NativePageStage, boolean | null>;

/** Content-free signals that a released public reply asks the learner to commit to an answer. */
export const ASSESSMENT_CHECKPOINT_SIGNALS = ["simulation-brief", "question-interface", "reply-text"] as const;
export type AssessmentCheckpointSignal = typeof ASSESSMENT_CHECKPOINT_SIGNALS[number];
/** Recorded only when the learner's own words were readable. An absent observation is no evidence. */
export interface OpenUiAssessmentObservation {
  /** True when the learner explicitly declined being tested. False means no recognized English decline, not consent. */
  optOut: boolean;
  /** Signals in the released reply. Empty is an observed reply without one. Null is unreleased or uninspectable. */
  checkpoints: AssessmentCheckpointSignal[] | null;
}

export interface OpenUiDiagnosticTurn {
  schemaVersion: 1;
  conversationId: string;
  turnId: string;
  /** Physical learner-turn index. Missing positions break exact delay measurement. */
  turnIndex: number;
  model: string | null;
  /** Tutor selected when generation started in the final observed round. The provider may return a different identity or no reply. */
  requestedModel?: string;
  mode: OpenUiDiagnosticMode;
  cue: OpenUiDiagnosticCue;
  reply: typeof REPLIES[number];
  /** Browser-observed time from this learner turn's run start to the final public reply or withholding message. */
  replyElapsedMs?: number | null;
  attempted: boolean | null;
  /** Whether a public assistant tool call requested an interactive_page during this turn. */
  nativePageRequested?: boolean | null;
  nativePage?: NativePageEvidence;
  /** Selected editable Markdown source. Language presence does not measure a mount, execution or a notebook. */
  editableCode?: CodePracticeLanguage[] | null;
  /** Actual language of each compiled CodingChallenge in the selected text. Missing means unmeasured. */
  codingChallengeLanguages?: CodingChallengeLanguage[] | null;
  /** Whitespace-delimited words outside complete editable fences and OpenUI on a released editor reply. */
  editorOutsideWords?: number | null;
  /** All observed candidate components, selected response components, and observed mounted components, respectively. */
  compiled: string[] | null;
  selected: string[] | null;
  rendered: string[] | null;
  /** Words outside structured blocks in the selected reply. Zero is an observed count. */
  outsideWords?: number | null;
  guidance: {
    source: "jev" | "other" | "unknown";
    action: "create" | "continue" | "grade-first" | "none" | "unknown";
    delivered: boolean | null;
    targets: string[];
    reason?: InteractionReason;
    codeLanguage?: CodePracticeLanguage;
  } | null;
  experiment?: { experimentId: string; caseId: string; pairId: string };
  fit?: { source: string; passed: boolean | null };
  draftAttempts?: number;
  /** Winning attempt and review of the public final tutor round, when a real release receipt was observed. */
  selection?: TeachingDraftSelection;
  /** Paired comparisons observed on the final tutor round. Earlier records omit this field. */
  pairReviews?: OpenUiPairReview[];
  finalComparison?: OpenUiFinalComparison;
  gateIssues?: string[];
  decisionModel?: string | null;
  /** A failed decision from the final round before tutor generation. A missing field is unmeasured. */
  decisionFailure?: DecisionPlanningFailure;
  /** Explicit assessment opt-out and checkpoint signals. Neither value measures educational fit. */
  assessment?: OpenUiAssessmentObservation;
}

// Use independently observable node kinds. SystemDesign and Diagram share a single task representation.
const COMPONENTS = [
  "question", "question-group", "quiz", "exam", "deck", "study-plan", "concept-map", "diagram",
  "notes", "simulation", "coding-challenge", "music-lab", "language-practice", "markdown", "callout",
  "goal", "image", "media", "artifact", "handoff", "task", "assignment", "practice", "draft",
  "fieldwork", "connect", "person", "audio-response", "video-response",
];
const componentMap = new Map(COMPONENTS.map(kind => [kind.replaceAll("-", ""), kind]));
export function isOpenUiDiagnosticInterface(component: string): boolean {
  return COMPONENTS.includes(component) && !["markdown", "callout", "handoff"].includes(component);
}
for (const [alias, kind] of Object.entries({
  flashcard: "deck", flashcards: "deck", explanation: "markdown", learningimage: "image",
  learninganimation: "handoff", sharednotes: "notes", systemdesign: "diagram", personbrief: "person",
})) componentMap.set(alias, kind);

export function normalizeOpenUiComponent(name: string): string | null {
  return componentMap.get(name.toLowerCase().replace(/[-_ ]/g, "")) ?? null;
}

export function openUiDiagnosticComponentForNode(node: UiDocumentNode): string {
  if (node.type === "quiz" && node.mode === "exam") return "exam";
  if (node.type !== "task") return node.type;
  if (node.diagram) return "diagram";
  if (node.submission?.capture) return node.submission.capture.kind + "-response";
  return node.kind;
}

/** These independent English-language cues can be replaced by a declared, pre-labelled evaluation cue. */
const NAMED: ReadonlyArray<[string, RegExp]> = [
  ["deck", /\bflash\s?cards?\b/], ["exam", /\b(?:mock |practice )?exam\b/], ["quiz", /\bquiz(?:zes)?\b/],
  ["simulation", /\b(?:simulation|simulator|slider)s?\b/], ["concept-map", /\bconcept maps?\b/],
  ["diagram", /\bdiagram(?:s)?\b/], ["study-plan", /\bstudy plans?\b/],
  ["coding-challenge", /\b(?:coding\s?challenge|coding exercise)s?\b/], ["music-lab", /\bmusic lab\b/],
  ["language-practice", /\blanguage practice\b/], ["notes", /\b(?:editable|shared) notes?\b/],
  ["question", /\b(?:openui|interactive|multiple[- ]choice|open[- ]text|on[- ]screen|clickable) (?:text )?questions?\b/],
];
const POSITIVE_REQUEST = /\b(?:give|make|create|build|draw|show|use|generate|set up|start|try|want|would like|could i (?:get|have)|can i (?:get|have)|would help|please)\b/;
const NEGATION = /\b(?:no|without|skip|avoid|stop|don['’]t|do not|not another|no more|rather than|instead of)\b/;
// Declining a quiz can accompany a request for a map or simulation. Text-only controls
// require a direct answer, a prose constraint, or a general opt-out from interfaces.
const DIRECT = /\b(?:plain text|text[- ]only|in (?:a|one) (?:plain |short |single )?sentence|just (?:the )?(?:answer|explain|tell me|show me the answer|give me (?:the )?(?:value|answer|number|definition))|answer (?:me )?directly|direct answer|no (?:ui|interfaces?|interactions?|activities)|without (?:an? |any )?(?:interfaces?|activit(?:y|ies)))\b/;
const SYMBOL_ONLY = /^(?:(?:just|only) (?:the|its) (?:chemical )?symbol|(?:the|its) (?:chemical )?symbol only)(?: please)?$/;
// First-person wording only. A learner asking to attempt, predict or vary something is a cue;
// a question about the subject ("can I predict earthquakes?") or about the app is not.
const ASK = String.raw`(?:let me|(?:can|could|may) i|i (?:want|would like) to|i['\u2019]d like to)`;
const GUESS_TAIL = String.raw`(?: first| before\b| what\b| which\b| how\b| the (?:answer|next|result|outcome)\b|$)`;
const VARY = String.raw`(?:change|increase|decrease|double|vary|adjust|raise|lower|halve|drag|tweak|make\b.{0,40}\b(?:bigger|smaller|larger|wider|narrower|longer|shorter|taller|higher|lower|steeper|flatter|faster|slower|heavier|lighter|hotter|colder|greater|stronger|weaker|thicker|thinner|more|less))`;
const PRACTICE = new RegExp(String.raw`\b(?:let me (?:try|predict|guess|make a (?:prediction|guess)|have a (?:go|guess|try)|choose|practice|practise|test myself|(?:work|figure) (?:it|this) out|(?:order|sort|sequence) (?:them|these|the (?:steps|stages|events)))|(?:(?:can|could|may) i|i (?:want|would like) to|i['\u2019]d like to) (?:(?:predict|guess|make a (?:prediction|guess))${GUESS_TAIL}|try (?:it|one|this)(?: (?:myself|first|out|now|on my own))*$)|(?:can|could|may) (?:we|i) (?:try|do|have) (?:another|one more)|(?:give|show) me (?:another|one more|one different|a different|a new) (?:one|problem|equation|example to try|exercise)|try me|quiz me|test me|ask me (?:a|one|another) question|check my understanding|what should i (?:predict|choose)|can i practice|(?:steps|stages|events).{0,30}(?:scrambled|jumbled|shuffled)|put (?:them|these|the steps) (?:back )?in order)\b`);
// A bare what-if about the learner's own things ("what if I lower my expectations?") is left unlabelled.
const OWN = String.raw`(?!\w+ (?:my|our)\b)`;
// "Let me" and "can I" ask the tutor for a turn. A stated wish to play needs a lesson object.
const TURN = String.raw`(?:let me|(?:can|could|may) i)`;
const DET = String.raw`(?:the|this|these|that|those|it|a|some)`;
const QUANTITY = String.raw`(?:values?|parameters?|numbers?|variables?|inputs?|rates?|sliders?|slope|angle|graph)`;
const PLAY = String.raw`${TURN} play with ${DET}\b|${ASK} play with (?:(?:it|this|that|these|those)(?:$| (?:and|to|for|myself|first|now)\b)|(?:the|this|that|these|those|a|some) (?:\w+ ){0,2}${QUANTITY}\b)`;
const MANIPULATE = new RegExp(String.raw`\b(?:what (?:happens|changes|would happen|would change) (?:if|when) i ${OWN}${VARY}|what if i ${OWN}${VARY}|${ASK} (?:experiment|mess around|tinker|fiddle) with ${DET}\b|${PLAY}|(?:let me|can i|could i) (?:adjust|vary|change) (?:the |a )?(?:values?|parameters?|rate|numbers?)|${ASK} try (?:changing|adjusting|varying|tweaking|dragging)|${ASK} (?:adjust|vary|change|move|tweak|drag)\b.{0,100}\b(?:watch|see|observe)|(?:watch|see) what (?:happens|changes) (?:as|when) i (?:adjust|vary|change))\b`);
// Account and app chores share verbs with manipulation ("change my password and see my account").
const CHORE = /\b(?:pass(?:word|code)|e-?mail|accounts?(?! balance)|user ?name|display name|login|log(?:ging)? (?:in|out) (?:to|of)|sign(?:ing)? (?:in|up|out)|settings?|fonts?|(?:app|colou?r|dark|light) (?:theme|mode)|subscription|billing|my profile|avatar|notifications?|api key|time ?zone|my (?:mind|major|schedule))\b/;
// "Let me guess, you want me to memorize it" states the guess. A sequencing word after the comma keeps the request.
const STATED_GUESS = /\blet me guess\s*[,:\u2013\u2014-]+\s*(?=(?:you|it|that|this|the|there|they|he|she|we|i|is|are)\b)/g;
// Declining help is not declining the attempt: "let me predict without hints".
const UNAIDED = /\bwithout (?:any |a |the |your )?(?:hints?|help|clues?|answers?|spoilers?|looking|peeking)\b/g;
const STRUCTURE = /\b(?:arrange|connect|map out|organize|lay out)\b.{0,45}\b(?:connections|relationships|nodes|parts|concepts)\b/;
const CODE = /\b(?:fix|debug|run|test|edit|change)\b.{0,90}\b(?:example inputs?|test cases?|by running|and run)\b|\b(?:broken|incomplete) (?:function|loop|program|snippet|code)\b.{0,60}\b(?:fix|repair|debug|run)\b/;
// Two adjacent sentences can name the requested starter first and assign the work to the learner second.
const STARTER_REQUEST = /^(?:please )?(?:give|send|show|make|write|create|provide)(?: (?:me|us))? (?:a|an|another|one) (?:(?:short|tiny|small|new|fresh|simple|buggy|broken|faulty|incomplete|debugging) ){0,5}(?:(?:python|javascript|typescript|js|ts) (?:loop|function|script|program|snippet|example|exercise)|(?:loop|function|script|program|snippet|example|exercise) (?:in|using) (?:python|javascript|typescript|js|ts))\b/;
const EDIT_STARTER = /^(?:(?:i|we) (?:want to|would like to|can|will)|(?:let|help) (?:me|us)(?: to)?) (?:edit|debug|fix|repair|run|test|complete) (?:it|this|that|the (?:code|loop|script|function|program|example))\b/;
const DECLINED_LANGUAGE = /^(?:no|skip|avoid|without|(?:don['’]t|do not) use) (?:any )?(?:python|javascript|typescript|js|ts)(?: (?:code|coding challenges?|examples?))?(?: please)?$/i;
const RECALL = /\b(?:which (?:ones|words|terms|items) i can (?:recall|remember)|see (?:if|what) i (?:remember|recall)|let me (?:recall|retrieve)|test my (?:memory|recall))\b/;
const REMINDER = /\b(?:still (?:want|need|waiting for|would like)|(?:already|previously) asked for|(?:that |the one )?i asked for|as (?:i )?(?:asked|requested)|i meant (?:with|the|a))\b/;

export function classifyOpenUiCue(text: string | null | undefined): OpenUiDiagnosticCue {
  if (!text?.trim() || text.length > 6000) return { kind: "unknown", targets: [] };
  const normalized = learnerCueProse(text).replace(/\bcodingchallenge\b/gi, "coding challenge");
  const value = normalized.trim().toLowerCase();
  const clauses = value.split(/(?:[.!?;,\n]|\bbut\b)/).map(s => s.trim()).filter(Boolean);
  const positive = clauses.filter(clause => !NEGATION.test(clause));
  // Prediction and manipulation cues tolerate a comma before the observed outcome and a declined hint.
  // Other families keep the stricter clause list.
  const attempts = value.replace(STATED_GUESS, "").replace(/,\s*(?:and |then |to )+(?=(?:see|watch|observe)\b)/g, " and ")
    .split(/(?:[.!?;,\n]|\bbut\b)/).map(s => s.replace(UNAIDED, "").trim())
    .filter(clause => clause && !NEGATION.test(clause) && !CHORE.test(clause));
  const reminder = positive.some(clause => REMINDER.test(clause));
  const cue = (kind: "explicit-interface" | "implicit-action", targets: string[]): OpenUiDiagnosticCue =>
    reminder ? { kind, targets, repeat: true } : { kind, targets };
  const targets = new Set<string>();
  for (const clause of positive) {
    // A mention in a past report or a negated request cannot establish a requested interface.
    if (/\b(?:what (?:is|was)|what does|talk about|explain (?:what|why)|how (?:do|does|did))\b/.test(clause) && !/\b(?:make|create|build|draw|give me)\b/.test(clause)) continue;
    const request = POSITIVE_REQUEST.test(clause) || REMINDER.test(clause);
    for (const [kind, pattern] of NAMED) {
      if (!pattern.test(clause)) continue;
      if (request || /^(?:a |an |some )?(?:flash\s?cards?|quiz|simulation|diagram|study plan|exam)(?: please)?$/i.test(clause)) targets.add(kind);
    }
    if (!targets.size && request && /\b(?:openui|interactive (?:interface|activity|surface)|clickable activity)\b/.test(clause)) targets.add("any");
  }
  const direct = DIRECT.test(value) || clauses.some(clause => SYMBOL_ONLY.test(clause));
  const codeClauses = clauses.map(clause => clause.replace(UNAIDED,"").trim());
  const sentences = value.split(/(?:[.!?;\n]|\bbut\b)/).map(sentence => sentence.replace(UNAIDED,"").trim()).filter(Boolean);
  const sharedStarter = sentences.some((sentence, i) => STARTER_REQUEST.test(sentence) && !NEGATION.test(sentence)
    && EDIT_STARTER.test(sentences[i+1] ?? "") && !NEGATION.test(sentences[i+1] ?? ""));
  const positiveCode = codeClauses.some(clause => !NEGATION.test(clause) && requestedCodePracticeLanguage(clause));
  const practiceText = normalized.split(/(?:[.!?;,\n]|\bbut\b)/i).filter(clause => !DECLINED_LANGUAGE.test(clause.trim())).join(". ");
  const codeLanguage = direct ? null : ((positiveCode || sharedStarter ? requestedCodePracticeLanguage(practiceText) : null)
    ?? contextualExerciseLanguage(normalized, sentences));
  if (codeLanguage) {
    const namedEditor = positive.some(clause => /\b(?:editor|editable|code fence)\b/.test(clause));
    const namedChallenge = targets.has("coding-challenge") && positive.some(clause => /\bcoding challenges?\b/.test(clause));
    const namedFence = positive.some(clause => /\b(?:code fence|markdown (?:code )?(?:block|editor))\b/.test(clause));
    const declineChallenge = clauses.some(clause => NEGATION.test(clause) && /\bcoding challenges?\b/.test(clause));
    const surfaces = codeLanguage === "python" || namedFence || declineChallenge ? ["editable-code"]
      : namedChallenge ? ["coding-challenge"] : ["coding-challenge", "editable-code"];
    return { ...cue(namedEditor || namedChallenge ? "explicit-interface" : "implicit-action", surfaces), codeLanguage };
  }
  if (targets.size) return cue("explicit-interface", [...targets].sort());
  if (direct) return { kind: "direct-text", targets: [] };
  if (attempts.some(c => MANIPULATE.test(c))) return cue("implicit-action", ["simulation"]);
  if (positive.some(c => STRUCTURE.test(c) && /\b(?:like to|want to|let me|could i|can i|help me)\b/.test(c))) return cue("implicit-action", ["concept-map", "diagram"]);
  if (positive.some(c => CODE.test(c) && /\b(?:give me|let me|could i|can i|i can|want to)\b/.test(c))) return cue("implicit-action", ["coding-challenge"]);
  if (positive.some(c => RECALL.test(c))) return cue("implicit-action", ["question", "quiz", "deck", "language-practice"]);
  if (attempts.some(c => PRACTICE.test(c)) || (!CHORE.test(value) && asksForNamedPrediction(sentences))) return cue("implicit-action", ["question", "quiz"]);
  // Unrecognized scripts and requests too ambiguous to classify remain measurable as unknown.
  if (!/[a-z]/i.test(value)) return { kind: "unknown", targets: [] };
  return { kind: "none", targets: [] };
}

// Conservative on purpose. "No tests" can mean unit tests and "no questions" can mean the learner has none.
const TESTED = String.raw`(?:(?:pop |practice |mock )?quiz(?:zes)?|exams?|checkpoints?|predictions?|assessments?|quizzing|testing)`;
const DECLINE_NOUN = new RegExp(String.raw`^(?:(?:ok(?:ay)?|so|also|oh|please|just) )*(?:no|skip|hold|drop)(?: (?:more|another|any|the|a|further))* ${TESTED}(?: (?:please|thanks|thank you|this time|for now|right now|today|yet|at all|for me|either))*$`);
const DECLINE_VERB = /^(?:(?:ok(?:ay)?|so|also|oh|please|just) )*(?:(?:don't|do not|stop|quit) (?:quiz(?:zing)?|test(?:ing)?|examin(?:e|ing)|grad(?:e|ing)) me\b|(?:don't|do not) (?:ask|give|set) me (?:(?:any|more|a|another) )*(?:(?:pop |practice )?quiz(?:zes)?|exams?|questions?)\b|(?:don't|do not) (?:make|ask|have) me (?:to )?(?:predict|guess)\b|i (?:don't|do not) want (?:(?:a|another|any) (?:(?:pop |practice )?quiz(?:zes)?|exams?)|to be (?:quizzed|tested|examined|graded))\b)/;
const DECLINE_WITHOUT = /\bwithout (?:(?:a|an|any|another|the) )?(?:(?:pop |practice )?quiz(?:zes)?|exams?)\b|\bwithout (?:being (?:quizzed|tested)|(?:quizzing|testing) me)\b/;
const SPEECH = /\b(?:said|says|say|asked|told|wrote|writes)\b/;

/** An explicit opt-out in the learner's own words. Quoted, reported and hypothetical wording stays false. Unreadable text is null. */
export function observeAssessmentOptOut(text: string | null | undefined): boolean | null {
  if (!text?.trim() || text.length > 6000) return null;
  const value = learnerCueProse(text).toLowerCase();
  if (!/[a-z]/.test(value)) return null;
  return value.split(/[.!?;:,\n()]|\s[-\u2013\u2014]+\s|\u2014|\b(?:but|and)\b/).map(clause => clause.trim().replace(/\s+/g, " "))
    .some(clause => DECLINE_NOUN.test(clause) || DECLINE_VERB.test(clause) || (DECLINE_WITHOUT.test(clause) && !SPEECH.test(clause)));
}

const QUESTION_INTERFACES = ["question", "question-group", "quiz", "exam"];
const hasQuestionInterface = (components: readonly string[]) => components.some(kind => QUESTION_INTERFACES.includes(kind));

/**
 * Checkpoint signals in one released reply. The simulation brief and reply text share the policy's
 * instruction rule, so voluntary, negated, quoted and mid-sentence wording is not a signal.
 */
export function observeAssessmentCheckpoints(reply: { components: readonly string[]; simulationBriefs: readonly string[]; prose: string }): AssessmentCheckpointSignal[] {
  const lines = learnerCueProse(reply.prose).split("\n")
    .map(line => line.replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+/, "").replace(/[*_]{1,3}/g, "").trim());
  const found: Record<AssessmentCheckpointSignal, boolean> = {
    "simulation-brief": reply.simulationBriefs.some(brief => inspectSimulationBrief(brief).imposed),
    "question-interface": hasQuestionInterface(reply.components),
    "reply-text": lines.some(line => line.length > 0 && inspectSimulationBrief(line).imposed),
  };
  return ASSESSMENT_CHECKPOINT_SIGNALS.filter(signal => found[signal]);
}

export function openUiMatchesTargets(components: readonly string[], targets: readonly string[]): boolean {
  const actual = new Set(components.filter(isOpenUiDiagnosticInterface).map(kind => kind === "question-group" ? "question" : kind));
  return targets.some(kind => kind === "any" ? actual.size > 0 : actual.has(kind === "question-group" ? "question" : kind));
}

const ROW_KEYS = ["schemaVersion", "conversationId", "turnId", "turnIndex", "model", "requestedModel", "mode", "cue", "reply",
  "attempted", "compiled", "selected", "rendered", "guidance", "experiment", "fit", "draftAttempts", "selection", "pairReviews", "finalComparison", "gateIssues", "decisionModel", "decisionFailure", "outsideWords", "nativePageRequested", "nativePage", "editableCode", "codingChallengeLanguages", "editorOutsideWords", "replyElapsedMs", "assessment"];
type RecordValue = Record<string, unknown>;
function fields(value: unknown, allowed: readonly string[]): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
}

const ID_PATTERN = "^[a-zA-Z0-9][a-zA-Z0-9_.:@/+~-]{0,159}$";
const opaqueId = new RegExp(ID_PATTERN);
function identifier(value: unknown): value is string { return typeof value === "string" && opaqueId.test(value); }

function member<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function componentList(value: unknown, targets = false, allowEditor = false): value is string[] {
  return Array.isArray(value) && value.length <= COMPONENTS.length + 2
    && value.every(kind => typeof kind === "string" && (COMPONENTS.includes(kind) || (targets && kind === "any") || (allowEditor && kind === "editable-code")))
    && new Set(value).size === value.length;
}

function nullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function validCue(value: unknown): value is OpenUiDiagnosticCue {
  if (!fields(value, ["kind", "targets", "repeat", "codeLanguage"]) || !member(value.kind, OPENUI_DIAGNOSTIC_CUES) || !componentList(value.targets, true, true)
    || (value.codeLanguage !== undefined && (!value.targets.some(target => target === "editable-code" || target === "coding-challenge") || !member(value.codeLanguage, EDITABLE_CODE_LANGUAGES)))
    || (value.repeat !== undefined && typeof value.repeat !== "boolean")) return false;
  const opportunity = value.kind === "explicit-interface" || value.kind === "implicit-action";
  return opportunity === (value.targets.length > 0) && (opportunity || value.repeat !== true);
}

function validGuidance(value: unknown): boolean {
  return value === null || (fields(value, ["source", "action", "delivered", "targets", "reason", "codeLanguage"])
    && member(value.source, ["jev", "other", "unknown"]) && member(value.action, ["create", "continue", "grade-first", "none", "unknown"])
    && nullableBoolean(value.delivered) && componentList(value.targets, true) && (value.reason === undefined || member(value.reason, INTERACTION_REASONS))
    && (value.codeLanguage === undefined || member(value.codeLanguage, EDITABLE_CODE_LANGUAGES)));
}

function validAssessment(value: unknown, reply: unknown, selected: unknown): boolean {
  if (!fields(value, ["optOut", "checkpoints"]) || typeof value.optOut !== "boolean") return false;
  const signals = value.checkpoints;
  if (signals === null) return true;
  return reply === "released" && Array.isArray(signals) && signals.every(signal => member(signal, ASSESSMENT_CHECKPOINT_SIGNALS))
    && new Set(signals).size === signals.length
    && (!Array.isArray(selected) || signals.includes("question-interface") === hasQuestionInterface(selected as string[]));
}

function validNativePage(value: unknown, requested: unknown): boolean {
  if (!fields(value, NATIVE_PAGE_STAGES) || !NATIVE_PAGE_STAGES.every(key => nullableBoolean(value[key]))) return false;
  if (requested === false && NATIVE_PAGE_STAGES.some(key => value[key] === true)) return false;
  const preview = [value.ready, value.frameFailed, value.visible, value.opened].includes(true);
  const published = value.saved === true || value.mounted === true || preview;
  if (value.succeeded === false && (value.attached === true || published)) return false;
  if (value.attached === false && published) return false;
  if (value.mounted === false && preview) return false;
  return value.ready !== false || (value.opened !== true && value.visible !== true);
}

export function isOpenUiDiagnosticTurn(value: unknown): value is OpenUiDiagnosticTurn {
  return fields(value, ROW_KEYS) && value.schemaVersion === 1 && identifier(value.conversationId) && identifier(value.turnId)
    && typeof value.turnIndex === "number" && Number.isSafeInteger(value.turnIndex) && value.turnIndex >= 0
    && (value.model === null || identifier(value.model)) && member(value.mode, OPENUI_DIAGNOSTIC_MODES)
    && validCue(value.cue) && member(value.reply, REPLIES) && nullableBoolean(value.attempted)
    && (value.replyElapsedMs == null || ((value.reply === "released" || value.reply === "withheld")
      && typeof value.replyElapsedMs === "number" && Number.isSafeInteger(value.replyElapsedMs) && value.replyElapsedMs >= 0))
    && (value.nativePageRequested === undefined || nullableBoolean(value.nativePageRequested))
    && (value.nativePage === undefined || validNativePage(value.nativePage, value.nativePageRequested))
    && (value.editableCode == null || (value.reply === "released" && Array.isArray(value.editableCode)
      && value.editableCode.every(lang => member(lang, EDITABLE_CODE_LANGUAGES)) && new Set(value.editableCode).size === value.editableCode.length))
    && (value.codingChallengeLanguages == null || (value.reply === "released" && Array.isArray(value.selected)
      && Array.isArray(value.codingChallengeLanguages) && value.codingChallengeLanguages.every(lang => member(lang, CODING_CHALLENGE_LANGUAGES))
      && new Set(value.codingChallengeLanguages).size === value.codingChallengeLanguages.length
      && value.selected.includes("coding-challenge") === (value.codingChallengeLanguages.length > 0)))
    && (value.editorOutsideWords == null || (Array.isArray(value.editableCode) && value.editableCode.length > 0
      && typeof value.editorOutsideWords === "number" && Number.isSafeInteger(value.editorOutsideWords) && value.editorOutsideWords >= 0))
    && [value.compiled, value.selected, value.rendered].every(v => v === null || componentList(v))
    && (value.outsideWords == null || (typeof value.outsideWords === "number" && Number.isSafeInteger(value.outsideWords) && value.outsideWords >= 0))
    && validGuidance(value.guidance)
    && (value.selection === undefined || (value.reply === "released" && isTeachingDraftSelection(value.selection)))
    && (value.pairReviews === undefined || validOpenUiPairReviews(value.pairReviews))
    && (value.finalComparison === undefined || validOpenUiFinalComparison(value.finalComparison, value.pairReviews))
    && (value.draftAttempts === undefined || (Number.isSafeInteger(value.draftAttempts) && (value.draftAttempts as number) >= 0))
    && (value.decisionModel === undefined || value.decisionModel === null || identifier(value.decisionModel))
    && (value.decisionFailure === undefined || isDecisionPlanningFailure(value.decisionFailure))
    && (value.requestedModel === undefined || identifier(value.requestedModel))
    && (value.assessment === undefined || validAssessment(value.assessment, value.reply, value.selected))
    && (value.gateIssues === undefined || (Array.isArray(value.gateIssues) && value.gateIssues.length <= OPENUI_DIAGNOSTIC_GATE_ISSUES.length
      && value.gateIssues.every(id => typeof id === "string" && isOpenUiDiagnosticGateIssue(id)) && new Set(value.gateIssues).size === value.gateIssues.length))
    && (value.experiment === undefined || (fields(value.experiment, ["experimentId", "caseId", "pairId"])
      && [value.experiment.experimentId, value.experiment.caseId, value.experiment.pairId].every(identifier)))
    && (value.fit === undefined || (fields(value.fit, ["source", "passed"]) && identifier(value.fit.source) && nullableBoolean(value.fit.passed)));
}

export function parseOpenUiDiagnosticExport(value: unknown): OpenUiDiagnosticTurn[] {
  const rows = fields(value, ["schemaVersion", "turns"]) && value.schemaVersion === 1 ? value.turns : value;
  if (!Array.isArray(rows)) throw new Error("Expected diagnostic turns or a version 1 export with a turns array.");
  for (const [index, row] of rows.entries()) {
    if (!isOpenUiDiagnosticTurn(row)) throw new Error("Invalid OpenUI diagnostic turn at row " + (index + 1) + ". Check version, allowed fields and component names.");
  }
  return rows as OpenUiDiagnosticTurn[];
}

const identifierSchema = { type: "string", pattern: ID_PATTERN };
const measuredBoolean = { type: ["boolean", "null"] };
const stringList = (options: string[]) => ({ type: "array", uniqueItems: true, maxItems: options.length, items: { enum: options } });
const targetsSchema = stringList([...COMPONENTS, "any"]);
const measuredComponents = { anyOf: [stringList(COMPONENTS), { type: "null" }] };
const recordSchema = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) =>
  ({ type: "object", additionalProperties: false, required, properties });
const requiredTurnKeys = ROW_KEYS.filter(k => !["fit", "experiment", "requestedModel", "decisionModel", "decisionFailure", "draftAttempts", "selection", "pairReviews", "finalComparison", "gateIssues", "outsideWords", "nativePageRequested", "nativePage", "editableCode", "codingChallengeLanguages", "editorOutsideWords", "replyElapsedMs", "assessment"].includes(k));
const cueSchema = {
  ...recordSchema({ kind: { enum: OPENUI_DIAGNOSTIC_CUES }, targets: stringList([...COMPONENTS, "any", "editable-code"]),
    repeat: { type: "boolean" }, codeLanguage: { enum: EDITABLE_CODE_LANGUAGES } }, ["kind", "targets"]),
  allOf: [{
    if: { properties: { kind: { enum: ["explicit-interface", "implicit-action"] } } },
    then: { properties: { targets: { minItems: 1 } } }, else: { properties: { targets: { maxItems: 0 }, repeat: { const: false } } },
  }, { if: { required: ["codeLanguage"] }, then: { properties: { targets: { contains: { enum: ["editable-code", "coding-challenge"] } } } } }],
};
const turnSchema = recordSchema({
  schemaVersion: { const: 1 }, conversationId: identifierSchema, turnId: identifierSchema,
  turnIndex: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  model: { anyOf: [identifierSchema, { type: "null" }] }, mode: { enum: OPENUI_DIAGNOSTIC_MODES }, cue: cueSchema,
  requestedModel: identifierSchema,
  reply: { enum: REPLIES }, attempted: measuredBoolean, compiled: measuredComponents, selected: measuredComponents, rendered: measuredComponents,
  guidance: { anyOf: [{ type: "null" }, recordSchema({
    source: { enum: ["jev", "other", "unknown"] }, action: { enum: ["create", "continue", "grade-first", "none", "unknown"] },
    delivered: measuredBoolean, targets: targetsSchema, reason: { enum: INTERACTION_REASONS }, codeLanguage: { enum: EDITABLE_CODE_LANGUAGES },
  }, ["source", "action", "delivered", "targets"])] },
  experiment: recordSchema({ experimentId: identifierSchema, caseId: identifierSchema, pairId: identifierSchema }),
  fit: recordSchema({ source: identifierSchema, passed: measuredBoolean }),
  draftAttempts: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, gateIssues: stringList(OPENUI_DIAGNOSTIC_GATE_ISSUES),
  pairReviews: OPENUI_PAIR_REVIEWS_SCHEMA,
  finalComparison: OPENUI_FINAL_COMPARISON_SCHEMA,
  selection: { ...recordSchema({ attempt: { type: "integer", minimum: 1, maximum: 10 },
    review: { enum: ["verified", "best-effort"] }, rule: { enum: TEACHING_DRAFT_SELECTION_RULES } }, ["attempt", "review"]),
    allOf: [{ if: { properties: { review: { const: "verified" } } }, then: { properties: { rule: { enum: ["none", "requested-prediction-over-prose"] } } },
      else: { properties: { rule: { enum: ["none", "presentation-only-checkpoint-retained"] } } } }] },
  decisionModel: { anyOf: [identifierSchema, { type: "null" }] },
  decisionFailure: DECISION_PLANNING_FAILURE_SCHEMA,
  outsideWords: { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER,
    description: "Whitespace-delimited words outside OpenUI segments in the final reply, including ordinary Markdown fence labels and code." },
  replyElapsedMs: { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER,
    description: "Elapsed milliseconds from the browser observing this learner turn start to the completed final public reply or withholding notice." },
  nativePageRequested: measuredBoolean,
  editableCode: { anyOf: [stringList([...EDITABLE_CODE_LANGUAGES]), { type: "null" }] },
  codingChallengeLanguages: { anyOf: [stringList([...CODING_CHALLENGE_LANGUAGES]), { type: "null" }],
    description: "Languages of compiled CodingChallenge nodes in released text. Missing or null is unmeasured." },
  editorOutsideWords: { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER,
    description: "Words outside eligible editable Markdown fences and OpenUI in a released editor reply. Zero is observed. Missing or null is unmeasured." },
  nativePage: recordSchema(Object.fromEntries(NATIVE_PAGE_STAGES.map(key => [key, measuredBoolean]))),
  assessment: { ...recordSchema({ optOut: { type: "boolean" }, checkpoints: { anyOf: [stringList([...ASSESSMENT_CHECKPOINT_SIGNALS]), { type: "null" }] } }),
    description: "Explicit learner assessment opt-out and content-free checkpoint signals in the released reply. Missing is unobserved. Neither value measures educational fit." },
}, requiredTurnKeys);

/** JSON Schema for a portable versioned export or a direct array of final turn observations. */
export const OPENUI_DIAGNOSTIC_EXPORT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Keating OpenUI diagnostic export v1",
  $defs: {
    turn: { ...turnSchema,
      allOf: [{ if: { required: ["selection"] }, then: { properties: { reply: { const: "released" } } } },
      { if: { required: ["assessment"], properties: { assessment: { properties: { checkpoints: { type: "array" } } } } },
        then: { properties: { reply: { const: "released" } } } },
      { if: { required: ["editorOutsideWords"], properties: { editorOutsideWords: { type: "integer" } } },
        then: { required: ["editableCode"], properties: { reply: { const: "released" }, editableCode: { type: "array", minItems: 1 } } } },
      { if: { required: ["codingChallengeLanguages"], properties: { codingChallengeLanguages: { type: "array" } } },
        then: { properties: { reply: { const: "released" }, selected: { type: "array" } },
          if: { properties: { selected: { contains: { const: "coding-challenge" } } } },
          then: { properties: { codingChallengeLanguages: { minItems: 1 } } }, else: { properties: { codingChallengeLanguages: { maxItems: 0 } } } } }],
      if: { properties: { reply: { enum: ["released", "withheld"] } } },
      else: { properties: { replyElapsedMs: { type: "null" } } },
    },
    turns: { type: "array", items: { $ref: "#/$defs/turn" } },
  },
  oneOf: [{ $ref: "#/$defs/turns" }, recordSchema({ schemaVersion: { const: 1 }, turns: { $ref: "#/$defs/turns" } })],
};
