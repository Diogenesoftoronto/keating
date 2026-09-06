import {
  compileOpenUISourceToSharedDocument,
  EXAM_SOURCE_QUESTIONS_FIXTURE,
} from "@keating/learner-contracts";
import type { ExamNode } from "./attempt";

export const EXAM_FIXTURE_SOURCE = `root = LearningSurface([exam], "", "", "resumable")
exam = Exam("exam-caches", "Caches & tradeoffs", ${JSON.stringify(EXAM_SOURCE_QUESTIONS_FIXTURE)}, "resumable", 1800)`;

export const EXAM_FIXTURE_DOCUMENT = compileOpenUISourceToSharedDocument(
  EXAM_FIXTURE_SOURCE,
  { documentId: "exam-fixture", createdAt: "2026-09-06T00:00:00.000Z" },
);
export const EXAM_FIXTURE_NODE = EXAM_FIXTURE_DOCUMENT.nodes[0] as ExamNode;
