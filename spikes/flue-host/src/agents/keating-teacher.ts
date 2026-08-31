'use agent';

import {
  useModel,
  useMcpConnection,
  usePersistentState,
  useSkill,
  useSubagent,
  useTool,
} from "@flue/runtime";
import * as v from "valibot";

import "../provider.ts";
import { getLocalLearningRecordsMcpConfig } from "../mcp/local-learning-records.ts";
import { retrievalPractice } from "../skills/retrieval-practice.ts";
import { lessonCritic } from "../subagents/lesson-critic.ts";

const probeInput = v.object({
  concept: v.pipe(v.string(), v.minLength(1)),
  misconception: v.pipe(v.string(), v.minLength(1)),
});

const probeOutput = v.object({
  prompt: v.string(),
  expectedEvidence: v.string(),
});

export function KeatingTeacher() {
  useModel("keating-faux/teacher");
  const localLearningRecords = getLocalLearningRecordsMcpConfig();
  if (localLearningRecords) {
    useMcpConnection({
      name: "learner_records",
      url: localLearningRecords.url,
      transport: "streamable-http",
      auth: localLearningRecords.resolveAuth,
      tools: ["read_learning_record"],
      timeoutMs: 5_000,
    });
  }
  const [completedProbes, setCompletedProbes] = usePersistentState(
    "completedProbes",
    0,
  );

  useSkill(retrievalPractice);
  useSubagent(lessonCritic);
  useTool({
    name: "build_retrieval_probe",
    description:
      "Build a deterministic retrieval question for one concept and record that the probe was completed.",
    input: probeInput,
    output: probeOutput,
    run({ data }) {
      setCompletedProbes((previous) => previous + 1);
      return {
        output: {
          prompt: `Explain ${data.concept} without using the phrase: ${data.misconception}.`,
          expectedEvidence: `The answer distinguishes ${data.concept} from ${data.misconception}.`,
        },
      };
    },
  });

  return [
    "Teach by diagnosis, explanation, retrieval, and verified transfer.",
    `Completed retrieval probes in this conversation: ${completedProbes}.`,
    "Activate the retrieval-practice skill before claiming mastery.",
    "Delegate independent lesson critique to lesson-critic when evaluating a candidate lesson.",
  ].join("\n");
}

KeatingTeacher.agentName = "keating-teacher";
