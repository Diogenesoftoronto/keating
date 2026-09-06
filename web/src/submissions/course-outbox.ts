import type { UiSubmissionAttachment } from "@keating/learner-contracts";
import type { CourseOperation } from "../courses/contracts";
import { applyCourseOperation, getCourse } from "../courses/client";
import { localList, localRead, localWrite, type LocalFile } from "./local-store";

type SubmissionOperation = Extract<CourseOperation, { type: "assignment.submission.save" }>;
export interface QueuedSubmission {
  key: string;
  accountId: string;
  groupKey: string;
  queuedAt: number;
  predecessor?: string;
  operation: SubmissionOperation;
  state: "pending" | "delivered";
  error?: string;
  remoteOperation?: SubmissionOperation;
  deliveredVersion?: number;
}
export const submissionKey = (accountId: string, courseId: string, assignmentId: string) => JSON.stringify([accountId, courseId, assignmentId]);
const changed = () => window.dispatchEvent(new Event("keating:submission-saved"));
let serial = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = serial.then(() => navigator.locks ? navigator.locks.request("keating-submissions-sync", work) : work());
  serial = result.then(() => {}, () => {});
  return result;
}
export async function latestCourseSubmission(groupKey: string) {
  const entries = (await localList<QueuedSubmission>("outbox")).filter((entry) => entry.groupKey === groupKey);
  // A predecessor chain also orders revisions saved in the same millisecond.
  const parents = new Set(entries.map((entry) => entry.predecessor));
  return entries.find((entry) => !parents.has(entry.key));
}
let queueSerial = Promise.resolve();
export async function queueCourseSubmission(accountId: string, operation: SubmissionOperation) {
  const save = async () => {
    const groupKey = submissionKey(accountId, operation.courseId, operation.assignmentId);
    const previous = await latestCourseSubmission(groupKey);
    const entry: QueuedSubmission = {
      key: operation.id, groupKey, queuedAt: Date.now(), predecessor: previous?.key,
      accountId, state: "pending", operation: {
        ...operation,
        submissionId: previous?.operation.submissionId ?? operation.submissionId,
        baseVersion: Math.max(previous?.deliveredVersion ?? 0, operation.baseVersion),
      },
    };
    await localWrite("outbox", entry.key, entry);
    changed();
    return entry;
  };
  // Local saving never waits for network delivery; each revision is immutable.
  const result = queueSerial.then(() => navigator.locks ? navigator.locks.request("keating-submissions-queue", save) : save());
  queueSerial = result.then(() => {}, () => {});
  return result;
}
async function remoteAttachment(accountId: string, metadata: UiSubmissionAttachment) {
  const key = JSON.stringify([accountId, metadata.id]);
  const uploaded = await localRead<UiSubmissionAttachment>("uploads", key);
  if (uploaded) return uploaded;
  const file = await localRead<LocalFile>("files", metadata.id);
  if (!file) return metadata; // Existing server attachment loaded from a course.
  const body = new FormData();
  body.set("file", file.blob, metadata.name);
  const response = await fetch("/api/submission-attachments", { method: "POST", body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.statusMessage ?? "Attachment upload failed.");
  const remote = result as UiSubmissionAttachment;
  await localWrite("uploads", key, remote);
  await localWrite("uploads", JSON.stringify([accountId, remote.id]), remote);
  await localWrite("files", remote.id, { metadata: remote, blob: file.blob });
  return remote;
}
export async function syncCourseSubmissions() {
  if (!navigator.onLine) return;
  await exclusive(async () => {
    const entries = (await localList<QueuedSubmission>("outbox")).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const entry of entries) {
      if (entry.state === "delivered") continue;
      try {
        if (entry.predecessor) {
          const prior = await localRead<QueuedSubmission>("outbox", entry.predecessor);
          if (prior?.state !== "delivered") {
            entry.error = prior?.error ?? "Waiting for an earlier saved revision to reach the course.";
            await localWrite("outbox", entry.key, entry);
            changed();
            continue;
          }
          entry.operation.baseVersion = Math.max(prior.deliveredVersion ?? 0, entry.operation.baseVersion);
        }
        const snapshot = await getCourse(entry.operation.courseId);
        // Never upload queued private work into a different signed-in account.
        if (snapshot.viewer.accountId !== entry.accountId) continue;
        if (!entry.remoteOperation) {
          const current = snapshot.course.assignmentSubmissions.find((submission) => submission.assignmentId === entry.operation.assignmentId && submission.accountId === entry.accountId);
          if ((current?.version ?? 0) !== entry.operation.baseVersion) throw new Error("The course copy changed on another device. Your work remains saved here; review the course copy before retrying.");
          const attachments: UiSubmissionAttachment[] = [];
          for (const attachment of entry.operation.attachments ?? []) attachments.push(await remoteAttachment(entry.accountId, attachment));
          entry.remoteOperation = { ...entry.operation, attachments, baseRevision: snapshot.course.revision };
          await localWrite("outbox", entry.key, entry);
        }
        const result = await applyCourseOperation(entry.remoteOperation);
        entry.state = "delivered";
        entry.error = undefined;
        entry.deliveredVersion = result.snapshot.course.assignmentSubmissions.find((submission) => submission.id === entry.operation.submissionId)?.version;
      } catch (cause) {
        entry.error = cause instanceof Error ? cause.message : "Delivery failed. Your work is saved on this device.";
        // A definite revision rejection has no side effect, so allow rebuilding
        // against a fresh course revision. Network failures retain the exact op.
        if (cause && typeof cause === "object" && "status" in cause && cause.status === 409) entry.remoteOperation = undefined;
      }
      await localWrite("outbox", entry.key, entry);
      changed();
    }
  });
}
export function startSubmissionSync() {
  const sync = () => { void syncCourseSubmissions().catch(() => {}); };
  window.addEventListener("online", sync);
  const interval = window.setInterval(sync, 30000);
  sync();
  return () => { window.removeEventListener("online", sync); clearInterval(interval); };
}
