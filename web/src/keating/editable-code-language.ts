import { runnableFenceLanguage, type CodePracticeLanguage } from "../../../packages/learner-contracts/src/judgement/code-practice-language";

/** The Markdown editor has no JSX transform. Keep its eligibility independent of executor availability. */
export function editableCodeLanguage(label: string): CodePracticeLanguage | null {
  const language = label.trim().toLowerCase();
  return language === "jsx" || language === "tsx" ? null : runnableFenceLanguage(language);
}

/** Older planning receipts omit the language even when the tutor happened to choose one. */
export function recordedCodePracticeLanguage(receipt: object): CodePracticeLanguage | null {
  if (!("codePracticeLanguage" in receipt) || typeof receipt.codePracticeLanguage !== "string") return null;
  const canonical = editableCodeLanguage(receipt.codePracticeLanguage);
  return canonical === receipt.codePracticeLanguage ? canonical : null;
}
