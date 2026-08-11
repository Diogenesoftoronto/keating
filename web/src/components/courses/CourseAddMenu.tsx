import { useEffect, useRef, useState } from "react";
import {
  BookUp,
  ChevronDown,
  CreditCard,
  FileQuestion,
  FilePlus2,
  Layers3,
  Link2,
  Plus,
  RefreshCw,
  Shapes,
  Upload,
} from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
  newCourseOperationId,
  uploadCourseMaterial,
  type applyCourseOperation,
} from "../../courses/client";
import type { CourseViewerSnapshot } from "../../courses/contracts";
import type { CourseBuilderSection } from "./CourseBuilder";
import {
  courseButtonClass,
  courseInputClass,
  courseLabelClass,
  coursePrimaryButtonClass,
} from "./course-ui";

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
  _hover: { bg: "var(--course-wash, #ddebdd)" },
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
      <button
        type="button"
        disabled={busy}
        className={cx(courseButtonClass, className)}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <RefreshCw size={14} /> : <FilePlus2 size={14} />}
        {busy ? "Uploading…" : label}
      </button>
    </>
  );
}

/** Everything a course can gain, one menu, always in the same place. */
export function CourseAddMenu({
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
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={uploading}
        className={cx(courseButtonClass, coursePrimaryButtonClass)}
        onClick={() => setOpen((value) => !value)}
      >
        {uploading ? <RefreshCw size={14} /> : <Plus size={14} />}
        <span className={css({ display: { base: "none", sm: "inline" } })}>
          {uploading ? "Uploading…" : "Add"}
        </span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div
          role="menu"
          className={css({
            position: "absolute",
            top: "calc(100% + 0.4rem)",
            right: 0,
            zIndex: 60,
            w: "min(20rem, calc(100vw - 2rem))",
            border: "2px solid var(--ink)",
            bg: "var(--card)",
            boxShadow: "6px 6px 0 color-mix(in srgb, var(--ink) 30%, transparent)",
          })}
        >
          <p className={cx(courseLabelClass, css({ px: "0.7rem", pt: "0.6rem" }))}>
            {activeLessonId ? "Adds to the open lesson" : "Adds to the course"}
          </p>
          {canEdit ? (
            <>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={14} />
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
                <Link2 size={14} />
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
                  <input
                    value={linkTitle}
                    onChange={(event) => setLinkTitle(event.target.value)}
                    className={courseInputClass}
                    placeholder="Link title"
                    aria-label="Link title"
                  />
                  <input
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    className={courseInputClass}
                    placeholder="https://…"
                    type="url"
                    aria-label="Link address"
                  />
                  <button
                    type="button"
                    className={cx(courseButtonClass, coursePrimaryButtonClass)}
                    disabled={
                      !linkTitle.trim() ||
                      !linkUrl.trim() ||
                      saving === "material-link"
                    }
                    onClick={() => void addLink()}
                  >
                    <Plus size={13} /> Add link
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className={menuItemClass}
                onClick={() => go("outline")}
              >
                <Layers3 size={14} />
                <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                  Module or lesson
                </span>
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => go("assignments")}
              >
                <BookUp size={14} />
                <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                  Assignment
                </span>
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => go("artifacts")}
              >
                <FileQuestion size={14} />
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
              <CreditCard size={14} />
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
              <Shapes size={14} />
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
