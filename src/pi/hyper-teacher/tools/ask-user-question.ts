import { AnswerFormComponent, type AnswerFormQuestion } from "../tui-components.js";
import { keatingToolMaker } from "./shared.js";

export const askUserQuestionTools = [
  keatingToolMaker(
    "ask_user_question",
    "ask_user_question",
    "Ask the learner a direct question with optional multiple-choice, text, fill-in-the-blank, classification-table, or matching-worksheet answers. Use to check understanding, prompt reflection, or gather the learner's thinking before explaining a concept. The agent waits for the user's answer in the next message.",
    {
      question: { type: "string", description: "The question to ask the learner" },
      choices: { type: "array", items: { type: "string" }, description: "Optional list of answer choices. For classification questions, these are categories/slots; for matching questions, answer-bank entries." },
      items: { type: "array", items: { type: "string" }, description: "Rows to classify or prompts to match when type is 'classification' or 'matching'." },
      type: { type: "string", enum: ["choice", "text", "blanks", "classification", "matching"], description: "Question type. Use 'classification' to assign each item to a category; use 'matching' for worksheet-style prompt-to-answer matching." },
      allow_text: { type: "boolean", description: "Whether to also allow free-text input (default: true if no choices, false if choices provided)" },
      require_reasons: { type: "boolean", description: "For classification questions, require a short justification per row (default true)." },
      unique_matches: { type: "boolean", description: "For matching questions, prevent reusing an answer-bank choice (default true)." },
      correct_matches: { type: "array", items: { type: "string" }, description: "Optional answer key for matching questions, one correct choice per item in order. Enables red/green feedback after submission." },
      item_label: { type: "string", description: "Column label for classification items." },
      choice_label: { type: "string", description: "Column label for classification choices or matching answer bank." },
      reason_label: { type: "string", description: "Column label for classification justifications." },
      hint: { type: "string", description: "Optional hint to display below the question" },
    },
    async (params, ctx) => {
      const question = (params.question as string) || "";
      if (!question) return { content: [{ type: "text", text: "Question text is required." }] };
      const choices = Array.isArray(params.choices) ? params.choices.filter((c: unknown) => typeof c === "string") as string[] : undefined;
      const items = Array.isArray(params.items) ? params.items.filter((item: unknown) => typeof item === "string") as string[] : undefined;
      const type = typeof params.type === "string" ? params.type : undefined;
      if ((type === "classification" || type === "matching") && (!items || items.length === 0 || !choices || choices.length === 0)) {
        return { content: [{ type: "text", text: "Classification and matching questions require both items and choices." }] };
      }
      const allowText = type === "classification" || type === "matching" ? false : typeof params.allow_text === "boolean" ? params.allow_text : !choices || choices.length === 0;
      const hint = (params.hint as string) || undefined;
      const resolvedKind = (type ?? (choices && choices.length > 0 ? "choice" : "text")) as AnswerFormQuestion["kind"];

      if (typeof ctx?.ui?.custom === "function" && ctx.hasUI) {
        const formQuestion: AnswerFormQuestion = {
          id: "q1",
          prompt: hint ? `${question}\n(hint: ${hint})` : question,
          kind: resolvedKind,
          choices,
          items,
          allowText,
          requireReasons: typeof params.require_reasons === "boolean" ? params.require_reasons : true,
        };
        const rawAnswers: Record<string, string> = await ctx.ui.custom((_tui: any, theme: any, _keybindings: any, done: (result: Record<string, string>) => void) => {
          return new AnswerFormComponent(theme, [formQuestion], done);
        });
        const summary =
          resolvedKind === "classification" || resolvedKind === "matching"
            ? (items ?? [])
                .map((item, idx) => {
                  const choice = rawAnswers[`q1::${idx}`] ?? "(no answer)";
                  const reason = rawAnswers[`q1::${idx}::reason`];
                  return `${item} → ${choice}${reason ? ` (${reason})` : ""}`;
                })
                .join("; ")
            : (rawAnswers.q1 ?? "(no answer)");
        return {
          content: [{ type: "text", text: `Learner answered: ${summary}` }],
          details: { question, choices, items, type: resolvedKind, answers: rawAnswers }
        };
      }

      // Non-interactive fallback (rpc/print/json modes, or hosts without ctx.ui.custom): print
      // a machine-readable tag and let the conversation continue with the learner's next message.
      const correctMatches = Array.isArray(params.correct_matches) ? params.correct_matches.filter((item: unknown) => typeof item === "string") as string[] : undefined;
      const payload = JSON.stringify({
        question,
        type,
        choices,
        items,
        allow_text: allowText,
        require_reasons: typeof params.require_reasons === "boolean" ? params.require_reasons : undefined,
        unique_matches: typeof params.unique_matches === "boolean" ? params.unique_matches : undefined,
        correct_matches: correctMatches && correctMatches.length > 0 ? correctMatches : undefined,
        item_label: typeof params.item_label === "string" ? params.item_label : undefined,
        choice_label: typeof params.choice_label === "string" ? params.choice_label : undefined,
        reason_label: typeof params.reason_label === "string" ? params.reason_label : undefined,
        hint
      });
      return {
        content: [{ type: "text", text: `[question] Asking learner: ${question}${choices ? ` (choices: ${choices.join(", ")})` : ""}\n<keating-question json=${JSON.stringify(payload)} />` }],
        details: { question, choices, allow_text: allowText, hint }
      };
    }
  ),
];
