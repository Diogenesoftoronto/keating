import { expect, test } from "bun:test";
import type { Peer } from "crossws";
import { useStorage } from "nitro/storage";
import { listCoursesForAccount } from "../../server/utils/course-repository";
import { connectCoursePeer, disconnectCoursePeer } from "../../server/utils/course-realtime";
import { courseSchema } from "../courses/contracts";

test("course list resumes each viewer's outline and counts only visible, unreviewed submissions", async () => {
  const store = useStorage("keating:courses");
  const id = `course_${crypto.randomUUID()}`;
  const owner = `owner_${id}`;
  const learner = `student_${id}`;
  const now = new Date().toISOString();
  const index = (account: string) => "account:" + new Bun.CryptoHasher("sha256").update(account).digest("hex");
  const key = `course:${id}`;
  const course = courseSchema.parse({
    schemaVersion: 1, id, title: "Proofs", ownerAccountId: owner, createdAt: now, updatedAt: now, revision: 0, settings: {},
    modules: [
      { id: "first", title: "Basics", lessons: [{ id: "intro", title: "Introduction" }] },
      { id: "second", title: "Methods", lessons: [{ id: "step", title: "Induction" }, { id: "end", title: "Conclusion" }] },
    ],
    members: [
      { accountId: owner, displayName: "Sam", role: "owner", joinedAt: now, progress: { completedLessonIds: ["end", "intro"], lastActiveAt: now } },
      { accountId: learner, displayName: "Jo", role: "student", joinedAt: now, progress: { lastActiveAt: now } },
    ],
  });
  const answer = { id: "answer", accountId: owner, answer: "Proof", version: 1, updatedAt: now, sharedWithPeers: false };
  const exercise = { ...answer, exerciseId: "exercise", lessonId: "intro" };
  course.submissions.push(exercise, { ...exercise, id: "private", accountId: learner }, {
    ...exercise, id: "reviewed", review: { status: "reviewed", reviewerAccountId: owner, updatedAt: now, feedback: "" },
  });
  course.assignmentSubmissions.push({ ...answer, assignmentId: "assignment", status: "submitted" },
    { ...answer, id: "draft", assignmentId: "assignment", status: "draft" });
  const save = () => store.setItem(key, { course });
  const peers = [owner, owner, learner, "former-member"].map((accountId, i) =>
    ({ accountId, peer: { id: String(i), send() {} } as unknown as Peer }));
  try {
    await save();
    for (const account of [owner, learner]) await store.setItem(index(account), [id]);
    const [item] = await listCoursesForAccount(owner);
    expect(item).toMatchObject({ pendingSubmissions: 2, nextLesson: { id: "step", title: "Induction", moduleTitle: "Methods", position: 2, total: 3 } });
    expect(item).not.toHaveProperty("presentCount");
    for (const { accountId, peer } of peers) connectCoursePeer(id, accountId, peer);
    const [student] = await listCoursesForAccount(learner);
    expect(student).toMatchObject({ presentCount: 2, nextLesson: { id: "intro", position: 1 } });
    expect(student).not.toHaveProperty("pendingSubmissions");
    course.members[0]!.progress.completedLessonIds.push("step");
    await save();
    expect((await listCoursesForAccount(owner))[0]).not.toHaveProperty("nextLesson");
    course.modules = [];
    await save();
    expect((await listCoursesForAccount(learner))[0]).not.toHaveProperty("nextLesson");
  } finally {
    for (const { peer } of peers) disconnectCoursePeer(id, peer);
    for (const k of [key, index(owner), index(learner)]) await store.removeItem(k);
  }
});
