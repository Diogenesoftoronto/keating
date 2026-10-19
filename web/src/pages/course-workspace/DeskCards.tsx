/**
 * Cards rendered inside the reading desk: a course source (document/link/note),
 * an assignment with its submission form and delivery status, and an artifact
 * with its reaction bar. Each receives the viewer snapshot and routes writes
 * through the page's `mutate`/`onToggleReaction` callbacks.
 */
import { useEffect, useState } from "react";
import { ExternalLink, FileText, Send } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { CourseArtifactCard } from "../../components/courses/CourseArtifactCard";
import { CourseReactionBar } from "../../components/courses/CourseReactionBar";
import { SubmissionDeliveryStatus } from "../../components/SubmissionDeliveryStatus";
import { SubmissionAttachments, AttachmentLinks } from "../../components/SubmissionAttachments";
import { courseMaterialUrl, newCourseOperationId } from "../../courses/client";
import { courseAssignmentToTask } from "../../courses/task-assignments";
import { TaskBrief } from "../../keating/openui/shared-renderer";
import { latestCourseSubmission, queueCourseSubmission, submissionKey, syncCourseSubmissions, type QueuedSubmission } from "../../submissions/course-outbox";
import type { UiSubmissionAttachment } from "@keating/learner-contracts";
import type { CourseAssignment, CourseArtifact, CourseMaterial, CourseViewerSnapshot } from "../../courses/contracts";
import type { ToggleReaction, WorkspaceMutate } from "./state";
import { workspaceStyles as s } from "./styles";

/** Reactions follow the same rule as comments, so nothing offers a dead click. */
export function canReact(snapshot: CourseViewerSnapshot): boolean {
  return (
    snapshot.course.settings.allowPeerComments || snapshot.permissions.canReview
  );
}

export function CourseSourceCard({
  snapshot,
  material,
  onToggleReaction,
}: {
  snapshot: CourseViewerSnapshot;
  material: CourseMaterial;
  onToggleReaction: ToggleReaction;
}) {
  const href = material.url ?? courseMaterialUrl(snapshot.course.id, material.id);
  const reactions = (
    <CourseReactionBar
      reactions={snapshot.course.reactions}
      members={snapshot.course.members}
      targetKind="material"
      targetId={material.id}
      viewerAccountId={snapshot.viewer.accountId}
      disabled={!canReact(snapshot)}
      onToggle={(emoji) => onToggleReaction("material", material.id, emoji)}
    />
  );
  if (material.kind === "image")
    return (
      <figure className={css({ mt: "1rem" })}>
        <a href={href} target="_blank" rel="noreferrer">
          <img
            src={href}
            alt={material.description ?? material.title}
            loading="lazy"
            className={css({
              display: "block",
              maxH: "42rem",
              w: "100%",
              border: "1px solid var(--ink)",
              objectFit: "contain",
            })}
          />
        </a>
        <figcaption
          className={css({
            mt: "0.4rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            fontSize: "0.72rem",
            color: "var(--ink-soft)",
          })}
        >
          {material.title}
          {reactions}
        </figcaption>
      </figure>
    );
  return (
    <div
      className={css({
        mt: "0.75rem",
        border: "1px solid var(--ink)",
        bg: "var(--paper)",
      })}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={css({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          px: "0.8rem",
          py: "0.7rem",
          color: "inherit",
          textDecoration: "none",
          _hover: { bg: "var(--course-wash, #ddebdd)" },
        })}
      >
        <span
          className={css({
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
          })}
        >
          {material.kind === "link" ? (
            <ExternalLink size={15} />
          ) : (
            <FileText size={15} />
          )}
          <span>
            <strong className={css({ display: "block", fontSize: "0.8rem" })}>
              {material.title}
            </strong>
            <small className={css({ color: "var(--ink-soft)" })}>
              {material.fileName ?? material.url ?? "Course document"}
            </small>
          </span>
        </span>
        <ExternalLink size={14} />
      </a>
      <div
        className={css({
          borderTop: "1px solid color-mix(in srgb, var(--ink) 20%, transparent)",
          px: "0.8rem",
          py: "0.4rem",
        })}
      >
        {reactions}
      </div>
    </div>
  );
}

