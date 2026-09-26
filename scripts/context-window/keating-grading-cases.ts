import { openResponseState, openResponseQuestion, openResponseEvidenceQuestion, splitResponseSentences, type OpenResponseGradeInput } from "../../packages/learner-contracts/src/judgement/assessment.js";
import type { JudgementRequest } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { emptyTurn } from "./cases.js";
import type { KeatingScenario } from "./keating-types.js";

interface GradingFixture {
  id: string; family: string; split: "development" | "holdout"; title: string;
  input: OpenResponseGradeInput; score: number; evidence: string;
  explanation: string; failureMode: string;
}

/** Authored grading episodes, not observations of actual learner performance. */
export function gradingFixtures(): GradingFixture[] {
  const families = [
    {
      family: "grading-osmosis-meaning", split: "development" as const,
      question: "Two compartments have a membrane permeable to water but not sugar; A is dilute and B is concentrated. Explain the net movement of water before equilibrium.",
      referenceAnswer: "Water moves from A to B through the membrane by osmosis, toward the higher sugar concentration.",
      rubric: "Requires net movement of water from A to B and an explanation that water crosses toward higher sugar concentration while sugar cannot cross. Equivalent wording earns full credit. Reversing the direction and concentration explanation is a substantive error, not a minor imprecision.",
      answers: [
        { text: "The solvent passes from the dilute side A into the more sugary side B because the barrier lets water through but holds the sugar back.", score: 4, explanation: "All required elements are present in equivalent language: water, A to B, higher solute concentration, and selective permeability." },
        { text: "The solvent passes from the sugary side B into the dilute side A because water always moves toward the lower sugar concentration while the barrier holds the sugar back.", score: 1, explanation: "It names the relevant process but reverses the central direction and causal explanation; the substance is wrong." },
      ], failureMode: "Keyword overlap can hide a reversed explanation; paraphrase should still receive full credit.",
    },
    {
      family: "grading-code-output-explanation", split: "development" as const,
      question: "Python: values = [2, 4]; alias = values; alias.append(6); print(values). Give the printed list and explain why values changes.",
      referenceAnswer: "It prints [2, 4, 6] because alias and values refer to the same mutable list; append mutates that list.",
      rubric: "Requires both the exact output [2, 4, 6] and a correct explanation of shared object identity and mutation. Correct output with an incorrect copying explanation is partially correct, with a required element wrong.",
      answers: [
        { text: "The output is [2, 4, 6] because assignment copies the list and Python automatically synchronizes changes between the two copies.", score: 2, explanation: "The output is correct, but the required explanation falsely describes copying and synchronization." },
        { text: "It prints [2, 4, 6] because both names point at one list and append changes that shared object.", score: 4, explanation: "Both output and the explanation of aliasing and mutation meet the rubric." },
      ], failureMode: "A correct final answer must not conceal a wrong explanation.",
    },
    {
      family: "grading-source-quotation", split: "holdout" as const,
      question: "A mayor's campaign leaflet says 'Our new bridge made every resident prosperous.' In your own analysis, identify the claim and one reason this source alone cannot establish it.",
      referenceAnswer: "The leaflet claims universal prosperity caused by the bridge; its campaigning purpose and lack of resident outcome evidence mean the claim is not established by the leaflet alone.",
      rubric: "Requires identifying the universal prosperity claim and giving a source-evaluation reason it is not established (such as promotional purpose or absent outcome evidence). Merely attributing or quoting the claim supplies only the first required element. Copying a claim is not endorsing or evaluating it.",
      answers: [
        { text: "The leaflet's claim is that the bridge made every resident prosperous, but a campaign's promotional assertion without residents' outcome data cannot establish that claim.", score: 4, explanation: "The learner identifies the universal claim and independently explains the evidential limitation." },
        { text: "The mayor's leaflet says that the new bridge made every resident prosperous.", score: 2, explanation: "The claim is accurately attributed, but the required source-evaluation reason is missing." },
      ], failureMode: "Do not credit a quoted source assertion as the learner's own critical evaluation.",
    },
    {
      family: "grading-multistep-lab-explanation", split: "holdout" as const,
      question: "A sealed flask containing vinegar and baking soda has mass 150 g before and after they react. Explain the unchanged mass and predict what happens to the measured flask mass if the stopper is removed and carbon dioxide escapes.",
      referenceAnswer: "Mass is unchanged in the sealed system because atoms are conserved and gas remains inside; after opening, measured flask mass falls as carbon dioxide leaves, although total mass including escaped gas is conserved.",
      rubric: "Full credit requires conserved matter in the sealed system, retained gas, and lower measured flask mass when gas escapes. Correctly explaining the sealed result while explicitly not supplying the open-flask prediction is partial credit, not a minor gap.",
      answers: [
        { text: "The sealed flask stays at 150 g because matter is conserved and the gas stays inside, but I do not know what the balance reads after the stopper is removed.", score: 2, explanation: "The sealed-system explanation is correct; the second required prediction is explicitly absent." },
        { text: "The sealed flask keeps its mass because matter is conserved and gas is trapped; after opening, its measured mass decreases as carbon dioxide leaves, with total matter including the escaped gas still conserved.", score: 4, explanation: "Both requested stages and the distinction between measured system mass and total conserved matter are complete." },
      ], failureMode: "Do not mistake a strong first step for a complete multistep answer.",
    },
    {
      family: "grading-missing-lab-evidence", split: "holdout" as const,
      question: "The lab worksheet asks whether warming increased enzyme activity. Its Results field says 'sensor disconnected; no measurements saved'. Explain what conclusion the recorded experiment supports.",
      referenceAnswer: "No direction of effect can be concluded from this run because there are no saved measurements; the experiment needs valid measurements before comparing activity.",
      rubric: "Requires recognizing that this recorded run cannot establish an increase or decrease because measurements are missing. Background expectations about enzymes cannot substitute for observations. A response that discusses enzymes but invents a measured outcome has wrong substance.",
      answers: [
        { text: "This run cannot tell us whether activity rose or fell because the disconnected sensor left no measurements to compare.", score: 4, explanation: "The learner correctly identifies what is unknown and the explicit reason; uncertainty is the complete answer here." },
        { text: "Warming increased enzyme activity in this experiment because the sensor recorded a faster reaction at the higher temperature.", score: 1, explanation: "The learner discusses the relevant topic but invents an observation explicitly absent from the supplied worksheet." },
      ], failureMode: "Reward justified uncertainty instead of a confident invented experimental result.",
    },
  ];
  return families.flatMap((family, familyIndex) => family.answers.map((answer, variant) => {
    // Non-evidential learner remarks vary the evidence position without adding a second defensible span.
    const aside = "I am submitting my answer now.";
    const learnerAnswer = (familyIndex + variant) % 2 === 0 ? `${aside} ${answer.text}` : `${answer.text} ${aside}`;
    const id = `${family.family}-${variant + 1}`;
    return { id, family: family.family, split: family.split, title: `${family.question.split(".")[0]} — attempt ${variant + 1}`,
      input: { id, question: family.question, referenceAnswer: family.referenceAnswer, rubric: family.rubric, learnerAnswer },
      score: answer.score, evidence: answer.text, explanation: answer.explanation, failureMode: family.failureMode };
  }));
}

export function gradingScenarios(): Array<KeatingScenario & { request: JudgementRequest }> {
  return gradingFixtures().map((fixture) => ({
    id: fixture.id, family: fixture.family, split: fixture.split, stage: "grading", title: fixture.title,
    turn: { ...emptyTurn(), learnerMessage: fixture.input.learnerAnswer },
    request: { state: openResponseState(fixture.input), questions: {
      score: openResponseQuestion(fixture.input.rubric!),
      evidence: openResponseEvidenceQuestion(splitResponseSentences(fixture.input.learnerAnswer)),
    } },
    expected: { score: fixture.score, evidence: fixture.evidence },
    rationale: { score: fixture.explanation, evidence: "This learner sentence contains the substantive answer; the other sentence only announces submission." },
    failureMode: fixture.failureMode,
  }));
}
