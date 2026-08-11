import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Layers3,
  Loader2,
  Plus,
  Rows3,
  Shapes,
  Upload,
  X,
} from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
  assembleCourseInput,
  loadCourseAssemblySources,
  type CourseAssemblySources,
} from "../../courses/course-assembly";
import {
  ANKI_FILE_ACCEPT,
  mergeAnkiDeckChoices,
  readAnkiFile,
  withDeckNameTags,
} from "../../courses/course-anki";
import { createCourse } from "../../courses/client";
import type { CoursesAccount } from "../../courses/useCoursesAccess";
import { mergeAnkiDeck } from "../../keating/anki-package";
import type { FlashcardDeck } from "../../keating/flashcard-types";
import { getInitPromise, keatingStorage } from "../../hooks/keating-storage";

const inputClass = css({
  w: "100%",
  border: "1px solid var(--ink)",
  bg: "var(--paper)",
  px: "0.75rem",
  py: "0.65rem",
  fontSize: "0.86rem",
  outline: 0,
  _focus: { boxShadow: "0 0 0 2px var(--peer-blue, #3468b3)" },
});

const choiceClass = css({
  display: "grid",
  gridTemplateColumns: "1.1rem minmax(0, 1fr)",
  alignItems: "start",
  gap: "0.65rem",
  border: "1px solid var(--ink)",
  bg: "var(--card)",
  p: "0.8rem",
});

