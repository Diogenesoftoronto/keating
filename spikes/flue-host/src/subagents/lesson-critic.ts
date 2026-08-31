import { defineSubagent } from "@flue/runtime";

function LessonCritic() {
  return [
    "Review one proposed lesson independently.",
    "Return one strength, one likely learner misconception, and one concrete revision.",
  ].join(" ");
}

export const lessonCritic = defineSubagent({
  name: "lesson-critic",
  description:
    "Critiques a candidate lesson for diagnosis, retrieval, transfer, and structure.",
  agent: LessonCritic,
});
