import { describe, expect, test } from "bun:test";
import { classifyOpenUiCue, type OpenUiDiagnosticCue } from "../src/openui-diagnostic-turn.js";

// Offline wording probe for the passive cue label. The phrases are authored here, involve no learner data,
// and call no model. The label feeds diagnostics only; it does not decide what a tutor shows.
const PREDICT = ["question", "quiz"];
const VARY = ["simulation"];
const NONE: OpenUiDiagnosticCue = { kind: "none", targets: [] };

/** 26 ordinary rewordings of "let me predict" and "I want to change this and see what happens". */
const REWORDINGS: ReadonlyArray<[string, string[] | null]> = [
  ["let me predict", PREDICT],
  ["I want to change this and see what happens", VARY],
  ["I want to change this, and see what happens", VARY],
  ["let me guess first", PREDICT],
  ["Let me guess before you tell me", PREDICT],
  ["I want to predict what happens", PREDICT],
  ["Can I predict first?", PREDICT],
  ["I'd like to make a prediction", PREDICT],
  ["Before you explain, I want to guess the answer", PREDICT],
  ["let me have a go", PREDICT],
  ["can I try one?", PREDICT],
  ["I want to try one myself", PREDICT],
  ["what if I make the width bigger?", VARY],
  // No first-person action: a question about the subject that prose can answer.
  ["what happens when the rate doubles?", null],
  ["let me play with the numbers", VARY],
  ["Can I tweak the interest rate and see how the balance changes?", VARY],
  ["I want to mess around with the slope", VARY],
  ["show me what happens when I drag the slope", VARY],
  ["Let me experiment with the values", VARY],
  ["I want to see how the graph changes when the rate goes up", null],
  ["Don't tell me the answer, let me work it out", PREDICT],
  ["let me predict without hints", PREDICT],
  ["can I change the numbers myself?", VARY],
  ["I want to try changing the angle", VARY],
  ["let me test myself", PREDICT],
  ["Let me order the steps myself", PREDICT],
];

describe("OpenUI cue rewordings", () => {
  test("recognizes first-person prediction and manipulation wording", () => {
    expect(REWORDINGS).toHaveLength(26);
    for (const [text, targets] of REWORDINGS) {
      expect([text, classifyOpenUiCue(text)]).toEqual([text, targets ? { kind: "implicit-action", targets } : NONE]);
    }
    expect(REWORDINGS.filter(([, targets]) => targets).length).toBe(24);
    expect(classifyOpenUiCue("I’d like to make a prediction").targets).toEqual(PREDICT);
    expect(classifyOpenUiCue("I want to change the rate, then watch what happens. Skip the quiz.").targets).toEqual(VARY);
    expect(classifyOpenUiCue("No, let me predict").targets).toEqual(PREDICT);
  });

  test("leaves account chores, ordinary talk and subject questions unlabelled", () => {
    for (const text of [
      "I want to change my password, and see my account.",
      "I want to change my password and see my account.",
      "I want to change the font in Settings.",
      "What happens if I change my email?",
      "What if I change my mind?",
      "Let me try signing in to the app again.",
      "Can I change the numbers on my subscription?",
      "I guess that makes sense.",
      "Can I try a different topic?",
      "Can I try this on my phone?",
      "I don't want to guess.",
      "Don't let me guess.",
      "Can you predict the weather?",
      "Can I predict earthquakes with this model?",
      "I want to predict stock prices someday.",
      "What if I make a mistake?",
      "What if the rate doubles?",
      "No questions for now.",
      "Why does the area grow when the width grows?",
    ]) expect([text, classifyOpenUiCue(text)]).toEqual([text, NONE]);
  });

  test("leaves a stated guess, the learner's own affairs and off-task play unlabelled", () => {
    for (const text of [
      // The guess follows in the same breath, so no turn is being requested.
      "Let me guess, you want me to memorize it",
      "Let me guess: it's on the exam",
      "Let me guess \u2014 the answer is always 42",
      "Let me guess, I have to show my work",
      // A bare what-if about something of the learner's own.
      "What if I lower my expectations?",
      "What happens if I raise my hand?",
      "What if I change my answer?",
      "What if I increase my study time?",
      // A wish to play that names no lesson object.
      "I want to play with the dog",
      "I'd like to play with my friends after this",
      "I want to play with a new game",
    ]) expect([text, classifyOpenUiCue(text)]).toEqual([text, NONE]);
  });

  test("keeps requests for a turn that sit next to those exclusions", () => {
    for (const text of [
      "let me guess first",
      "Let me guess, then tell me if I'm right",
      "Let me guess, don't tell me",
      "Before you explain, let me guess.",
      "Okay, let me guess",
    ]) expect([text, classifyOpenUiCue(text).targets]).toEqual([text, PREDICT]);
    for (const text of [
      "What if I lower the rate?",
      "What happens if I double the mass?",
      "I want to play with the numbers",
      "I'd like to play with the slope a bit",
      "I want to play with it and see what happens",
      "Can I play with the pendulum?",
      "I want to adjust my deposit and see what happens to the balance",
    ]) expect([text, classifyOpenUiCue(text).targets]).toEqual([text, VARY]);
  });

  // Pinned so a later change to any of these shows up as a deliberate decision.
  test("records the known limits of the wording rules", () => {
    // Still labelled although no control is being asked for.
    expect(classifyOpenUiCue("Let me guess. You want me to memorize it.").targets).toEqual(PREDICT);
    expect(classifyOpenUiCue("Let me try a different topic").targets).toEqual(PREDICT);
    expect(classifyOpenUiCue("Can I play with the dog?").targets).toEqual(VARY);
    // Missed although a learner could mean a lesson quantity.
    expect(classifyOpenUiCue("What if I double my deposit?")).toEqual(NONE);
    expect(classifyOpenUiCue("I want to play with the pendulum")).toEqual(NONE);
  });

  test("keeps direct-text and explicit requests ahead of the wider wording", () => {
    for (const text of [
      "Text only. What if I make the width bigger?",
      "Don't ask me to predict. Just give me the answer.",
      "Let me guess first, then answer in one sentence.",
      "Just tell me. I don't want to play with the numbers.",
      "No interfaces. Let me have a go.",
    ]) expect([text, classifyOpenUiCue(text).kind]).toEqual([text, "direct-text"]);
    expect(classifyOpenUiCue("Give me a quiz. Let me guess first.")).toEqual({ kind: "explicit-interface", targets: ["quiz"] });
    expect(classifyOpenUiCue("Show me a simulation so I can play with the numbers.")).toEqual({ kind: "explicit-interface", targets: ["simulation"] });
    expect(classifyOpenUiCue("I still want a slider.")).toEqual({ kind: "explicit-interface", targets: ["simulation"], repeat: true });
  });

  test("leaves the other implicit families as they were", () => {
    expect(classifyOpenUiCue("I'd like to map out the relationships between these ideas.").targets).toEqual(["concept-map", "diagram"]);
    expect(classifyOpenUiCue("Give me a broken function to fix and run.").targets).toEqual(["coding-challenge"]);
    expect(classifyOpenUiCue("Let me see what I remember.").targets).toEqual(["question", "quiz", "deck", "language-practice"]);
    // A declined hint only rescues prediction and manipulation wording.
    expect(classifyOpenUiCue("Let me recall the terms without the quiz.")).toEqual(NONE);
    expect(classifyOpenUiCue("I want to map out the concepts without help from a diagram.")).toEqual(NONE);
  });
});
