import { createContext } from "react";
import type { QuizQuestionGrade } from "../keating/core";

/**
 * Holds the teacher's (model's) open-ended grades, keyed by quiz-result id, so a
 * `<keating-quiz-grade>` tag emitted after a quiz can update the earlier result
 * card. Lives in its own module so both AssistantChatPanel (which provides it)
 * and QuizResultCard (which consumes it) can import without a cycle.
 */
export interface QuizGradesContextValue {
  grades: Record<string, QuizQuestionGrade[]>;
  applyGrades: (resultId: string, grades: QuizQuestionGrade[]) => void;
}

export const QuizGradesContext = createContext<QuizGradesContextValue>({
  grades: {},
  applyGrades: () => {},
});
