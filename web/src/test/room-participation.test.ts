import { describe, expect, test } from "bun:test";
import { summarizeParticipation } from "../rooms/participation";
import type { RoomMember, RoomMessage } from "../rooms/contracts";

const T0 = Date.parse("2026-10-24T12:00:00.000Z");
const member = (accountId: string, role: RoomMember["role"] = "learner", displayName = accountId): RoomMember => ({ accountId, displayName, role, joinedAt: new Date(T0).toISOString(), muted: false, via: "invite" });
function message(seq: number, author: string, overrides: Partial<RoomMessage> = {}): RoomMessage {
  return { id: `msg_${seq}`, seq, kind: "chat", authorAccountId: author, authorName: author, authorRole: "learner", body: "Why are these equal?", audience: "room", createdAt: new Date(T0 + seq * 1000).toISOString(), ...overrides };
}

describe("room participation counts", () => {
  test("counts attributable public learner/teacher contributions without inferring understanding", () => {
    const members = [member("maya"), member("sam"), member("host", "host"), member("obs", "observer")];
    const summary = summarizeParticipation(members, [
      message(1, "maya"), message(2, "sam", { body: " one   two \nthree " }),
      message(3, "host", { authorRole: "host" }),
      message(4, "host", { kind: "whisper", authorRole: "host", audience: "teachers" }),
      message(5, "maya", { hidden: { by: "host", at: new Date(T0).toISOString() } }),
      message(6, "Keating", { kind: "keating", authorRole: "keating", addressedTo: ["maya"] }),
      message(7, "obs", { authorRole: "observer" }), message(8, "removed"),
    ], T0 + 100_000);
    expect(summary).toMatchObject({ learnerMessages: 2, teacherMessages: 1, keatingMessages: 1 });
    expect(summary.learners).toHaveLength(2);
    expect(summary.learners.find((learner) => learner.accountId === "maya")).toMatchObject({ messages: 1, words: 4, questions: 1, addressedByKeating: 1, share: 0.5 });
    expect(summary.learners.find((learner) => learner.accountId === "sam")).toMatchObject({ messages: 1, words: 3, questions: 0 });
    expect(summary.balance).toBeUndefined();
  });

  test("balanced participation has normalized entropy 1, and silence remains explicit", () => {
    const balanced = summarizeParticipation([member("a"), member("b")], Array.from({ length: 6 }, (_, i) => message(i + 1, i % 2 ? "a" : "b")), T0 + 100_000);
    expect(balanced.balance).toBeCloseTo(1);
    expect(balanced.learners.map((learner) => learner.status)).toEqual(["balanced", "balanced"]);
    const dominant = summarizeParticipation([member("a"), member("b")], Array.from({ length: 6 }, (_, i) => message(i + 1, "a")), T0 + 100_000);
    expect(dominant.balance).toBe(0);
    expect(dominant.learners[0]?.status).toBe("dominant");
    expect(dominant.learners[1]).toMatchObject({ status: "silent", messages: 0, share: 0 });
  });

  test("an idle room alone does not label someone quiet; ongoing conversation can", () => {
    const members = [member("a"), member("b")];
    const one = message(1, "a");
    expect(summarizeParticipation(members, [one], T0 + 3600_000).learners.find((learner) => learner.accountId === "a")?.status).toBe("balanced");
    const later = message(2, "b", { createdAt: new Date(T0 + 12 * 60_000).toISOString() });
    expect(summarizeParticipation(members, [one, later], T0 + 3600_000).learners.find((learner) => learner.accountId === "a")?.status).toBe("quiet");
  });

  test("out-of-order input preserves the actual last activity time", () => {
    const recent = message(2, "a", { createdAt: new Date(T0 + 20 * 60_000).toISOString() });
    const old = message(1, "a");
    const summary = summarizeParticipation([member("a"), member("b")], [recent, old], T0 + 3600_000);
    expect(summary.learners[0]).toMatchObject({ lastSpokeAt: recent.createdAt, status: "balanced" });
  });

  test("ambiguous display names are not attributed to an arbitrary learner; duplicate names count one message", () => {
    const members = [member("a", "learner", "Maya"), member("b", "learner", "MAYA"), member("c", "learner", "Sam")];
    const summary = summarizeParticipation(members, [message(1, "Keating", { kind: "keating", addressedTo: ["Maya", "Sam", "sam"] })]);
    expect(summary.learners.find((learner) => learner.accountId === "a")?.addressedByKeating).toBe(0);
    expect(summary.learners.find((learner) => learner.accountId === "b")?.addressedByKeating).toBe(0);
    expect(summary.learners.find((learner) => learner.accountId === "c")?.addressedByKeating).toBe(1);
  });
});
