import { describe, expect, test } from "bun:test";
import type { FlashcardDeck } from "../keating/flashcard-types";
import type { CourseAssemblySources } from "../courses/course-assembly";
import {
  buildAssemblySelection,
  countSelection,
  toggleSelected,
} from "../components/courses/useCourseAssemblySelection";
import {
  createCourseFromSelection,
  type CourseCreationDeps,
  type CourseCreationRequest,
} from "../components/courses/useCourseCreation";

function deck(id: string, cardIds: string[]): FlashcardDeck {
  return {
    id,
    topic: id,
    slug: id,
    title: id,
    cards: cardIds.map((cardId) => ({
      id: cardId,
      front: `front ${cardId}`,
      back: `back ${cardId}`,
    })),
    createdAt: 1,
    updatedAt: 1,
  } as unknown as FlashcardDeck;
}

const sources = {
  plans: [
    {
      id: "plan_1",
      title: "Plan",
      items: [{ id: "i1" }, { id: "i2" }, { id: "i3" }],
    },
  ],
  decks: [deck("deck_1", ["c1", "c2"])],
  artifacts: [{ id: "art_1" }, { id: "art_2" }],
} as unknown as CourseAssemblySources;

describe("course assembly selection", () => {
  test("toggleSelected never mutates its input", () => {
    const base = new Set(["a"]);
    expect([...toggleSelected(base, "b")].sort()).toEqual(["a", "b"]);
    expect([...toggleSelected(base, "a")]).toEqual([]);
    expect([...base]).toEqual(["a"]);
  });

  test("selection keeps only ticked items and their module choices", () => {
    const selection = buildAssemblySelection(sources, sources.decks, {
      plans: new Set(["plan_1"]),
      modules: { plan_1: new Set(["i1", "i3"]) },
      decks: new Set(["deck_1"]),
      artifacts: new Set(["art_2"]),
    });
    expect(selection.plans.map((p) => p.moduleIds)).toEqual([["i1", "i3"]]);
    expect(selection.decks.map((d) => d.id)).toEqual(["deck_1"]);
    expect(selection.artifacts.map((a) => a.id)).toEqual(["art_2"]);
    expect(countSelection(selection)).toEqual({
      moduleCount: 2,
      cardCount: 2,
      artifactCount: 1,
      hasSources: true,
    });
  });

  test("an empty selection is a valid blank start", () => {
    const selection = buildAssemblySelection(null, [], {
      plans: new Set(),
      modules: {},
      decks: new Set(),
      artifacts: new Set(),
    });
    expect(countSelection(selection).hasSources).toBe(false);
  });
});

describe("course creation sequence", () => {
  function setup(overrides: Partial<CourseCreationDeps> = {}) {
    const calls: string[] = [];
    const deps: CourseCreationDeps = {
      init: async () => void calls.push("init"),
      getDeck: async (id) => (calls.push(`get:${id}`), null),
      saveDeck: async (d) => void calls.push(`save:${d.id}`),
      createCourse: async () => {
        calls.push("create");
        return { course: { id: "course_new" } } as never;
      },
      queueReview: () => void calls.push("review"),
      ...overrides,
    };
    const request = (
      patch: Partial<CourseCreationRequest> = {},
    ): CourseCreationRequest => ({
      assembly: { title: "T", description: "" },
      displayName: "Maya",
      ankiDecks: [deck("anki_a", ["x"]), deck("anki_b", ["y"])],
      selectedDeckIds: new Set(["anki_a"]),
      keepAnkiDecks: true,
      reviewAfterSave: true,
      ...patch,
    });
    return { calls, deps, request };
  }

  test("saves selected Anki decks before creating the course, then queues review", async () => {
    const { calls, deps, request } = setup();
    expect(await createCourseFromSelection(request(), deps)).toBe("course_new");
    expect(calls).toEqual(["init", "get:anki_a", "save:anki_a", "create", "review"]);
  });

  test("a storage failure aborts before any course is created", async () => {
    const { calls, deps, request } = setup({
      saveDeck: async () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(createCourseFromSelection(request(), deps)).rejects.toThrow(
      "storage unavailable",
    );
    expect(calls).not.toContain("create");
  });

  test("unchecking keep-decks skips storage entirely", async () => {
    const { calls, deps, request } = setup();
    await createCourseFromSelection(
      request({ keepAnkiDecks: false, reviewAfterSave: false }),
      deps,
    );
    expect(calls).toEqual(["create"]);
  });
});
