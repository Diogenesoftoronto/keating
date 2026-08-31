import { defineSkill } from "@flue/runtime";

export const retrievalPractice = defineSkill({
  name: "retrieval-practice",
  description:
    "Design a short retrieval check after teaching a concept. Use it before claiming the learner understands.",
  instructions: [
    "Ask the learner to produce an answer without copying the explanation.",
    "Include one plausible misconception as a distractor.",
    "Explain why the correct answer is correct after the learner commits.",
  ].join("\n"),
});
