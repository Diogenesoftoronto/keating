import type { ActiveWork } from "../../../src/judgement/active-work.js";
import type { TeachingPolicyCase, TeachingPolicyTurn } from "../../../src/judgement/teaching-policy-types.js";

/**
 * Authored proxy situations for the plan-review questions and the
 * `progression_requested` decision. Labels are offline evaluation only.
 * Omitted ids are deliberately unlabeled.
 */
export const PLAN_REVIEW_LABEL_IDS = ["focus_demonstrated", "prerequisite_gap", "focus_underspecified", "goal_diverged", "progression_requested"] as const;

const EMPTY_TURN: TeachingPolicyTurn = {
  learnerMessage: "", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [],
  assessment: "none", improvementRuns: 0, domain: "general",
};

interface Focus {
  readonly title: string;
  readonly detail?: string;
  readonly outcomes?: readonly string[];
  readonly correct?: number;
  readonly incorrect?: number;
  readonly dependsOn?: readonly string[];
}

function work(planTitle: string, items: readonly string[], focus: Focus): ActiveWork {
  const correct = focus.correct ?? 0, incorrect = focus.incorrect ?? 0;
  const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const none = { presented: 0, attempted: 0, correct: 0, incorrect: 0, pendingGrade: 0, lastAttemptAt: null, independence: "unknown" as const };
  return {
    plan: { documentId: `plan-${slug(planTitle)}`, revision: 1, title: planTitle,
      outline: items.map((title) => ({ id: slug(title), title, status: title === focus.title ? "in_progress" as const : (focus.dependsOn ?? []).includes(title) ? "done" as const : "not_started" as const, depth: 0 })) },
    focus: {
      itemId: slug(focus.title), title: focus.title, ...(focus.detail ? { detail: focus.detail } : {}), outcomes: [...(focus.outcomes ?? [])],
      dependsOn: (focus.dependsOn ?? []).map((title) => ({ id: slug(title), title, status: "done" as const, evidence: none })),
      evidence: { presented: correct + incorrect, attempted: correct + incorrect, correct, incorrect, pendingGrade: 0, lastAttemptAt: correct + incorrect ? 1 : null, independence: "unknown" },
    },
    openInteractions: [], truncated: false,
  };
}

const labels = (positive: readonly string[], negative: readonly string[]): Record<string, boolean> =>
  Object.fromEntries([...positive.map((id) => [id, true]), ...negative.map((id) => [id, false])]);
const rest = (...positive: string[]) => PLAN_REVIEW_LABEL_IDS.filter((id) => !positive.includes(id));

function planCase(id: string, split: TeachingPolicyCase["split"], activeWork: ActiveWork, learnerMessage: string, conversation: TeachingPolicyTurn["conversation"], expected: Record<string, boolean>): TeachingPolicyCase {
  return { id: `plan-${id}`, family: `plan-${id}`, split, turn: { ...EMPTY_TURN, learnerMessage, conversation, activeWork }, ruleIds: [], expectedDecisions: expected };
}

const fractions = ["Equivalent fractions", "Least common multiple", "Adding fractions with unlike denominators", "Multiplying fractions"];
const spanish = ["Greetings", "Ordering food", "Asking directions", "Past tense of regular verbs"];
const calculus = ["Limits", "Derivatives", "Integration by substitution", "Integration by parts"];
const chemistry = ["Counting atoms in a formula", "Balancing chemical equations", "Stoichiometry"];
const algebra = ["Integer operations", "Solving two-step equations", "Multiplying binomials (FOIL)"];

