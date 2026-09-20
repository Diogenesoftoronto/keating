import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withLearnerProfile } from "../src/core/learner-profile-selection.js";
import { generateQuiz } from "../src/core/quiz.js";
import { cliQuizRecordPath, finalizeCliQuizReview, loadCliQuizRecord, saveCliQuizSubmission } from "../src/core/quiz-grading.js";

test("quiz answers and final reviews stay inside the selected learner profile", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-quiz-profile-"));
  const id = "quiz-profile-isolation";
  const quiz = generateQuiz("fractions", 42);
  try {
    await withLearnerProfile(cwd, "ada", async () => {
      const path = await saveCliQuizSubmission(cwd, { id, quiz, answers: { [quiz.questions[0]!.id]: "Ada's own answer" },
        objectiveResults: {}, pendingMathIds: [] });
      expect(path).toBe(join(cwd, ".keating", "profiles", "ada", "state", "quiz-submissions", `${id}.json`));
    });
    for (const profile of ["bob", undefined]) {
      await withLearnerProfile(cwd, profile, async () => {
        expect(await loadCliQuizRecord(cwd, id)).toBeNull();
        await expect(finalizeCliQuizReview(cwd, id, {})).rejects.toThrow("quiz_record_missing");
      });
    }
    await withLearnerProfile(cwd, "bob", async () => {
      await saveCliQuizSubmission(cwd, { id, quiz, answers: { [quiz.questions[0]!.id]: "Bob's own answer" },
        objectiveResults: {}, pendingMathIds: [] });
      expect((await loadCliQuizRecord(cwd, id))?.submission.answers[quiz.questions[0]!.id]).toBe("Bob's own answer");
    });
    await withLearnerProfile(cwd, "ada", async () => {
      expect((await loadCliQuizRecord(cwd, id))?.submission.answers[quiz.questions[0]!.id]).toBe("Ada's own answer");
    });
    await withLearnerProfile(cwd, undefined, async () => {
      expect(cliQuizRecordPath(cwd, id)).toBe(join(cwd, ".keating", "state", "quiz-submissions", `${id}.json`));
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
