import { KeatingGlyph } from "../../design-system/glyphs";
import { Button, Loading, TextInput } from "../../design-system/kit";
import { useEffect, useRef, useState } from "react";
import { css, cx } from "../../../styled-system/css";
import {
  newCourseOperationId,
  uploadCourseMaterial,
  type applyCourseOperation,
} from "../../courses/client";
import type { CourseViewerSnapshot } from "../../courses/contracts";
import type { CourseBuilderSection } from "./CourseBuilder";
import "./course-builder.css";

type Mutate = (
  operation: Parameters<typeof applyCourseOperation>[0],
  label: string,
) => Promise<void>;

const menuItemClass = css({
  display: "grid",
  w: "100%",
  gridTemplateColumns: "1rem minmax(0, 1fr)",
  alignItems: "center",
  gap: "0.55rem",
  px: "0.7rem",
  py: "0.55rem",
  textAlign: "left",
  cursor: "pointer",
  _hover: { bg: "var(--k-wash)" },
});

/**
 * Pick a file and attach it to the course (or the open lesson) in one click.
 * Uploads bypass the operation log because bytes are stored beside the course.
 */
export function CourseDocumentUploadButton({
  courseId,
  lessonId,
  onSnapshot,
  onError,
  label = "Add document",
  className,
}: {
  courseId: string;
  lessonId?: string;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className={css({ display: "none" })}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          void uploadCourseMaterial(courseId, file, {
            title: file.name,
            ...(lessonId ? { lessonId } : {}),
          })
            .then(onSnapshot)
            .catch((cause) =>
              onError(
                cause instanceof Error
                  ? cause.message
                  : "That document could not be uploaded.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      />
      <Button
        type="button"
        disabled={busy}
        className={className}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loading size="inline" label="Uploading…" /> : <><KeatingGlyph name="import" size={14} /> {label}</>}
      </Button>
    </>
  );
}

/** Everything a course can gain, one menu, always in the same place. */
export function CourseAddMenu({
  triggerLabel = "Add",
  snapshot,
  activeLessonId,
  saving,
  mutate,
  onSnapshot,
  onError,
  onOpenBuilder,
}: {
  snapshot: CourseViewerSnapshot;
  activeLessonId?: string;
  saving: string;
  mutate: Mutate;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
  triggerLabel?: string;
  onOpenBuilder(section: CourseBuilderSection): void;
}) {
  const [open, setOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = snapshot.permissions.canEditCourse;
  const canCards = snapshot.permissions.canEditDeck;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setLinkOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        containerRef.current?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus();
        setOpen(false);
        setLinkOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!canEdit && !canCards) return null;

  const go = (section: CourseBuilderSection) => {
    setOpen(false);
    onOpenBuilder(section);
  };

  const addLink = async () => {
    if (!linkTitle.trim() || !linkUrl.trim()) return;
    await mutate(
      {
        id: newCourseOperationId(),
        courseId: snapshot.course.id,
        baseRevision: snapshot.course.revision,
        type: "material.add",
        material: {
          id: `material_${crypto.randomUUID().replaceAll("-", "")}`,
          kind: "link",
          title: linkTitle.trim(),
          url: linkUrl.trim(),
          ...(activeLessonId ? { lessonId: activeLessonId } : {}),
        },
      },
      "material-link",
    );
    setLinkTitle("");
    setLinkUrl("");
    setLinkOpen(false);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={css({ position: "relative" })}>
      <input
        ref={fileRef}
        type="file"
        className={css({ display: "none" })}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setUploading(true);
          setOpen(false);
          void uploadCourseMaterial(snapshot.course.id, file, {
            title: file.name,
            ...(activeLessonId ? { lessonId: activeLessonId } : {}),
          })
            .then(onSnapshot)
            .catch((cause) =>
              onError(
                cause instanceof Error
                  ? cause.message
                  : "That document could not be uploaded.",
              ),
            )
            .finally(() => setUploading(false));
        }}
      />
      <Button variant="line" glyph={uploading ? undefined : "plus"} aria-haspopup="dialog" aria-expanded={open}
        disabled={uploading} onClick={() => setOpen(value => !value)}>
        {uploading ? <Loading size="inline" label="Uploading…" /> : triggerLabel}
      </Button>
      {open ? (
        <div
          role="dialog" aria-label="Add to course"
          className="cb-add-menu"
        >
          <p className={cx("k-eyebrow", css({ px: "0.7rem", pt: "0.6rem" }))}>
            {activeLessonId ? "Adds to the open lesson" : "Adds to the course"}
          </p>
          {canEdit ? (
            <>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => fileRef.current?.click()}
              >
                <KeatingGlyph name="import" size={14} />
                <span>
                  <strong className={css({ display: "block", fontSize: "0.82rem" })}>
                    Upload a document or image
                  </strong>
                  <small className={css({ color: "var(--ink-soft)" })}>
                    PDF, slides, notes, or a picture · 25 MB max
                  </small>
                </span>
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => setLinkOpen((value) => !value)}
              >
                <KeatingGlyph name="link" size={14} />
                <span>
                  <strong className={css({ display: "block", fontSize: "0.82rem" })}>
                    Add a link
                  </strong>
                  <small className={css({ color: "var(--ink-soft)" })}>
                    An article, video, dataset, or reference
                  </small>
                </span>
              </button>
              {linkOpen ? (
                <div
                  className={css({
                    display: "grid",
                    gap: "0.4rem",
                    borderTop: "1px solid var(--ink)",
                    borderBottom: "1px solid var(--ink)",
                    bg: "var(--paper)",
                    p: "0.6rem",
                  })}
                >
                  <TextInput
                    value={linkTitle}
                    onChange={(event) => setLinkTitle(event.target.value)}
                    placeholder="Link title"
                    aria-label="Link title"
                  />
                  <TextInput
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder="https://…"
                    type="url"
                    aria-label="Link address"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      !linkTitle.trim() ||
                      !linkUrl.trim() ||
                      saving === "material-link"
                    }
                    onClick={() => void addLink()}
                  >
                    <KeatingGlyph name="plus" size={13} /> Add link
                  </Button>
                </div>
              ) : null}
              <button
                type="button"
                className={menuItemClass}
                onClick={() => go("outline")}
              >
                <KeatingGlyph name="tree" size={14} />
                <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                  Module or lesson
                </span>
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => go("assignments")}
              >
                <KeatingGlyph name="checklist" size={14} />
                <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                  Assignment
                </span>
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => go("artifacts")}
              >
                <KeatingGlyph name="quiz" size={14} />
                <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                  Quiz or artifact
                </span>
              </button>
            </>
          ) : null}
          {canCards ? (
            <button
              type="button"
              className={menuItemClass}
              onClick={() => go("cards")}
            >
              <KeatingGlyph name="layers" size={14} />
              <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                Flashcard
              </span>
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={cx(
                menuItemClass,
                css({ borderTop: "1px solid var(--ink)" }),
              )}
              onClick={() => go("documents")}
            >
              <KeatingGlyph name="tool" size={14} />
              <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                Open the full builder
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
