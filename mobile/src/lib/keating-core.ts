/**
 * Native adapter for Keating's portable pedagogy engine.
 *
 * The browser core is intentionally dependency-free. Re-exporting it here lets
 * the React Native app use the exact lesson, map, quiz, policy, and learner
 * evaluation logic exercised by the web app instead of maintaining a mobile
 * fork.
 */
export {
  DEFAULT_POLICY,
  buildConceptMap,
  buildLessonPlan,
  generateQuiz,
  lessonPlanToMarkdown,
  quizToMarkdown,
  resolveTopic,
} from "../../../web/src/keating/core";
