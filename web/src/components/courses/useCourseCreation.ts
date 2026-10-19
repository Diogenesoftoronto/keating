/**
 * Course creation for the assembler. `createCourseFromSelection` is the
 * ordered, dependency-injected sequence (assemble payload, optionally save the
 * imported Anki decks, create the course, optionally queue the review) so the
 * ordering guarantees can be tested; `useCourseCreation` wraps it with the
 * busy/error state and analytics events.
 */
import { usePostHog } from "@posthog/react";
import { useState } from "react";
import { createCourse } from "../../courses/client";
import { queueCourseReview } from "../../courses/course-judgement";
import { withDeckNameTags } from "../../courses/course-anki";
import {
  assembleCourseInput,
  type CourseAssemblyInput,
} from "../../courses/course-assembly";
import type { CourseViewerSnapshot } from "../../courses/contracts";
import { getInitPromise, keatingStorage } from "../../hooks/keating-storage";
import { mergeAnkiDeck } from "../../keating/anki-package";
import type { FlashcardDeck } from "../../keating/flashcard-types";
import type { CoursesAccount } from "../../courses/useCoursesAccess";

export interface CourseCreationDeps {
  init(): Promise<unknown>;
  getDeck(id: string): Promise<FlashcardDeck | null | undefined>;
  saveDeck(deck: FlashcardDeck): Promise<unknown>;
  createCourse(
    input: ReturnType<typeof assembleCourseInput> & { displayName?: string },
  ): Promise<CourseViewerSnapshot>;
  queueReview(snapshot: CourseViewerSnapshot): void;
}

const liveDeps: CourseCreationDeps = {
  init: getInitPromise,
  getDeck: (id) => keatingStorage.getDeck(id),
  saveDeck: (deck) => keatingStorage.saveDeck(deck),
  createCourse,
  queueReview: queueCourseReview,
};

export interface CourseCreationRequest {
  assembly: CourseAssemblyInput;
  displayName: string;
  ankiDecks: readonly FlashcardDeck[];
  selectedDeckIds: ReadonlySet<string>;
  keepAnkiDecks: boolean;
  reviewAfterSave: boolean;
}

/** Resolves to the new course id. Throws without creating a course if any earlier step fails. */
export async function createCourseFromSelection(
  request: CourseCreationRequest,
  deps: CourseCreationDeps = liveDeps,
): Promise<string> {
  const input = assembleCourseInput(request.assembly);
  // Save the optional review copy before creating the course. If storage is
  // unavailable, the learner can uncheck this option and retry without
  // accidentally creating a second course.
  if (request.keepAnkiDecks && request.ankiDecks.length) {
    await deps.init();
    for (const deck of withDeckNameTags([...request.ankiDecks])) {
      if (!request.selectedDeckIds.has(deck.id)) continue;
      const existing = await deps.getDeck(deck.id);
      await deps.saveDeck(mergeAnkiDeck(existing ?? null, deck).deck);
    }
  }
  const snapshot = await deps.createCourse({
    ...input,
    displayName: request.displayName,
  });
  if (request.reviewAfterSave) deps.queueReview(snapshot);
  return snapshot.course.id;
}

export function useCourseCreation({
  account,
  counts,
  hasAnkiImport,
  clearNotice,
  onCreated,
  request,
}: {
  account: CoursesAccount;
  counts: { moduleCount: number; cardCount: number; artifactCount: number };
  hasAnkiImport: boolean;
  clearNotice(): void;
  onCreated(courseId: string): void;
  /** Built at click time from the form's current values. */
  request(): CourseCreationRequest;
}) {
  const posthog = usePostHog();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    const analyticsProperties = {
      workspace_mode: account.mode,
      module_count: counts.moduleCount,
      card_count: counts.cardCount,
      artifact_count: counts.artifactCount,
      has_anki_import: hasAnkiImport,
    };
    posthog?.capture("course_creation_started", analyticsProperties);
    setCreating(true);
    setError("");
    clearNotice();
    try {
      const courseId = await createCourseFromSelection(request());
      posthog?.capture("course_creation_completed", analyticsProperties);
      onCreated(courseId);
    } catch (cause) {
      posthog?.capture("course_creation_failed", {
        ...analyticsProperties,
        failure_type: cause instanceof Error ? cause.name : "unknown",
      });
      setError(
        cause instanceof Error
          ? cause.message
          : "The course could not be created.",
      );
    } finally {
      setCreating(false);
    }
  };

  return { creating, error, setError, create };
}
