/**
 * Course creation form. Picks saved plans, decks, artifacts, and an optional
 * Anki import as starting material. Layout only: selection state lives in
 * `useCourseAssemblySelection`, the create flow (including saving imported
 * decks before the course exists) in `useCourseCreation`, and each panel in
 * `./assembler/`.
 */
import { useState } from "react";
import "./course-builder.css";
import type { CoursesAccount } from "../../courses/useCoursesAccess";
import { ArtifactsSection } from "./assembler/ArtifactsSection";
import { AssemblerHeader } from "./assembler/AssemblerHeader";
import { CreateFooter } from "./assembler/CreateFooter";
import { DecksSection } from "./assembler/DecksSection";
import { DetailsFields } from "./assembler/DetailsFields";
import { PlansSection } from "./assembler/PlansSection";
import { SelectionSummary } from "./assembler/SelectionSummary";
import { SourceStatus } from "./assembler/SourceStatus";
import { useAnkiImport } from "./assembler/useAnkiImport";
import { useAssemblerSources } from "./assembler/useAssemblerSources";
import { useCourseAssemblySelection } from "./useCourseAssemblySelection";
import { useCourseCreation } from "./useCourseCreation";

export function CourseAssembler({
  account,
  onCreated,
  onClose,
}: {
  account: CoursesAccount;
  onCreated(courseId: string): void;
  onClose(): void;
}) {
  const { sources, sourceError } = useAssemblerSources();
  const [title, setTitle] = useState("Untitled course");
  const [description, setDescription] = useState("");
  const [reviewAfterSave, setReviewAfterSave] = useState(false);
  const anki = useAnkiImport();
  const pick = useCourseAssemblySelection(sources, anki.ankiDecks);

  const { creating, error, setError, create } = useCourseCreation({
    account,
    counts: {
      moduleCount: pick.moduleCount,
      cardCount: pick.cardCount,
      artifactCount: pick.artifactCount,
    },
    hasAnkiImport: anki.ankiDecks.length > 0,
    clearNotice: anki.clearAnkiNotice,
    onCreated,
    request: () => ({
      assembly: { title, description, ...pick.selection },
      displayName: account.displayName,
      ankiDecks: anki.ankiDecks,
      selectedDeckIds: pick.selectedDecks,
      keepAnkiDecks: anki.keepAnkiDecks,
      reviewAfterSave,
    }),
  });

  return (
    <section
      aria-labelledby="course-assembler-title"
      className="cb-assembler">
      <AssemblerHeader onClose={onClose}/>
      <div className="cb-assembly-grid">
        <div className="cb-assembly-details">
          <DetailsFields
            title={title}
            description={description}
            reviewAfterSave={reviewAfterSave}
            onTitleChange={setTitle}
            onDescriptionChange={setDescription}
            onReviewAfterSaveChange={setReviewAfterSave}
          />
          <SelectionSummary
            hasSources={pick.hasSources}
            moduleCount={pick.moduleCount}
            artifactCount={pick.artifactCount}
            cardCount={pick.cardCount}
          />
          <CreateFooter
            creating={creating}
            titleValid={!!title.trim()}
            hasSources={pick.hasSources}
            error={error}
            onCreate={() => void create()}
          />
        </div>

        <div className="cb-sources">
          <SourceStatus
            loading={!sources && !sourceError}
            error={sourceError}
          />
          {sources ? (
            <>
              <PlansSection
                plans={sources.plans}
                selected={pick.selectedPlans}
                selectedModules={pick.selectedModules}
                onChoosePlan={pick.choosePlan}
                onChooseModule={pick.chooseModule}
              />
              <DecksSection
                deckChoices={pick.deckChoices}
                ankiDecks={anki.ankiDecks}
                ankiFileName={anki.ankiFileName}
                ankiNotice={anki.ankiNotice}
                ankiReading={anki.ankiReading}
                keepAnkiDecks={anki.keepAnkiDecks}
                selectedDecks={pick.selectedDecks}
                ankiInputRef={anki.ankiInputRef}
                onReadAnki={(file) =>
                  anki.readAnki(file, {
                    onDecksRead: pick.selectDecks,
                    onError: setError,
                  })
                }
                onKeepAnkiDecksChange={anki.setKeepAnkiDecks}
                onToggleDeck={pick.toggleDeck}
              />
              <ArtifactsSection
                artifacts={sources.artifacts}
                selected={pick.selectedArtifacts}
                onToggle={pick.toggleArtifact}
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