export const PLAN_REVIEW_CASES: readonly TeachingPolicyCase[] = [
  // Development
  planCase("fractions-mastered", "development",
    work("Fractions", fractions, { title: "Adding fractions with unlike denominators", dependsOn: ["Least common multiple"], outcomes: ["Add two fractions with unlike denominators"], correct: 3 }),
    "Got it, what's next?",
    [{ role: "assistant", content: "Try 1/3 + 1/4 on your own." }, { role: "user", content: "LCM is 12, so 4/12 + 3/12 = 7/12." }, { role: "assistant", content: "Correct. Now 2/5 + 1/2?" }, { role: "user", content: "4/10 + 5/10 = 9/10." }],
    labels(["focus_demonstrated", "progression_requested"], rest("focus_demonstrated", "progression_requested"))),
  planCase("fractions-lcm-gap", "development",
    work("Fractions", fractions, { title: "Adding fractions with unlike denominators", dependsOn: ["Least common multiple"], outcomes: ["Add two fractions with unlike denominators"], incorrect: 2 }),
    "I found a common denominator: 4 + 6 = 10, so 1/4 + 1/6 = 2/10.", [],
    labels(["prerequisite_gap"], rest("prerequisite_gap"))),
  planCase("calculus-vague", "development",
    work("Calculus", ["Calculus"], { title: "Calculus" }),
    "What should we work on first?", [],
    labels(["focus_underspecified"], ["focus_demonstrated", "prerequisite_gap", "goal_diverged"])),
  planCase("spanish-interview", "development",
    work("Spanish for travel", spanish, { title: "Ordering food", outcomes: ["Order a meal and ask for the bill"] }),
    "Actually, I need to prepare for a Python job interview next week. Can we work on that?", [],
    labels(["goal_diverged"], rest("goal_diverged"))),
  planCase("photosynthesis-deeper", "development",
    work("Photosynthesis", ["Light reactions", "Calvin cycle"], { title: "Light reactions", outcomes: ["Explain how light energy produces ATP and NADPH"] }),
    "Can we go deeper into how ATP synthase actually spins?", [],
    labels(["progression_requested"], rest("progression_requested"))),
  planCase("newton-question", "development",
    work("Mechanics", ["Newton's first law", "Newton's second law", "Friction"], { title: "Newton's second law", outcomes: ["Relate force, mass, and acceleration"], incorrect: 1 }),
    "Why does a heavier cart accelerate less with the same push?", [],
    labels([], [...PLAN_REVIEW_LABEL_IDS])),
  planCase("calculus-skip", "development",
    work("Integration", calculus, { title: "Integration by substitution", outcomes: ["Choose a substitution u and rewrite the integral"] }),
    "I already know substitution. Can we skip to integration by parts?", [],
    labels(["progression_requested"], rest("progression_requested"))),
  planCase("history-vague", "development",
    work("World history", ["World history"], { title: "World history" }),
    "Okay, I'm ready. What do you want me to do?", [],
    labels(["focus_underspecified"], ["focus_demonstrated", "prerequisite_gap", "goal_diverged"])),
  planCase("preterite-mastered", "development",
    work("Spanish for travel", spanish, { title: "Past tense of regular verbs", outcomes: ["Conjugate regular -ar, -er, -ir verbs in the preterite"], correct: 4 }),
    "hablaron, comieron, vivieron",
    [{ role: "assistant", content: "Conjugate hablar, comer, vivir for yo." }, { role: "user", content: "hablé, comí, viví" }, { role: "assistant", content: "All correct. Now for ellos." }],
    labels(["focus_demonstrated"], rest("focus_demonstrated"))),
  planCase("equations-integer-gap", "development",
    work("Algebra I", algebra, { title: "Solving two-step equations", dependsOn: ["Integer operations"], outcomes: ["Solve ax + b = c"], incorrect: 2 }),
    "3x - 5 = 10, so I add 5 to both sides and -5 + 10 is -15, so 3x = -15?", [],
    labels(["prerequisite_gap"], rest("prerequisite_gap"))),
  planCase("guitar-cover-letter", "development",
    work("Intro to guitar", ["Open chords", "Strumming patterns", "Chord changes"], { title: "Open chords", outcomes: ["Play G, C, D cleanly"] }),
    "Can you help me write a cover letter for a marketing job?", [],
    labels(["goal_diverged"], rest("goal_diverged"))),
  planCase("programming-vague", "development",
    work("Programming", ["Programming"], { title: "Programming" }),
    "Give me something to try.", [],
    labels(["focus_underspecified"], ["focus_demonstrated", "prerequisite_gap", "goal_diverged"])),
  planCase("foil-mastered", "development",
    work("Algebra I", algebra, { title: "Multiplying binomials (FOIL)", outcomes: ["Expand a product of two binomials"], correct: 3 }),
    "(x + 4)(x - 1) = x² + 3x - 4",
    [{ role: "assistant", content: "Expand (x + 2)(x + 3) yourself." }, { role: "user", content: "x² + 5x + 6" }, { role: "assistant", content: "Right. Try (x + 4)(x - 1)." }],
    labels(["focus_demonstrated"], rest("focus_demonstrated"))),
  planCase("balancing-atoms-gap", "development",
    work("Chemistry basics", chemistry, { title: "Balancing chemical equations", dependsOn: ["Counting atoms in a formula"], outcomes: ["Balance a simple reaction"], incorrect: 1 }),
    "H2O only has 2 atoms, right? So H2 + O2 → H2O is already balanced.", [],
    labels(["prerequisite_gap"], rest("prerequisite_gap"))),
  planCase("algebra-sourdough", "development",
    work("Algebra I", algebra, { title: "Solving two-step equations", outcomes: ["Solve ax + b = c"] }),
    "Forget algebra for now, I want to learn to bake sourdough bread.", [],
    labels(["goal_diverged"], ["focus_demonstrated", "prerequisite_gap", "focus_underspecified"])),

  // Holdout
  planCase("derivatives-mastered", "holdout",
    work("Calculus I", calculus, { title: "Derivatives", outcomes: ["Differentiate polynomials with the power rule"], correct: 3 }),
    "d/dx of 4x³ - 2x is 12x² - 2. Can we move on?",
    [{ role: "assistant", content: "Differentiate x⁵ on your own." }, { role: "user", content: "5x⁴" }, { role: "assistant", content: "Correct." }],
    labels(["focus_demonstrated", "progression_requested"], ["prerequisite_gap", "focus_underspecified", "goal_diverged"])),
  planCase("stoich-balancing-gap", "holdout",
    work("Chemistry basics", chemistry, { title: "Stoichiometry", dependsOn: ["Balancing chemical equations"], outcomes: ["Convert between moles of reactants and products"], incorrect: 2 }),
    "For H2 + O2 → H2O, 1 mole of O2 makes 1 mole of water, since the equation is 1 to 1.", [],
    labels(["prerequisite_gap"], rest("prerequisite_gap"))),
  planCase("music-vague", "holdout",
    work("Music", ["Music"], { title: "Music" }),
    "Where do we start?", [],
    labels(["focus_underspecified"], ["focus_demonstrated", "prerequisite_gap", "goal_diverged"])),
  planCase("fractions-taxes", "holdout",
    work("Fractions", fractions, { title: "Multiplying fractions", outcomes: ["Multiply two fractions and simplify"] }),
    "Can you walk me through filing my self-employment taxes instead?", [],
    labels(["goal_diverged"], rest("goal_diverged"))),
  planCase("mechanics-back", "holdout",
    work("Mechanics", ["Newton's first law", "Newton's second law", "Friction"], { title: "Friction", outcomes: ["Compute kinetic friction force"] }),
    "Can we go back to Newton's second law for a bit before friction?", [],
    labels(["progression_requested"], ["focus_demonstrated", "focus_underspecified", "goal_diverged"])),
  planCase("spanish-question", "holdout",
    work("Spanish for travel", spanish, { title: "Asking directions", outcomes: ["Ask where a place is and understand left/right"] }),
    "How do I say 'where is the train station'?", [],
    labels([], [...PLAN_REVIEW_LABEL_IDS])),
  planCase("biology-vague", "holdout",
    work("Biology", ["Biology"], { title: "Biology" }),
    "I'm ready for the next thing.", [],
    labels(["focus_underspecified"], ["focus_demonstrated", "prerequisite_gap", "goal_diverged"])),
  planCase("greetings-mastered", "holdout",
    work("Spanish for travel", spanish, { title: "Greetings", outcomes: ["Greet someone formally and informally"], correct: 3 }),
    "Buenas tardes, señora. ¿Cómo está usted?",
    [{ role: "assistant", content: "Greet a friend informally." }, { role: "user", content: "¡Hola! ¿Qué tal?" }, { role: "assistant", content: "Perfect. Now greet an older stranger in the afternoon." }],
    labels(["focus_demonstrated"], rest("focus_demonstrated"))),
  planCase("lcm-equivalent-gap", "holdout",
    work("Fractions", fractions, { title: "Adding fractions with unlike denominators", dependsOn: ["Equivalent fractions"], outcomes: ["Add two fractions with unlike denominators"], incorrect: 1 }),
    "To get 1/3 over 12, I multiply the bottom by 4: 1/12. Then 1/12 + 3/12 = 4/12.", [],
    labels(["prerequisite_gap"], rest("prerequisite_gap"))),
  planCase("guitar-website", "holdout",
    work("Intro to guitar", ["Open chords", "Strumming patterns", "Chord changes"], { title: "Strumming patterns", outcomes: ["Keep a steady down-up pattern"] }),
    "I'd rather build a personal website with HTML. Can we do that?", [],
    labels(["goal_diverged"], rest("goal_diverged"))),
  planCase("art-vague", "holdout",
    work("Art", ["Art"], { title: "Art" }),
    "Let's begin.", [],
    labels(["focus_underspecified"], ["focus_demonstrated", "prerequisite_gap", "goal_diverged"])),
  planCase("equations-mastered", "holdout",
    work("Algebra I", algebra, { title: "Solving two-step equations", outcomes: ["Solve ax + b = c"], correct: 4 }),
    "2x + 7 = 15, so 2x = 8 and x = 4.",
    [{ role: "assistant", content: "Solve 5x - 3 = 12 on your own." }, { role: "user", content: "5x = 15, x = 3." }, { role: "assistant", content: "Correct. One more." }],
    labels(["focus_demonstrated"], rest("focus_demonstrated"))),
  planCase("parts-derivative-gap", "holdout",
    work("Integration", calculus, { title: "Integration by parts", dependsOn: ["Derivatives"], outcomes: ["Apply ∫u dv = uv - ∫v du"], incorrect: 2 }),
    "For ∫x·eˣ dx I set u = x, so du = x² / 2 dx?", [],
    labels(["prerequisite_gap"], rest("prerequisite_gap"))),
  planCase("chemistry-car", "holdout",
    work("Chemistry basics", chemistry, { title: "Counting atoms in a formula", outcomes: ["Count each element's atoms in a formula"] }),
    "Never mind chemistry, how do I change the oil in my car?", [],
    labels(["goal_diverged"], ["focus_demonstrated", "prerequisite_gap", "focus_underspecified"])),
  planCase("fractions-skip", "holdout",
    work("Fractions", fractions, { title: "Equivalent fractions", outcomes: ["Generate equivalent fractions"] }),
    "This is too easy for me. Let's jump ahead to multiplying fractions.", [],
    labels(["progression_requested"], ["prerequisite_gap", "focus_underspecified", "goal_diverged"])),
];
