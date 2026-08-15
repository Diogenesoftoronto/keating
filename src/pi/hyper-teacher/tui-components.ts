import { readFileSync } from "node:fs";
import {
  Input,
  SelectList,
  type Component,
  type SelectItem,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { goalCardBodyLines } from "../../core/cards.js";
import type { Quiz, QuizQuestion } from "../../core/quiz.js";
import type { LearnerGoal } from "../../core/goals.js";

// pi's Theme type isn't re-exported at a stable path we can safely import from an
// extension package; every other Component builder in hyperteacher-extension.ts
// treats it as `any` too (see createKeatingHeaderComponent), so we match that.
type Theme = any;

function pad(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), "…", true);
}

function wrap(text: string, width: number): string[] {
  return wrapTextWithAnsi(text, Math.max(1, width));
}

/** A static (non-interactive) bordered card, matching the visual style of createKeatingHeaderComponent. */
export function renderCard(theme: Theme, heading: string, bodyLines: string[]): Component {
  const t = theme.fg.bind(theme);
  const b = theme.bold.bind(theme);
  const border = (text: string) => t("borderMuted", text);
  const headingText = b(t("mdHeading", heading));

  return {
    render(width: number): string[] {
      const cardWidth = Math.min(Math.max(width - 2, 20), 100);
      const innerWidth = cardWidth - 4;
      const lines: string[] = [];
      lines.push(border(`╭${"─".repeat(cardWidth - 2)}╮`));
      lines.push(`${border("│")} ${pad(headingText, innerWidth)} ${border("│")}`);
      lines.push(`${border("├")}${border("─".repeat(cardWidth - 2))}${border("┤")}`);
      for (const raw of bodyLines) {
        const wrapped = raw.length === 0 ? [""] : wrap(raw, innerWidth);
        for (const line of wrapped) {
          lines.push(`${border("│")} ${pad(line, innerWidth)} ${border("│")}`);
        }
      }
      lines.push(border(`╰${"─".repeat(cardWidth - 2)}╯`));
      return lines;
    },
    invalidate() {},
  };
}

/** Reads a just-written artifact file from disk and renders it as a bordered markdown preview. */
export function renderArtifactPreview(theme: Theme, title: string, filePath: string, maxLines = 40): Component {
  let bodyLines: string[];
  try {
    const raw = readFileSync(filePath, "utf8");
    const allLines = raw.split("\n");
    bodyLines = allLines.slice(0, maxLines);
    if (allLines.length > maxLines) {
      bodyLines.push("", `… ${allLines.length - maxLines} more lines (see ${filePath})`);
    }
  } catch {
    bodyLines = [`(could not read ${filePath})`];
  }
  return renderCard(theme, title, bodyLines);
}

const QUESTION_STATUS_GLYPH: Record<"unanswered" | "answered" | "correct" | "incorrect" | "pending_grade", string> = {
  unanswered: "○",
  answered: "●",
  correct: "✓",
  incorrect: "✗",
  pending_grade: "…",
};

export interface QuizCardState {
  answers?: Map<string, string>;
  objectiveResults?: Map<string, boolean>;
  openEndedGrades?: Map<string, { verdict: "correct" | "incorrect" | "partial"; note?: string }>;
}

function questionStatus(q: QuizQuestion, state: QuizCardState): keyof typeof QUESTION_STATUS_GLYPH {
  const graded = state.openEndedGrades?.get(q.id);
  if (graded) return graded.verdict === "partial" ? "answered" : graded.verdict;
  const objective = state.objectiveResults?.get(q.id);
  if (objective !== undefined) return objective ? "correct" : "incorrect";
  const isOpenEnded = q.type === "short_answer" || q.type === "transfer";
  if (isOpenEnded && state.answers?.has(q.id)) return "pending_grade";
  return state.answers?.has(q.id) ? "answered" : "unanswered";
}

export function renderQuizCard(theme: Theme, quiz: Quiz, state: QuizCardState = {}): Component {
  const lines: string[] = [];
  let correct = 0;
  let graded = 0;
  for (const q of quiz.questions) {
    const status = questionStatus(q, state);
    if (status === "correct") correct++;
    if (status === "correct" || status === "incorrect") graded++;
    lines.push(`${QUESTION_STATUS_GLYPH[status]} [${q.level}] ${q.question}`);
    const answer = state.answers?.get(q.id);
    if (answer) lines.push(`   your answer: ${answer}`);
    const note = state.openEndedGrades?.get(q.id)?.note;
    if (note) lines.push(`   feedback: ${note}`);
  }
  if (graded > 0) {
    lines.unshift("", `Objective score: ${correct}/${graded}`);
  }
  return renderCard(theme, `Quiz: ${quiz.topic}`, lines);
}