function toggle(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function CourseAssembler({
  account,
  onCreated,
  onClose,
}: {
  account: CoursesAccount;
  onCreated(courseId: string): void;
  onClose(): void;
}) {
  const [sources, setSources] = useState<CourseAssemblySources | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [title, setTitle] = useState("Untitled course");
  const [description, setDescription] = useState("");
  const [selectedPlans, setSelectedPlans] = useState<Set<string>>(new Set());
  const [selectedModules, setSelectedModules] = useState<
    Record<string, Set<string>>
  >({});
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());
  const [selectedArtifacts, setSelectedArtifacts] = useState<Set<string>>(
    new Set(),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [ankiNotice, setAnkiNotice] = useState("");
  const [ankiDecks, setAnkiDecks] = useState<FlashcardDeck[]>([]);
  const [ankiFileName, setAnkiFileName] = useState("");
  const [ankiReading, setAnkiReading] = useState(false);
  const [keepAnkiDecks, setKeepAnkiDecks] = useState(true);
  const ankiInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadCourseAssemblySources()
      .then((value) => {
        if (!cancelled) setSources(value);
      })
      .catch((cause) => {
        if (!cancelled)
          setSourceError(
            cause instanceof Error
              ? cause.message
              : "Saved work could not be loaded.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Decks the learner keeps in Keating, plus anything just read out of an Anki
  // file. Imported cards carry their Anki deck name as a tag.
  const deckChoices = useMemo(
    () =>
      mergeAnkiDeckChoices(
        sources?.decks ?? [],
        withDeckNameTags(ankiDecks),
      ),
    [ankiDecks, sources],
  );

  const selection = useMemo(
    () => ({
      plans: (sources?.plans ?? [])
        .filter((plan) => selectedPlans.has(plan.id))
        .map((source) => ({
          source,
          moduleIds: [...(selectedModules[source.id] ?? new Set())],
        })),
      decks: deckChoices.filter((deck) => selectedDecks.has(deck.id)),
      artifacts: (sources?.artifacts ?? []).filter((artifact) =>
        selectedArtifacts.has(artifact.id),
      ),
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
  const hasSources = moduleCount > 0 || cardCount > 0 || artifactCount > 0;

  const choosePlan = (planId: string) => {
    const plan = sources?.plans.find((candidate) => candidate.id === planId);
    const nextPlans = toggle(selectedPlans, planId);
    setSelectedPlans(nextPlans);
    if (nextPlans.has(planId) && plan) {
      setSelectedModules((modules) => ({
        ...modules,
        [planId]: new Set(plan.items.map((item) => item.id)),
      }));
    }
  };

  const chooseModule = (planId: string, moduleId: string) => {
    const nextModules = toggle(selectedModules[planId] ?? new Set(), moduleId);
    setSelectedModules((current) => ({ ...current, [planId]: nextModules }));
    const nextPlans = new Set(selectedPlans);
    if (nextModules.size) nextPlans.add(planId);
    else nextPlans.delete(planId);
    setSelectedPlans(nextPlans);
  };

  const readAnki = (file: File) => {
    setAnkiReading(true);
    setError("");
    setAnkiNotice("");
    void readAnkiFile(file)
      .then((result) => {
        setAnkiDecks(result.decks);
        setAnkiFileName(result.fileName);
        setSelectedDecks((current) => {
          const next = new Set(current);
          for (const deck of result.decks) next.add(deck.id);
          return next;
        });
        setAnkiNotice(
          [
            `${result.cardCount} card${result.cardCount === 1 ? "" : "s"} ready from ${result.fileName}.`,
            ...result.warnings,
          ].join(" "),
        );
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "That Anki file could not be read.",
        ),
      )
      .finally(() => setAnkiReading(false));
  };

  const create = async () => {
    setCreating(true);
    setError("");
    setAnkiNotice("");
    try {
      const input = assembleCourseInput({ title, description, ...selection });
      // Save the optional review copy before creating the course. If storage is
      // unavailable, the learner can uncheck this option and retry without
      // accidentally creating a second course.
      if (keepAnkiDecks && ankiDecks.length) {
        await getInitPromise();
        for (const deck of withDeckNameTags(ankiDecks)) {
          if (!selectedDecks.has(deck.id)) continue;
          const existing = await keatingStorage.getDeck(deck.id);
          await keatingStorage.saveDeck(mergeAnkiDeck(existing, deck).deck);
        }
      }
      const snapshot = await createCourse({
        ...input,
        displayName: account.displayName,
      });
      onCreated(snapshot.course.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The course could not be created.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <section
      aria-labelledby="course-assembler-title"
      className={css({
        mt: "1.5rem",
        border: "2px solid var(--ink)",
        bg: "var(--card)",
        boxShadow: "6px 6px 0 color-mix(in srgb, var(--ink) 22%, transparent)",
      })}
    >
      <header
        className={css({
          display: "flex",
          alignItems: "start",
          justifyContent: "space-between",
          gap: "1rem",
          borderBottom: "1px solid var(--ink)",
          bg: "var(--course-wash, #ddebdd)",
          p: "1rem",
        })}
      >
        <div>
          <p
            className={css({
              fontFamily: "var(--mono-display)",
              fontSize: "0.66rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--course-green-dark, #14743c)",
            })}
          >
            New course
          </p>
          <h2
            id="course-assembler-title"
            className={css({
              mt: "0.25rem",
              fontFamily: "Georgia, serif",
              fontSize: "1.8rem",
            })}
          >
            Assemble the course you want.
          </h2>
          <p
            className={css({
              mt: "0.35rem",
              maxW: "65ch",
              color: "var(--ink-soft)",
              lineHeight: 1.55,
            })}
          >
            Start empty, or bring in plans, quizzes, generated UI, visuals,
            maps, animations, and cards you already made with Keating.
            Everything stays editable.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close course assembler"
          className={css({
            p: "0.35rem",
            _hover: { bg: "color-mix(in srgb, var(--ink) 8%, transparent)" },
          })}
        >
          <X size={19} />
        </button>
      </header>

      <div
        className={css({
          display: "grid",
          lg: {
            gridTemplateColumns: "minmax(18rem, 0.75fr) minmax(22rem, 1.25fr)",
          },
        })}
      >
        <div
          className={css({
            borderBottom: "1px solid var(--ink)",
            p: "1rem",
            lg: { borderRight: "1px solid var(--ink)", borderBottom: 0 },
          })}
        >
          <label
            className={css({
              display: "grid",
              gap: "0.35rem",
              fontSize: "0.74rem",
              fontWeight: 700,
            })}
          >
            Course title
            <input
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClass}
              autoFocus
            />
          </label>
          <label
            className={css({
              mt: "0.8rem",
              display: "grid",
              gap: "0.35rem",
              fontSize: "0.74rem",
              fontWeight: 700,
            })}
          >
            What this course is for{" "}
            <textarea
              value={description}
              maxLength={4_000}
              onChange={(event) => setDescription(event.target.value)}
              className={inputClass}
              rows={3}
              placeholder="Optional. You can change this later."
            />
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || !title.trim()}
            className={css({
              mt: "1rem",
              display: "inline-flex",
              w: "100%",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              border: "2px solid var(--ink)",
              bg: "var(--course-green, #1e9b50)",
              px: "1rem",
              py: "0.75rem",
              fontWeight: 800,
              color: "white",
              boxShadow: "4px 4px 0 var(--ink)",
              _disabled: { opacity: 0.6 },
            })}
          >
            {creating ? (
              <Loader2
                size={17}
                className={css({ animation: "spin 1s linear infinite" })}
              />
            ) : (
              <Plus size={17} />
            )}
            {creating
              ? "Creating…"
              : hasSources
                ? "Create assembled course"
                : "Create blank course"}
          </button>
          {error && (
            <p
              role="alert"
              className={css({
                mt: "0.8rem",
                color: "var(--destructive)",
                fontSize: "0.8rem",
              })}
            >
              {error}
            </p>
          )}
          <div
            className={css({
              mt: "1rem",
              border: "1px solid var(--ink)",
              bg: "var(--paper)",
              p: "0.8rem",
            })}
          >
            <p
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
                fontWeight: 750,
              })}
            >
              {hasSources ? <Check size={16} /> : <Rows3 size={16} />}{" "}
              {hasSources ? "Assembled start" : "Blank start"}
            </p>
            <p
              className={css({
                mt: "0.3rem",
                fontSize: "0.76rem",
                color: "var(--ink-soft)",
                lineHeight: 1.5,
              })}
            >
              {hasSources
                ? `${moduleCount} plan section${moduleCount === 1 ? "" : "s"}, ${artifactCount} artifact${artifactCount === 1 ? "" : "s"}, and ${cardCount} card${cardCount === 1 ? "" : "s"} selected.`
                : "No template content. Open the course and add your first module, lesson, assignment, source, quiz, or card."}
            </p>
          </div>
        </div>

        <div className={css({ p: "1rem" })}>
          {!sources && !sourceError ? (
            <p
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                py: "2rem",
                color: "var(--ink-soft)",
              })}
            >
              <Loader2
                size={16}
                className={css({ animation: "spin 1s linear infinite" })}
              />{" "}
              Looking through your saved work…
            </p>
          ) : null}
          {sourceError ? (
            <p
              role="alert"
              className={css({
                color: "var(--destructive)",
                fontSize: "0.8rem",
              })}
            >
              Your saved sources could not be loaded: {sourceError}. You can
              still create a blank course.
            </p>
          ) : null}
          {sources ? (
            <>
              <section>
                <div
                  className={css({
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "1rem",
                  })}
                >
                  <h3
                    className={css({
                      display: "flex",
                      alignItems: "center",
                      gap: "0.45rem",
                      fontFamily: "Georgia, serif",
                      fontSize: "1.2rem",
                    })}
                  >
                    <BookOpen size={17} /> Plans from your chats
                  </h3>
                  <span
                    className={css({
                      fontFamily: "var(--mono-display)",
                      fontSize: "0.65rem",
                      color: "var(--ink-soft)",
                    })}
                  >
                    {sources.plans.length}
                  </span>
                </div>
                {sources.plans.length ? (
                  <div
                    className={css({
                      mt: "0.65rem",
                      display: "grid",
                      gap: "0.65rem",
                    })}
                  >
                    {sources.plans.map((plan) => (
                      <article key={plan.id} className={choiceClass}>
                        <input
                          type="checkbox"
                          checked={selectedPlans.has(plan.id)}
                          onChange={() => choosePlan(plan.id)}
                          aria-label={`Include ${plan.title}`}
                        />
                        <div>
                          <strong
                            className={css({
                              display: "block",
                              fontSize: "0.85rem",
                            })}
                          >
                            {plan.title}
                          </strong>
                          <span
                            className={css({
                              display: "block",
                              mt: "0.15rem",
                              fontSize: "0.7rem",
                              color: "var(--ink-soft)",
                            })}
                          >
                            From “{plan.sessionTitle}”
                          </span>
                          {selectedPlans.has(plan.id) ? (
                            <div
                              className={css({
                                mt: "0.55rem",
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "0.35rem",
                              })}
                            >
                              {plan.items.map((item) => (
                                <label
                                  key={item.id}
                                  className={css({
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.3rem",
                                    border: "1px solid var(--ink)",
                                    bg:
                                      (selectedModules[plan.id]?.has(item.id) ??
                                      false)
                                        ? "var(--course-wash, #ddebdd)"
                                        : "var(--paper)",
                                    px: "0.45rem",
                                    py: "0.3rem",
                                    fontSize: "0.68rem",
                                  })}
                                >
                                  <input
                                    type="checkbox"
                                    checked={
                                      selectedModules[plan.id]?.has(item.id) ??
                                      false
                                    }
                                    onChange={() =>
                                      chooseModule(plan.id, item.id)
                                    }
                                  />{" "}
                                  {item.title}
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p
                    className={css({
                      mt: "0.5rem",
                      fontSize: "0.78rem",
                      color: "var(--ink-soft)",
                      lineHeight: 1.5,
                    })}
                  >
                    No saved StudyPlans yet. Ask Keating for a lesson plan in
                    chat, then it will appear here.
                  </p>
                )}
              </section>
              <section
                className={css({
                  mt: "1.25rem",
                  borderTop: "1px solid var(--ink)",
                  pt: "1rem",
                })}
              >
                <div
                  className={css({
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "1rem",
                  })}
                >
                  <h3
                    className={css({
                      display: "flex",
                      alignItems: "center",
                      gap: "0.45rem",
                      fontFamily: "Georgia, serif",
                      fontSize: "1.2rem",
                    })}
                  >
                    <Layers3 size={17} /> Flashcard decks
                  </h3>
                  <span
                    className={css({
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontFamily: "var(--mono-display)",
                      fontSize: "0.65rem",
                      color: "var(--ink-soft)",
                    })}
                  >
                    {deckChoices.length}
                    <input
                      ref={ankiInputRef}
                      type="file"
                      accept={ANKI_FILE_ACCEPT}
                      className={css({ display: "none" })}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) readAnki(file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={ankiReading}
                      onClick={() => ankiInputRef.current?.click()}
                      className={css({
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        border: "1px solid var(--ink)",
                        px: "0.5rem",
                        py: "0.3rem",
                        fontSize: "0.68rem",
                        fontWeight: 750,
                        color: "var(--ink)",
                        cursor: "pointer",
                        _hover: { bg: "var(--course-wash, #ddebdd)" },
                        _disabled: { opacity: 0.5 },
                      })}
                    >
                      <Upload size={12} />
                      {ankiReading ? "Reading…" : "Import Anki file"}
                    </button>
                  </span>
                </div>
                {ankiFileName ? (
                  <p
                    className={css({
                      mt: "0.5rem",
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "0.6rem",
                      fontSize: "0.74rem",
                      color: "var(--ink-soft)",
                    })}
                  >
                    <span>
                      Read {ankiDecks.length} deck
                      {ankiDecks.length === 1 ? "" : "s"} from {ankiFileName}
                    </span>
                    <label
                      className={css({
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                      })}
                    >
                      <input
                        type="checkbox"
                        checked={keepAnkiDecks}
                        onChange={(event) =>
                          setKeepAnkiDecks(event.target.checked)
                        }
                      />
                      Keep them in my review decks too
                    </label>
                  </p>
                ) : null}
                {ankiNotice ? (
                  <p
                    role="status"
                    className={css({
                      mt: "0.35rem",
                      fontSize: "0.74rem",
                      color: "var(--ink-soft)",
                    })}
                  >
                    {ankiNotice}
                  </p>
                ) : null}
                {deckChoices.length ? (
                  <div
                    className={css({
                      mt: "0.65rem",
                      display: "grid",
                      gap: "0.5rem",
                      sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
                    })}
                  >
                    {deckChoices.map((deck) => (
                      <label
                        key={deck.id}
                        className={cx(choiceClass, css({ cursor: "pointer" }))}
                      >
                        <input
                          type="checkbox"
                          checked={selectedDecks.has(deck.id)}
                          onChange={() =>
                            setSelectedDecks((current) =>
                              toggle(current, deck.id),
                            )
                          }
                        />
                        <span>
                          <strong
                            className={css({
                              display: "block",
                              fontSize: "0.82rem",
                            })}
                          >
                            {deck.title}
                          </strong>
                          <small className={css({ color: "var(--ink-soft)" })}>
                            {deck.cards.length} card
                            {deck.cards.length === 1 ? "" : "s"}
                            {ankiDecks.some(
                              (candidate) => candidate.id === deck.id,
                            )
                              ? ` · from ${ankiFileName}`
                              : ""}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p
                    className={css({
                      mt: "0.5rem",
                      fontSize: "0.78rem",
                      color: "var(--ink-soft)",
                    })}
                  >
                    No saved decks yet. You can add cards after opening the
                    course.
                  </p>
                )}
              </section>
              <section
                className={css({
                  mt: "1.25rem",
                  borderTop: "1px solid var(--ink)",
                  pt: "1rem",
                })}
              >
                <div
                  className={css({
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "1rem",
                  })}
                >
                  <h3
                    className={css({
                      display: "flex",
                      alignItems: "center",
                      gap: "0.45rem",
                      fontFamily: "Georgia, serif",
                      fontSize: "1.2rem",
                    })}
                  >
                    <Shapes size={17} /> Artifact tray
                  </h3>
                  <span
                    className={css({
                      fontFamily: "var(--mono-display)",
                      fontSize: "0.65rem",
                      color: "var(--ink-soft)",
                    })}
                  >
                    {sources.artifacts.length}
                  </span>
                </div>
                <p
                  className={css({
                    mt: "0.25rem",
                    fontSize: "0.72rem",
                    color: "var(--ink-soft)",
                  })}
                >
                  Quizzes, GenUI, images, maps, animations, verifications, and
                  other saved work.
                </p>
                {sources.artifacts.length ? (
                  <div
                    className={css({
                      mt: "0.65rem",
                      display: "grid",
                      maxH: "22rem",
                      gap: "0.5rem",
                      overflowY: "auto",
                      pr: "0.25rem",
                      sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
                    })}
                  >
                    {sources.artifacts.map((artifact) => (
                      <label
                        key={artifact.id}
                        className={cx(choiceClass, css({ cursor: "pointer" }))}
                      >
                        <input
                          type="checkbox"
                          checked={selectedArtifacts.has(artifact.id)}
                          onChange={() =>
                            setSelectedArtifacts((current) =>
                              toggle(current, artifact.id),
                            )
                          }
                        />
                        <span>
                          <strong
                            className={css({
                              display: "block",
                              fontSize: "0.82rem",
                            })}
                          >
                            {artifact.title}
                          </strong>
                          <small
                            className={css({
                              display: "block",
                              mt: "0.1rem",
                              color: "var(--ink-soft)",
                            })}
                          >
                            {artifact.kind.replaceAll("-", " ")} ·{" "}
                            {artifact.sourceLabel}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p
                    className={css({
                      mt: "0.5rem",
                      fontSize: "0.78rem",
                      color: "var(--ink-soft)",
                    })}
                  >
                    Saved quizzes and generated learning artifacts will appear
                    here.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
