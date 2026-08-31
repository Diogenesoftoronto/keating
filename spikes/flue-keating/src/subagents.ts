import { defineSubagent, useInstruction, useSkill } from "@flue/runtime";
import { learnerEvaluationSkill, promptEvolutionSkill } from "./skills.js";

function LearnerEvaluator(): string {
  useSkill(learnerEvaluationSkill);
  useInstruction("Return evidence-backed comparisons; do not activate or modify a candidate.");
  return "Evaluate one candidate against supplied learner runs and return the six objective scores.";
}

function EvolutionResearcher(): string {
  useSkill(promptEvolutionSkill);
  useInstruction("Propose only. Keep every changed prompt, code file, and parameter inspectable.");
  return "Design one bounded evolution candidate from the evidence and constraints in the task.";
}

export const learnerEvaluator = defineSubagent({
  name: "learner-evaluator",
  description: "Independently scores a teaching candidate from learner evidence.",
  agent: LearnerEvaluator,
});

export const evolutionResearcher = defineSubagent({
  name: "evolution-researcher",
  description: "Proposes bounded prompt, evolution-code, or MAP-Elites parameter mutations.",
  agent: EvolutionResearcher,
});
