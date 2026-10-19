/**
 * Behavioural tests for the CourseAssembler sections: what each panel shows and
 * which controls are checked / enabled for a given selection. Assertions read
 * visible text, accessible names, and form state, never classes or DOM shape.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactsSection } from "../components/courses/assembler/ArtifactsSection";
import { CreateFooter } from "../components/courses/assembler/CreateFooter";
import { DecksSection } from "../components/courses/assembler/DecksSection";
import { DetailsFields } from "../components/courses/assembler/DetailsFields";
import { PlansSection } from "../components/courses/assembler/PlansSection";
import { SelectionSummary } from "../components/courses/assembler/SelectionSummary";
import { SourceStatus } from "../components/courses/assembler/SourceStatus";
import type { FlashcardDeck } from "../keating/flashcard-types";

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const textOf = (html: string) =>
  decode(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const noop = () => {};
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
/** True when an attribute string carries the boolean `disabled` attribute (not a class like `disabled:op_0.6`). */
const isDisabled = (attrs: string) => /(^|\s)disabled(=""|\s|$)/.test(attrs);

interface Box { label: string; checked: boolean }
/** Checkboxes with their accessible name: aria-label, else wrapping label text. */
function checkboxes(html: string): Box[] {
  const boxes: Box[] = [];
  for (const m of html.matchAll(/<input type="checkbox"([^>]*)\/>/g)) {
    const attrs = m[1]!;
    const aria = /aria-label="([^"]*)"/.exec(attrs)?.[1];
    let label = aria ? decode(aria) : "";
    if (!label) {
      const after = html.slice(m.index! + m[0].length);
      label = textOf(after.slice(0, after.indexOf("</")) );
    }
    boxes.push({ label, checked: /\schecked(=|\s|$)/.test(attrs) });
  }
  return boxes;
}
const deck = (id: string, title: string, cards: number): FlashcardDeck =>
  ({ id, topic: id, slug: id, title, cards: Array.from({ length: cards }, (_, i) => ({ id: `${id}${i}` })), createdAt: 1, updatedAt: 1 }) as never;

describe("PlansSection", () => {
  const plans = [
    { id: "p1", title: "Causal plan", sessionTitle: "Chat A", items: [{ id: "i1", title: "Do-calculus" }, { id: "i2", title: "Confounders" }] },
    { id: "p2", title: "Bayes plan", sessionTitle: "Chat B", items: [{ id: "i3", title: "Priors" }] },
  ] as never;
  test("lists plans with count and source session; module choices appear only for ticked plans", () => {
    const html = render(
      <PlansSection plans={plans} selected={new Set(["p1"])} selectedModules={{ p1: new Set(["i2"]) }} onChoosePlan={noop} onChooseModule={noop} />,
    );
    const text = textOf(html);
    expect(text).toContain("Plans from your chats");
    expect(text).toContain("From “Chat A”");
    expect(text).toContain("From “Chat B”");
    expect(checkboxes(html)).toEqual([
      { label: "Include Causal plan", checked: true },
      { label: "Do-calculus", checked: false },
      { label: "Confounders", checked: true },
      { label: "Include Bayes plan", checked: false },
    ]);
    expect(text).not.toContain("Priors");
  });
  test("an empty list explains how to get plans", () => {
    const text = textOf(render(<PlansSection plans={[]} selected={new Set()} selectedModules={{}} onChoosePlan={noop} onChooseModule={noop} />));
    expect(text).toContain("No saved StudyPlans yet.");
  });
});

describe("DecksSection", () => {
  const base = {
    deckChoices: [deck("d1", "Statistics", 1), deck("d2", "Imported", 3)],
    ankiDecks: [] as FlashcardDeck[],
    ankiFileName: "",
    ankiNotice: "",
    ankiReading: false,
    keepAnkiDecks: true,
    selectedDecks: new Set<string>(["d1"]),
    ankiInputRef: { current: null },
    onReadAnki: noop,
    onKeepAnkiDecksChange: noop,
    onToggleDeck: noop,
  };
  test("lists decks with pluralised card counts and the ticked state", () => {
    const html = render(<DecksSection {...base} />);
    const text = textOf(html);
    expect(text).toContain("Statistics 1 card");
    expect(text).toContain("Imported 3 cards");
    expect(checkboxes(html).map((b) => b.checked)).toEqual([true, false]);
    expect(text).toContain("Import Anki file");
    expect([...html.matchAll(/<button\b([^>]*)>/g)].some((m) => isDisabled(m[1]!))).toBe(false);
  });
  test("after an import it names the file, offers keep-decks, and shows the notice", () => {
    const html = render(
      <DecksSection {...base} ankiDecks={[base.deckChoices[1]!]} ankiFileName="x.apkg" ankiNotice="3 cards ready from x.apkg." />,
    );
    const text = textOf(html);
    expect(text).toContain("Read 1 deck from x.apkg");
    expect(text).toContain("Imported 3 cards · from x.apkg");
    expect(text).toContain("3 cards ready from x.apkg.");
    expect(html).toContain('role="status"');
    expect(checkboxes(html).find((b) => b.label.startsWith("Keep them"))?.checked).toBe(true);
  });
  test("the import button is disabled and relabelled while reading", () => {
    const html = render(<DecksSection {...base} ankiReading />);
    expect(textOf(html)).toContain("Reading…");
    const importButton = /<button\b([^>]*)>(?:(?!<\/button>)[\s\S])*Reading…/.exec(html);
    expect(isDisabled(importButton![1]!)).toBe(true);
  });
  test("with no decks it says so", () => {
    expect(textOf(render(<DecksSection {...base} deckChoices={[]} />))).toContain("No saved decks yet.");
  });
});

