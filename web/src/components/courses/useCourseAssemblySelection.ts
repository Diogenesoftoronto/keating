/**
 * Selection state for the course assembler: which saved plans (and which of
 * their modules), decks, and artifacts the learner has ticked, and the derived
 * `selection` payload and counts. The set arithmetic lives in exported pure
 * helpers so it can be tested without rendering.
 */
import { useMemo, useState } from "react";
import {
  mergeAnkiDeckChoices,
  withDeckNameTags,
} from "../../courses/course-anki";
import type {
  CourseAssemblySources,
  SelectedStudyPlan,
} from "../../courses/course-assembly";
import type { FlashcardDeck } from "../../keating/flashcard-types";
import type { CourseArtifactSource } from "../../courses/course-assembly";

export function toggleSelected(
  set: ReadonlySet<string>,
  value: string,
): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export interface CourseAssemblySelection {
  plans: SelectedStudyPlan[];
  decks: FlashcardDeck[];
  artifacts: CourseArtifactSource[];
}

export function buildAssemblySelection(
  sources: CourseAssemblySources | null,
  deckChoices: readonly FlashcardDeck[],
  picked: {
    plans: ReadonlySet<string>;
    modules: Readonly<Record<string, ReadonlySet<string>>>;
    decks: ReadonlySet<string>;
    artifacts: ReadonlySet<string>;
  },
): CourseAssemblySelection {
  return {
    plans: (sources?.plans ?? [])
      .filter((plan) => picked.plans.has(plan.id))
      .map((source) => ({
        source,
        moduleIds: [...(picked.modules[source.id] ?? new Set())],
      })),
    decks: deckChoices.filter((deck) => picked.decks.has(deck.id)),
    artifacts: (sources?.artifacts ?? []).filter((artifact) =>
      picked.artifacts.has(artifact.id),
    ),
  };
}

export function countSelection(selection: CourseAssemblySelection) {
  const moduleCount = selection.plans.reduce(
    (count, plan) =>
      count + (plan.moduleIds?.length ?? plan.source.items.length),
    0,
  );
  const cardCount = selection.decks.reduce(
    (count, deck) => count + deck.cards.length,
    0,
  );
  const artifactCount = selection.artifacts.length;
  return {
    moduleCount,
    cardCount,
    artifactCount,
    hasSources: moduleCount > 0 || cardCount > 0 || artifactCount > 0,
  };
}

export function useCourseAssemblySelection(
  sources: CourseAssemblySources | null,
  ankiDecks: readonly FlashcardDeck[],
) {
  const [selectedPlans, setSelectedPlans] = useState<Set<string>>(new Set());
  const [selectedModules, setSelectedModules] = useState<
    Record<string, Set<string>>
  >({});
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());
  const [selectedArtifacts, setSelectedArtifacts] = useState<Set<string>>(
    new Set(),
  );

  // Decks the learner keeps in Keating, plus anything just read out of an Anki
  // file. Imported cards carry their Anki deck name as a tag.
  const deckChoices = useMemo(
    () =>
      mergeAnkiDeckChoices(
        sources?.decks ?? [],
        withDeckNameTags([...ankiDecks]),
      ),
    [ankiDecks, sources],
  );

  const selection = useMemo(
    () =>
      buildAssemblySelection(sources, deckChoices, {
        plans: selectedPlans,
        modules: selectedModules,
        decks: selectedDecks,
        artifacts: selectedArtifacts,
      }),
    [
      deckChoices,
      selectedArtifacts,
      selectedDecks,
      selectedModules,
      selectedPlans,
      sources,
    ],
  );

  const choosePlan = (planId: string) => {
    const plan = sources?.plans.find((candidate) => candidate.id === planId);
    const nextPlans = toggleSelected(selectedPlans, planId);
    setSelectedPlans(nextPlans);
    if (nextPlans.has(planId) && plan) {
      setSelectedModules((modules) => ({
        ...modules,
        [planId]: new Set(plan.items.map((item) => item.id)),
      }));
    }
  };

  const chooseModule = (planId: string, moduleId: string) => {
    const nextModules = toggleSelected(
      selectedModules[planId] ?? new Set(),
      moduleId,
    );
    setSelectedModules((current) => ({ ...current, [planId]: nextModules }));
    const nextPlans = new Set(selectedPlans);
    if (nextModules.size) nextPlans.add(planId);
    else nextPlans.delete(planId);
    setSelectedPlans(nextPlans);
  };

  const toggleDeck = (deckId: string) =>
    setSelectedDecks((current) => toggleSelected(current, deckId));
  const toggleArtifact = (artifactId: string) =>
    setSelectedArtifacts((current) => toggleSelected(current, artifactId));
  const selectDecks = (deckIds: readonly string[]) =>
    setSelectedDecks((current) => {
      const next = new Set(current);
      for (const id of deckIds) next.add(id);
      return next;
    });

  return {
    selectedPlans,
    selectedModules,
    selectedDecks,
    selectedArtifacts,
    deckChoices,
    selection,
    ...countSelection(selection),
    choosePlan,
    chooseModule,
    toggleDeck,
    toggleArtifact,
    selectDecks,
  };
}