export function AssignmentSubmissionCard({
  snapshot,
  assignment,
  onToggleReaction,
  courseWide = false,
}: {
  snapshot: CourseViewerSnapshot;
  assignment: CourseAssignment;
  mutate: WorkspaceMutate;
  saving: string;
  onToggleReaction: ToggleReaction;
  courseWide?: boolean;
}) {
  const submission = snapshot.course.assignmentSubmissions.find(
    (candidate) =>
      candidate.assignmentId === assignment.id &&
      candidate.accountId === snapshot.viewer.accountId,
  );
  const [answer, setAnswer] = useState(submission?.answer ?? "");
  const [attachments, setAttachments] = useState<UiSubmissionAttachment[]>(submission?.attachments ?? []);
  const [uploading, setUploading] = useState(false);
  const notYetOpen = !!assignment.availableFrom && Date.now() < Date.parse(assignment.availableFrom);
  const [share, setShare] = useState(submission?.sharedWithPeers ?? false);
  const [localSubmission, setLocalSubmission] = useState<QueuedSubmission>();
  const [localError, setLocalError] = useState("");
  const [localSaving, setLocalSaving] = useState(false);
  const [restored, setRestored] = useState(false);
  const localKey = submissionKey(snapshot.viewer.accountId, snapshot.course.id, assignment.id);
  useEffect(() => {
    let active = true;
    setRestored(false);
    void latestCourseSubmission(localKey).then((stored) => {
      if (!active) return;
      const local = stored?.state === "delivered" && (submission?.version ?? 0) > (stored.deliveredVersion ?? 0) ? undefined : stored;
      setLocalSubmission(local);
      setAnswer(local?.operation.answer ?? submission?.answer ?? "");
      setAttachments(local?.operation.attachments ?? submission?.attachments ?? []);
      setShare(local?.operation.sharedWithPeers ?? submission?.sharedWithPeers ?? false);
      setRestored(true);
    }).catch(() => { if (active) { setLocalError("Local storage is unavailable. Your work cannot be saved on this device yet."); setRestored(true); } });
    const update = () => { void latestCourseSubmission(localKey).then((local) => { if (active) setLocalSubmission(local); }).catch(() => {}); };
    window.addEventListener("keating:submission-saved", update);
    return () => { active = false; window.removeEventListener("keating:submission-saved", update); };
  }, [localKey]);
  const save = async (status: "draft" | "submitted") => {
    setLocalSaving(true); setLocalError("");
    try {
      const local = await queueCourseSubmission(snapshot.viewer.accountId, {
        id: newCourseOperationId(), courseId: snapshot.course.id,
        baseRevision: snapshot.course.revision, type: "assignment.submission.save",
        submissionId: submission?.id ?? `assignment_submission_${crypto.randomUUID().replaceAll("-", "")}`,
        assignmentId: assignment.id, answer, attachments, status,
        sharedWithPeers: share, baseVersion: submission?.version ?? 0,
      });
      setLocalSubmission(local);
      // A network failure cannot undo the completed local transaction.
      void syncCourseSubmissions().catch(() => {});
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Could not save on this device."); }
    finally { setLocalSaving(false); }
  };
  return (
    <section
      className={css({
        mt: "1.5rem",
        border: "2px solid var(--ink)",
        bg: "var(--paper)",
        boxShadow: `5px 5px 0 ${courseWide ? "var(--peer-blue, #3468b3)" : "var(--amber, #e8a33d)"}`,
      })}
    >
      <header
        className={css({
          borderBottom: "1px solid var(--ink)",
          bg: courseWide ? "#e3ebfa" : "#fff0d4",
          px: "1rem",
          py: "0.75rem",
        })}
      >
        <p className={s.sectionLabel}>
          {courseWide ? "Course assignment" : "Long-range assignment"}
          {submission ? ` · ${submission.status}` : ""}
        </p>
        <h3
          className={css({
            mt: "0.2rem",
            fontFamily: "Georgia, serif",
            fontSize: "1.45rem",
          })}
        >
          {assignment.title}
        </h3>
        <div
          className={css({
            mt: "0.35rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            fontSize: "0.7rem",
            color: "var(--ink-soft)",
          })}
        >
          {assignment.dueAt ? (
            <span>Due {new Date(assignment.dueAt).toLocaleString()}</span>
          ) : (
            <span>No fixed due date</span>
          )}
          {assignment.estimatedHours ? (
            <span>{assignment.estimatedHours} estimated hours</span>
          ) : null}
        </div>
      </header>
      <div className={css({ p: "1rem" })}>
        <TaskBrief node={courseAssignmentToTask(assignment)} />
        {(assignment.taskItems?.length || assignment.deliverables.length) ? <ol>
          {(assignment.taskItems ?? assignment.deliverables.map((title, index) => ({ id: String(index), title, detail: undefined }))).map((item) => <li key={item.id}><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</li>)}
        </ol> : null}
        {localSubmission ? <SubmissionDeliveryStatus state={localSubmission.state} error={localSubmission.error} onRetry={() => void syncCourseSubmissions().catch(() => {})} /> : null}
        {localError ? <p role="alert">{localError}</p> : null}
        <SubmissionAttachments value={attachments} onChange={setAttachments} disabled={!restored || localSaving} onBusyChange={setUploading} />
        <AttachmentLinks attachments={attachments} courseId={snapshot.course.id} />
        <textarea
          disabled={!restored || localSaving}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          rows={9}
          className={cx(
            s.input,
            css({ mt: "1rem", resize: "vertical", lineHeight: 1.55 }),
          )}
          placeholder="Keep the draft here as the work develops…"
        />
        <div
          className={css({
            mt: "0.7rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.6rem",
          })}
        >
          <label
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.72rem",
            })}
          >
            <input
              type="checkbox"
              checked={share}
              onChange={(event) => setShare(event.target.checked)}
            />
            Share submission with peers
          </label>
          <div className={css({ display: "flex", gap: "0.4rem" })}>
            <button
              type="button"
              className={s.button}
              disabled={!restored || uploading || localSaving}
              onClick={() => void save("draft")}
            >
              Save draft
            </button>
            <button
              type="button"
              className={cx(s.button, s.primaryButton)}
              disabled={
                !restored || uploading || localSaving || notYetOpen || (!answer.trim() && !attachments.length)
              }
              onClick={() => void save("submitted")}
            >
              <Send size={13} /> Submit
            </button>
          </div>
        </div>
        <div className={css({ mt: "0.7rem" })}>
          <CourseReactionBar
            reactions={snapshot.course.reactions}
            members={snapshot.course.members}
            targetKind="assignment"
            targetId={assignment.id}
            viewerAccountId={snapshot.viewer.accountId}
            disabled={!canReact(snapshot)}
            onToggle={(emoji) =>
              onToggleReaction("assignment", assignment.id, emoji)
            }
          />
        </div>
        {submission?.review ? (
          <div
            className={css({
              mt: "1rem",
              borderLeft: "3px solid var(--course-green)",
              bg: "var(--course-wash, #ddebdd)",
              p: "0.75rem",
            })}
          >
            <p className={s.sectionLabel}>
              Teacher review · {submission.review.status}
            </p>
            <p
              className={css({
                mt: "0.3rem",
                whiteSpace: "pre-wrap",
                fontSize: "0.8rem",
              })}
            >
              {submission.review.feedback || "Reviewed without a written note."}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ArtifactWithReactions({
  snapshot,
  artifact,
  onToggleReaction,
  courseWide = false,
}: {
  snapshot: CourseViewerSnapshot;
  artifact: CourseArtifact;
  onToggleReaction: ToggleReaction;
  courseWide?: boolean;
}) {
  return (
    <div>
      <CourseArtifactCard artifact={artifact} courseWide={courseWide} />
      <div className={css({ mt: "0.35rem" })}>
        <CourseReactionBar
          reactions={snapshot.course.reactions}
          members={snapshot.course.members}
          targetKind="artifact"
          targetId={artifact.id}
          viewerAccountId={snapshot.viewer.accountId}
          disabled={!canReact(snapshot)}
          onToggle={(emoji) => onToggleReaction("artifact", artifact.id, emoji)}
        />
      </div>
    </div>
  );
}
