'use agent';

import {
  useInstruction,
  useModel,
  usePersistentState,
  useSubagent,
} from "@flue/runtime";

function LessonCritic() {
  return "Critique the lesson for diagnosis, retrieval, transfer, and structure.";
}

/**
 * This is a valid Flue agent definition, but it is server/runtime code. The
 * browser may edit/version this source as an account-scoped artifact; it must
 * not execute the harness directly in the UI bundle.
 */
export function KeatingTeacher() {
  useModel("openai/gpt-5-mini");
  const [promptRevision] = usePersistentState("promptRevision", 0);

  useSubagent({
    name: "lesson-critic",
    description: "Evaluates candidate teaching prompts before promotion.",
    agent: LessonCritic,
    model: "openai/gpt-5-mini",
  });

  useInstruction(
    `The active account-scoped prompt revision is ${promptRevision}.`,
  );

  return "Teach by diagnosis, explanation, retrieval, and verified transfer.";
}

KeatingTeacher.agentName = "keating-teacher";