describe("ArtifactsSection", () => {
  test("lists artifacts with kind and source and the ticked state", () => {
    const html = render(
      <ArtifactsSection
        artifacts={[{ id: "a1", title: "Quiz one", kind: "quiz-set", sourceLabel: "Chat A" }, { id: "a2", title: "Map", kind: "concept-map", sourceLabel: "Chat B" }] as never}
        selected={new Set(["a2"])}
        onToggle={noop}
      />,
    );
    const text = textOf(html);
    expect(text).toContain("Artifact tray");
    expect(text).toContain("Quiz one quiz set · Chat A");
    expect(checkboxes(html).map((b) => b.checked)).toEqual([false, true]);
  });
  test("an empty tray explains what will appear", () => {
    expect(textOf(render(<ArtifactsSection artifacts={[]} selected={new Set()} onToggle={noop} />))).toContain(
      "Saved quizzes and generated learning artifacts will appear here.",
    );
  });
});

describe("SelectionSummary", () => {
  test("blank start versus assembled counts with singular and plural nouns", () => {
    expect(textOf(render(<SelectionSummary hasSources={false} moduleCount={0} artifactCount={0} cardCount={0} />))).toContain("Blank start No template content.");
    const one = textOf(render(<SelectionSummary hasSources moduleCount={1} artifactCount={1} cardCount={1} />));
    expect(one).toContain("Assembled start");
    expect(one).toContain("1 plan section, 1 artifact, and 1 card selected.");
    expect(textOf(render(<SelectionSummary hasSources moduleCount={2} artifactCount={0} cardCount={5} />))).toContain("2 plan sections, 0 artifacts, and 5 cards selected.");
  });
});

describe("CreateFooter", () => {
  const props = { creating: false, titleValid: true, hasSources: false, error: "", onCreate: noop };
  const create = (html: string) => /<button\b([^>]*)>([\s\S]*?)<\/button>/.exec(html)!;
  test("label follows the selection; enabled with a valid title", () => {
    const blank = create(render(<CreateFooter {...props} />));
    expect(textOf(blank[2]!)).toBe("Create blank course");
    expect(isDisabled(blank[1]!)).toBe(false);
    expect(textOf(create(render(<CreateFooter {...props} hasSources />))[2]!)).toBe("Create assembled course");
  });
  test("disabled while creating or without a title", () => {
    const creating = create(render(<CreateFooter {...props} creating />));
    expect(textOf(creating[2]!)).toBe("Creating…");
    expect(isDisabled(creating[1]!)).toBe(true);
    expect(isDisabled(create(render(<CreateFooter {...props} titleValid={false} />))[1]!)).toBe(true);
  });
  test("an error renders as an alert", () => {
    const html = render(<CreateFooter {...props} error="Storage unavailable" />);
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain("Storage unavailable");
    expect(render(<CreateFooter {...props} />)).not.toContain('role="alert"');
  });
});

describe("DetailsFields and SourceStatus", () => {
  test("fields show the current values", () => {
    const html = render(<DetailsFields title="My course" description="About it" reviewAfterSave onTitleChange={noop} onDescriptionChange={noop} onReviewAfterSaveChange={noop} />);
    expect(html).toContain('value="My course"');
    expect(html).toMatch(/<textarea[^>]*>About it<\/textarea>/);
    expect(checkboxes(html)[0]).toMatchObject({ checked: true });
  });
  test("status shows loading, or a failure that still allows a blank course", () => {
    expect(textOf(render(<SourceStatus loading error="" />))).toBe("Looking through your saved work…");
    const failed = render(<SourceStatus loading={false} error="offline" />);
    expect(failed).toContain('role="alert"');
    expect(textOf(failed)).toContain("Your saved sources could not be loaded: offline. You can still create a blank course.");
    expect(textOf(render(<SourceStatus loading={false} error="" />))).toBe("");
  });
});
