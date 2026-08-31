import { defineSkill } from "@flue/runtime";

export const learnerEvaluationSkill = defineSkill({
  name: "learner-evaluation",
  description: "Evaluate a teaching candidate against recorded learner outcomes and all six objectives.",
  instructions: `
Compare candidates only against attributable learner evidence. Report voice, diagnosis,
verification, retrieval, transfer, and structure separately. Preserve the learner run id,
surface, candidate id, and prompt/code/parameter hashes. Never promote a candidate from an
aggregate score alone; call out regressions and missing evidence.
`.trim(),
});

export const promptEvolutionSkill = defineSkill({
  name: "prompt-evolution",
  description: "Propose inspectable prompt, evolution-code, and MAP-Elites parameter variants.",
  instructions: `
Produce a candidate rather than overwriting active state. A candidate contains complete prompt
sources, the self-evolution code it depends on, all MAP-Elites parameters and weights, parent
revision, rationale, and content hashes. Keep mutations small enough to attribute performance.
Activation is a separate compare-and-swap operation after learner evidence is recorded.
`.trim(),
});