function progressBar(percent: number, width = 20): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${percent}%`;
}

export function renderGoalCard(theme: Theme, goal: LearnerGoal): Component {
  return renderCard(theme, `Goal: ${goal.title}`, goalCardBodyLines(goal, progressBar));
}

export function renderGoalListCard(theme: Theme, goals: LearnerGoal[]): Component {
  if (goals.length === 0) return renderCard(theme, "Learner Goals", ["No goals yet."]);
  const lines = goals.map((g) => {
    const total = g.steps.length;
    const done = g.steps.filter((s) => s.status === "done").length;
    return `${g.status === "completed" ? "✓" : "•"} [${g.id}] ${g.title} — ${done}/${total} steps (${g.status})`;
  });
  return renderCard(theme, "Learner Goals", lines);
}

// ─── Interactive answer collection ─────────────────────────────────────────

export type AnswerFormKind = "choice" | "text" | "blanks" | "classification" | "matching";

export interface AnswerFormQuestion {
  id: string;
  prompt: string;
  kind: AnswerFormKind;
  choices?: string[];
  items?: string[];
  allowText?: boolean;
  requireReasons?: boolean;
  uniqueMatches?: boolean;
}

export interface AnswerFormResult {
  [questionId: string]: string;
}

const OTHER_ITEM_VALUE = "__answer_form_other__";

/**
 * A blocking, keyboard-driven form. Renders one or more questions vertically;
 * only the focused row receives keystrokes. Supports choice (SelectList),
 * free text (Input), and per-row choice sequences for classification/matching
 * (one SelectList + optional reason Input per item/row).
 */
interface FormRow {
  questionId: string;
  label: string;
  control: SelectList | Input;
  /** A follow-up Input shown after `control` is confirmed (e.g. a classification reason, or free text for "Other"). */
  followUpControl?: Input;
  /** "always": ask the follow-up regardless of the primary selection. "on-other": only when OTHER_ITEM_VALUE was picked. */
  followUpTrigger?: "always" | "on-other";
}

export class AnswerFormComponent implements Component {
  private theme: Theme;
  private questions: AnswerFormQuestion[];
  private rows: FormRow[] = [];
  private focusIndex = 0;
  /** true once the focused row's primary control is confirmed and its reasonControl (if any) is active. */
  private onReasonStep = false;
  private answers = new Map<string, string>();
  private done: (result: AnswerFormResult) => void;
  invalidate: () => void = () => {};

  constructor(theme: Theme, questions: AnswerFormQuestion[], done: (result: AnswerFormResult) => void) {
    this.theme = theme;
    this.questions = questions;
    this.done = done;
    this.buildRows();
  }

  private buildRows(): void {
    const selectTheme = getSelectListTheme();
    for (const q of this.questions) {
      if (q.kind === "choice" && q.choices && q.choices.length > 0) {
        const items: SelectItem[] = q.choices.map((c) => ({ value: c, label: c }));
        if (q.allowText) items.push({ value: OTHER_ITEM_VALUE, label: "Other (type your own answer)" });
        this.rows.push({
          questionId: q.id,
          label: q.prompt,
          control: new SelectList(items, 8, selectTheme),
          followUpControl: q.allowText ? new Input() : undefined,
          followUpTrigger: "on-other",
        });
      } else if (q.kind === "classification" || q.kind === "matching") {
        const rowItems = q.items ?? [];
        for (const [idx, item] of rowItems.entries()) {
          const choiceItems: SelectItem[] = (q.choices ?? []).map((c) => ({ value: c, label: c }));
          this.rows.push({
            questionId: `${q.id}::${idx}`,
            label: `${item} →`,
            control: new SelectList(choiceItems, 8, selectTheme),
            followUpControl: q.kind === "classification" && q.requireReasons ? new Input() : undefined,
            followUpTrigger: "always",
          });
        }
      } else {
        this.rows.push({ questionId: q.id, label: q.prompt, control: new Input() });
      }
    }
  }

  private currentControl(): SelectList | Input | undefined {
    const row = this.rows[this.focusIndex];
    if (!row) return undefined;
    return this.onReasonStep && row.followUpControl ? row.followUpControl : row.control;
  }

  private advance(): void {
    this.onReasonStep = false;
    if (this.focusIndex < this.rows.length - 1) {
      this.focusIndex += 1;
      this.invalidate();
    } else {
      this.done(Object.fromEntries(this.answers));
    }
  }

  private confirmCurrentControl(): void {
    const row = this.rows[this.focusIndex];
    if (!row) return;
    if (!this.onReasonStep) {
      const value = row.control instanceof SelectList
        ? (row.control.getSelectedItem()?.value ?? "")
        : (row.control as Input).getValue();
      this.answers.set(row.questionId, value);
      const needsFollowUp =
        row.followUpControl &&
        (row.followUpTrigger === "always" || (row.followUpTrigger === "on-other" && value === OTHER_ITEM_VALUE));
      if (needsFollowUp) {
        this.onReasonStep = true;
        this.invalidate();
        return;
      }
      this.advance();
      return;
    }
    if (row.followUpControl) {
      const key = row.followUpTrigger === "on-other" ? row.questionId : `${row.questionId}::reason`;
      this.answers.set(key, row.followUpControl.getValue());
    }
    this.advance();
  }

  handleInput(data: string): void {
    if (data === "\r" || data === "\n") {
      this.confirmCurrentControl();
      return;
    }
    if (data === "\x1b") {
      this.done(Object.fromEntries(this.answers));
      return;
    }
    this.currentControl()?.handleInput(data);
    this.invalidate();
  }

  render(width: number): string[] {
    const t = this.theme.fg.bind(this.theme);
    const b = this.theme.bold.bind(this.theme);
    const lines: string[] = [];
    for (const q of this.questions) {
      lines.push(b(t("mdHeading", q.prompt)));
    }
    lines.push("");
    this.rows.forEach((row, idx) => {
      const isFocused = idx === this.focusIndex;
      const marker = isFocused ? t("accent", "▸ ") : "  ";
      lines.push(`${marker}${row.label}`);
      if (isFocused || this.answers.has(row.questionId)) {
        const controlLines = row.control.render(Math.max(10, width - 4));
        for (const line of controlLines) lines.push(`    ${line}`);
      }
      if (row.followUpControl && isFocused && this.onReasonStep) {
        lines.push(`    ${t("dim", row.followUpTrigger === "always" ? "reason:" : "your answer:")}`);
        for (const line of row.followUpControl.render(Math.max(10, width - 4))) lines.push(`    ${line}`);
      }
    });
    lines.push("", t("dim", "type or use arrow keys + Enter to confirm each row · Esc to submit early"));
    return lines;
  }
}
