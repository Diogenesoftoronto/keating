import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import { recordCourseAccountAdoptions } from "../submissions/account-adoption";
import { adoptQueuedSubmission, latestCourseSubmission, submissionKey, type QueuedSubmission } from "../submissions/course-outbox";
import { localWrite } from "../submissions/local-store";

test("server-confirmed adoption exposes queued work under its DID without changing exact mutation retries", async () => {
  const source = `local_${"3".repeat(64)}`;
  const did = "did:plc:queued-learner";
  const entry: QueuedSubmission = {
    key: "op_queued_one", accountId: source, groupKey: submissionKey(source, "course_queue", "assignment_queue"), queuedAt: 1,
    state: "pending", predecessor: "op_before",
    operation: { id: "op_queued_one", type: "assignment.submission.save", courseId: "course_queue", assignmentId: "assignment_queue",
      submissionId: "submission_queue", baseVersion: 2, baseRevision: 3, answer: "My private answer", status: "submitted", sharedWithPeers: false },
  };
  entry.remoteOperation = { ...entry.operation, baseRevision: 9, attachments: [{ id: "attachment_remote", name: "notes.txt", mimeType: "text/plain", sizeBytes: 8 }] };
  await localWrite("outbox", entry.key, entry);
  expect(await latestCourseSubmission(submissionKey(did, "course_queue", "assignment_queue"))).toBeUndefined();
  await recordCourseAccountAdoptions([source], did);
  const adopted = await latestCourseSubmission(submissionKey(did, "course_queue", "assignment_queue"));
  expect(adopted?.accountId).toBe(did);
  expect(adopted?.adoptedFrom).toBe(source);
  expect(adopted?.remoteOperation).toEqual(entry.remoteOperation);
  expect(adopted?.operation).toEqual(entry.operation);
  expect(adopted?.predecessor).toBe(entry.predecessor);
  expect(adopted?.key).toBe(entry.key);
  expect(await adoptQueuedSubmission(adopted!)).toEqual(adopted!);
  await expect(recordCourseAccountAdoptions([source], "did:plc:someone-else")).rejects.toThrow("already linked");
  expect(await latestCourseSubmission(submissionKey("did:plc:someone-else", "course_queue", "assignment_queue"))).toBeUndefined();
});

test("a login without a matching server adoption receipt does not claim another local draft", async () => {
  const source = `local_${"4".repeat(64)}`;
  await recordCourseAccountAdoptions([`local_${"5".repeat(64)}`], "did:plc:different");
  const value = { accountId: source, groupKey: "original", operation: { courseId: "course_one", assignmentId: "assignment_one" } } as QueuedSubmission;
  expect(await adoptQueuedSubmission(value)).toBe(value);
});
