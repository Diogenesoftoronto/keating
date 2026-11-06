import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  RoomJoinDisclosure,
  RoomListItem,
  RoomMember,
  RoomMessage,
  RoomOperation,
  RoomOperationInput,
  RoomPermissions,
  RoomRole,
  RoomViewerSnapshot,
} from "../rooms/contracts";
import { composerBlockedReason, composerOperation, RoomComposer } from "../components/rooms/RoomComposer";
import { clampUses } from "../components/rooms/RoomInvitesPanel";
import { RoomJoinDisclosureList } from "../components/rooms/RoomJoinDisclosure";
import { ModelAccessDisclosure, RoomDraftReview } from "../components/rooms/RoomKeatingPanel";
import { filterRooms } from "../components/rooms/RoomList";
import { RoomParticipationSummary, RoomPeoplePanel, roleChangeConsequence } from "../components/rooms/RoomPeoplePanel";
import { RoomMessageItem } from "../components/rooms/RoomTranscript";
import { canOpenCourseRoom, courseRoomJoinRole } from "../components/rooms/CourseRooms";
import { describeKeatingBehavior, inviteState, keatingRunState, memberActions } from "../components/rooms/room-ui";
import { roomSideTabs } from "../pages/RoomWorkspace";
import { mountRoomUi, settle } from "./helpers/room-ui-mount";

const at = "2026-10-24T12:00:00.000Z";

function member(accountId: string, role: RoomRole, extra: Partial<RoomMember> = {}): RoomMember {
  return { accountId, displayName: accountId[0]!.toUpperCase() + accountId.slice(1), role, joinedAt: at, muted: false, via: "invite", ...extra };
}

const members = [member("hana", "host"), member("tomas", "teacher"), member("priya", "learner"), member("omar", "learner"), member("ivy", "observer")];

function permissionsFor(role: RoomRole, extra: Partial<RoomPermissions> = {}): RoomPermissions {
  const oversee = role === "host" || role === "teacher";
  return {
    canPost: role !== "observer",
    canOversee: oversee,
    canManageRoles: role === "host",
    canInvite: oversee,
    inviteRoles: role === "host" ? ["learner", "teacher", "observer"] : oversee ? ["learner", "observer"] : [],
    canFacilitate: oversee,
    isFacilitator: false,
    ...extra,
  };
}

function message(id: string, seq: number, extra: Partial<RoomMessage> = {}): RoomMessage {
  return { id, seq, kind: "chat", authorAccountId: "priya", authorName: "Priya", authorRole: "learner", body: `message ${id}`, createdAt: at, audience: "room", ...extra };
}

function snapshotFor(viewerId: string, overrides: { messages?: RoomMessage[]; status?: "open" | "ended"; permissions?: Partial<RoomPermissions>; viewer?: Partial<RoomMember> } = {}): RoomViewerSnapshot {
  const viewer = { ...members.find((candidate) => candidate.accountId === viewerId)!, ...overrides.viewer };
  return {
    room: {
      schemaVersion: 1,
      id: "room_1",
      title: "Induction workshop",
      topic: "Induction",
      goal: "",
      hostAccountId: "hana",
      createdAt: at,
      updatedAt: at,
      revision: 3,
      status: overrides.status ?? "open",
      context: { objectives: [] },
      members: members.map((candidate) => (candidate.accountId === viewerId ? viewer : candidate)),
      messages: overrides.messages ?? [],
      nextSeq: 10,
      drafts: [],
      privateForkOffers: [],
      settings: { keating: "active", participation: "facilitate", replyReview: "off", facilitators: "teachers", learnerInvites: false },
      turn: { status: "idle", throughSeq: 0, consideredSeq: 0 },
    },
    viewer,
    permissions: permissionsFor(viewer.role, overrides.permissions),
    hasEarlierMessages: false,
  };
}

const disclosure: RoomJoinDisclosure = {
  memberCount: 4,
  hostName: "Hana",
  teacherNames: ["Tomas"],
  settings: { replyReview: "teacher-approves", participation: "facilitate", facilitators: "teachers" },
};

describe("permission rules mirrored from the server", () => {
  test("teachers moderate learners but only the host manages teachers and roles", () => {
    const teacherView = snapshotFor("tomas");
    expect(memberActions(teacherView, members[2]!)).toEqual({ canMute: true, canRemove: true, roleOptions: [] });
    expect(memberActions(teacherView, members[1]!)).toEqual({ canMute: false, canRemove: false, roleOptions: [] });
    expect(memberActions(teacherView, members[0]!).canRemove).toBe(false);

    const hostView = snapshotFor("hana");
    expect(memberActions(hostView, members[1]!)).toEqual({ canMute: false, canRemove: true, roleOptions: ["learner", "observer"] });
    expect(memberActions(hostView, members[2]!).roleOptions).toEqual(["teacher", "observer"]);
    expect(memberActions(hostView, members[0]!)).toEqual({ canMute: false, canRemove: false, roleOptions: [] });
  });

  test("learners manage nobody and see no oversight tabs", () => {
    const learnerView = snapshotFor("priya");
    for (const target of members) expect(memberActions(learnerView, target)).toEqual({ canMute: false, canRemove: false, roleOptions: [] });
    expect(roomSideTabs(learnerView).map((tab) => tab.id)).toEqual(["keating", "people"]);
    expect(roomSideTabs(snapshotFor("priya", { permissions: { canInvite: true, inviteRoles: ["learner"] } })).map((tab) => tab.id)).toEqual(["keating", "people", "invite"]);
    expect(roomSideTabs(snapshotFor("tomas")).map((tab) => tab.id)).toEqual(["keating", "people", "invite", "settings"]);
  });

  test("composer explains why observers, muted members, and ended rooms cannot post", () => {
    expect(composerBlockedReason(snapshotFor("ivy"))).toContain("Observers read");
    expect(composerBlockedReason(snapshotFor("priya", { viewer: { muted: true }, permissions: { canPost: false } }))).toContain("muted");
    expect(composerBlockedReason(snapshotFor("priya", { status: "ended" }))).toContain("ended");
    expect(composerBlockedReason(snapshotFor("priya"))).toBeNull();
  });

  test("room messages carry the reply target; private guidance never does", () => {
    const target = message("m1", 1);
    expect(composerOperation("room", "  Why n+1?  ", target, "msg_a")).toEqual({ type: "message.post", messageId: "msg_a", body: "Why n+1?", replyToId: "m1" });
    expect(composerOperation("guidance", "Ask Omar first", target, "msg_b")).toEqual({ type: "whisper.post", messageId: "msg_b", body: "Ask Omar first" });
  });

  test("course roles map to room roles, and only course teachers open rooms", () => {
    expect(courseRoomJoinRole("owner")).toBe("teacher");
    expect(courseRoomJoinRole("teacher")).toBe("teacher");
    expect(courseRoomJoinRole("student")).toBe("learner");
    expect(courseRoomJoinRole("peer")).toBe("learner");
    expect(canOpenCourseRoom("teacher")).toBe(true);
    expect(canOpenCourseRoom("student")).toBe(false);
  });

  test("invite states and the uses field clamp only when committed", () => {
    const base = { id: "inv_1", role: "learner" as const, createdBy: "hana", createdAt: at, expiresAt: "2026-10-25T12:00:00.000Z", maxUses: 2, uses: 0 };
    const now = Date.parse(at);
    expect(inviteState(base, now)).toBe("active");
    expect(inviteState({ ...base, uses: 2 }, now)).toBe("used");
    expect(inviteState({ ...base, revokedAt: at }, now)).toBe("revoked");
    expect(inviteState(base, Date.parse("2026-10-26T00:00:00.000Z"))).toBe("expired");
    expect(clampUses("")).toBe(1);
    expect(clampUses("50")).toBe(50);
    expect(clampUses("999")).toBe(200);
  });

  test("library filters by status, hosting, course, and text", () => {
    const base = { ...disclosure, memberCount: 3, updatedAt: at, joined: true };
    const rooms: RoomListItem[] = [
      { ...base, id: "a", title: "Proofs", topic: "induction", role: "host", status: "open" },
      { ...base, id: "b", title: "Essays", topic: "", role: "learner", status: "ended" },
      { ...base, id: "c", title: "Lesson 2", topic: "", role: "teacher", status: "open", courseId: "c1", courseTitle: "Discrete maths" },
    ];
    expect(filterRooms(rooms, "open", "").map((room) => room.id).sort()).toEqual(["a", "c"]);
    expect(filterRooms(rooms, "hosting", "").map((room) => room.id)).toEqual(["a"]);
    expect(filterRooms(rooms, "course", "").map((room) => room.id)).toEqual(["c"]);
    expect(filterRooms(rooms, "ended", "").map((room) => room.id)).toEqual(["b"]);
    expect(filterRooms(rooms, "all", "discrete").map((room) => room.id)).toEqual(["c"]);
  });

  test("role-change confirmation states what access is granted or lost", () => {
    expect(roleChangeConsequence(members[2]!, "teacher")).toContain("private guidance");
    expect(roleChangeConsequence(members[1]!, "learner")).toContain("loses teacher access");
    expect(roleChangeConsequence(members[2]!, "observer")).toContain("only be able to read");
  });
});

describe("disclosures", () => {
  test("joining discloses the shared transcript, oversight, review, and who processes messages", () => {
    const html = renderToStaticMarkup(<RoomJoinDisclosureList disclosure={disclosure} role="learner" />);
    expect(html).toContain("Everything you post");
    expect(html).toContain("Hana (host), Tomas");
    expect(html).toContain("held until a teacher approves");
    expect(html).toContain("chosen AI provider");
    expect(html).toContain("does not share your chats, course progress");
  });

  test("observers are not told they will post", () => {
    const html = renderToStaticMarkup(<RoomJoinDisclosureList disclosure={disclosure} role="observer" />);
    expect(html).toContain("observers cannot post");
    expect(html).not.toContain("Everything you post");
  });

  test("running Keating names the model and says whether private guidance is sent", () => {
    const teacher = renderToStaticMarkup(<ModelAccessDisclosure includesGuidance modelLabel="Claude Opus 5.5" />);
    expect(teacher).toContain("Claude Opus 5.5");
    expect(teacher).toContain("private teacher guidance are sent");
    const learner = renderToStaticMarkup(<ModelAccessDisclosure includesGuidance={false} takeOverFrom="Tomas" />);
    expect(learner).toContain("never sent from your browser");
    expect(learner).toContain("Tomas");
  });

  test("Keating behavior copy follows pause, participation, and review settings", () => {
    expect(describeKeatingBehavior({ keating: "paused", participation: "facilitate", replyReview: "off" })).toContain("paused");
    expect(describeKeatingBehavior({ keating: "active", participation: "on-request", replyReview: "teacher-approves" })).toContain("@Keating");
    expect(describeKeatingBehavior({ keating: "active", participation: "on-request", replyReview: "teacher-approves" })).toContain("approves each reply");
  });

  test("participation is presented as counts, not understanding", () => {
    const messages = [message("m1", 1), message("m2", 2, { body: "is it n+1?" }), message("m3", 3, { authorAccountId: "omar", authorName: "Omar" })];
    const html = renderToStaticMarkup(<RoomParticipationSummary snapshot={snapshotFor("tomas", { messages })} />);
    expect(html).toContain("not understanding");
    expect(html).toContain("Priya");
    expect(html).toContain("Omar");
  });

  test("a stale facilitator does not count as running", () => {
    const snapshot = snapshotFor("tomas");
    snapshot.room.facilitator = { accountId: "tomas", facilitatorId: "facilitator_tab", displayName: "Tomas", modelLabel: "m", claimedAt: at, heartbeatAt: at };
    expect(keatingRunState(snapshot, Date.parse(at) + 1_000)).toMatchObject({ kind: "running", self: true });
    expect(keatingRunState(snapshot, Date.parse(at) + 120_000)).toEqual({ kind: "off" });
  });
});

describe("transcript visibility", () => {
  test("hidden messages are withheld from learners but shown to teachers", () => {
    const hidden = message("m1", 1, { body: "spoiler answer", hidden: { by: "tomas", at } });
    const learner = renderToStaticMarkup(<ol><RoomMessageItem message={hidden} snapshot={snapshotFor("omar")} onReply={() => {}} onHide={() => {}} /></ol>);
    expect(learner).not.toContain("spoiler answer");
    expect(learner).toContain("A teacher hid this message");
    expect(learner).not.toContain("Show to room");
    const teacher = renderToStaticMarkup(<ol><RoomMessageItem message={hidden} snapshot={snapshotFor("tomas")} onReply={() => {}} onHide={() => {}} /></ol>);
    expect(teacher).toContain("spoiler answer");
    expect(teacher).toContain("Show to room");
  });

  test("private guidance is labelled and cannot be replied to", () => {
    const whisper = message("w1", 1, { kind: "whisper", audience: "teachers", authorAccountId: "tomas", authorName: "Tomas", authorRole: "teacher" });
    const html = renderToStaticMarkup(<ol><RoomMessageItem message={whisper} snapshot={snapshotFor("hana")} onReply={() => {}} onHide={() => {}} /></ol>);
    expect(html).toContain("teachers only");
    expect(html).not.toContain("Reply to Tomas");
  });

  test("observers get no reply action", () => {
    const html = renderToStaticMarkup(<ol><RoomMessageItem message={message("m1", 1)} snapshot={snapshotFor("ivy")} onReply={() => {}} onHide={() => {}} /></ol>);
    expect(html).not.toContain("Reply to");
  });
});

const submitEvent = { preventDefault() {} };
const typeInto = (node: { props: Record<string, any> }, value: string) => node.props.onChange({ target: { value } });

describe("composer interactions", () => {
  test("a failed send keeps the text and retries with the same operation id", async () => {
    const ui = mountRoomUi();
    const sent: RoomOperation[] = [];
    let fail = true;
    const onSubmit = async (operation: RoomOperation) => {
      sent.push(operation);
      if (fail) throw new Error("Network went away.");
    };
    const render = () => ui.render(<RoomComposer snapshot={snapshotFor("priya")} replyTo={null} onClearReply={() => {}} onSubmit={onSubmit} onTyping={() => {}} />);
    await render();
    typeInto(ui.all("textarea")[0]!, "Is the base case n = 0?");
    await settle();
    ui.all("form")[0]!.props.onSubmit(submitEvent);
    await settle();
    expect(ui.text()).toContain("Network went away.");
    expect(ui.all("textarea")[0]!.props.value).toBe("Is the base case n = 0?");
    fail = false;
    ui.all("form")[0]!.props.onSubmit(submitEvent);
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.id).toBe(sent[0]!.id);
    expect((sent[1] as { messageId: string }).messageId).toBe((sent[0] as { messageId: string }).messageId);
    expect(ui.all("textarea")[0]!.props.value).toBe("");
    await ui.unmount();
  });

  test("a send whose response was lost is recognised when it lands, so it is not posted twice", async () => {
    const ui = mountRoomUi();
    const sent: RoomOperation[] = [];
    const onSubmit = async (operation: RoomOperation) => {
      sent.push(operation);
      throw new Error("Timed out.");
    };
    const view = (messages: RoomMessage[]) => <RoomComposer snapshot={snapshotFor("priya", { messages })} replyTo={null} onClearReply={() => {}} onSubmit={onSubmit} onTyping={() => {}} />;
    await ui.render(view([]));
    typeInto(ui.all("textarea")[0]!, "My answer");
    await settle();
    ui.all("form")[0]!.props.onSubmit(submitEvent);
    await settle();
    const messageId = (sent[0] as { messageId: string }).messageId;
    await ui.render(view([message(messageId, 1, { body: "My answer" })]));
    expect(ui.all("textarea")[0]!.props.value).toBe("");
    expect(ui.text()).toContain("Sent.");
    expect(ui.text()).not.toContain("Timed out.");
    await ui.unmount();
  });

  test("losing teacher access discards unsent private guidance instead of posting it", async () => {
    const ui = mountRoomUi();
    const sent: RoomOperation[] = [];
    const view = (snapshot: RoomViewerSnapshot) => <RoomComposer snapshot={snapshot} replyTo={null} onClearReply={() => {}} onSubmit={async (operation) => { sent.push(operation); }} onTyping={() => {}} />;
    await ui.render(view(snapshotFor("tomas")));
    ui.button("Private guidance for Keating").props.onClick();
    await settle();
    typeInto(ui.all("textarea")[0]!, "Priya is stuck; hint gently.");
    await settle();
    await ui.render(view(snapshotFor("tomas", { viewer: { role: "learner" }, permissions: permissionsFor("learner") })));
    expect(ui.all("textarea")[0]!.props.value).toBe("");
    expect(ui.text()).toContain("teacher access changed");
    expect(ui.text()).not.toContain("Private guidance for Keating");
    expect(sent).toHaveLength(0);
    await ui.unmount();
  });

  test("guidance discarded because the room ended says so", async () => {
    const ui = mountRoomUi();
    const view = (snapshot: RoomViewerSnapshot) => <RoomComposer snapshot={snapshot} replyTo={null} onClearReply={() => {}} onSubmit={async () => {}} onTyping={() => {}} />;
    await ui.render(view(snapshotFor("tomas")));
    ui.button("Private guidance for Keating").props.onClick();
    await settle();
    typeInto(ui.all("textarea")[0]!, "Wrap up soon.");
    await settle();
    await ui.render(view(snapshotFor("tomas", { status: "ended" })));
    expect(ui.text()).toContain("The room ended, so the unsent private guidance was discarded.");
    await ui.unmount();
  });
});

describe("oversight interactions", () => {
  test("approving an edited draft posts the edited body", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    const draft = { id: "d1", turnId: "t1", body: "The answer is 7.", createdAt: at, facilitatorAccountId: "tomas", model: "m", reason: "review" as const, status: "pending" as const };
    await ui.render(<RoomDraftReview drafts={[draft]} roomOpen mutate={async (operation) => { calls.push(operation); }} />);
    expect(ui.text()).toContain("1 Keating reply waiting for review");
    ui.button("Edit").props.onClick();
    await settle();
    typeInto(ui.all("textarea")[0]!, "What do you get when you add the two parts?");
    await settle();
    ui.button("Post edited reply").props.onClick();
    await settle();
    expect(calls).toEqual([{ type: "draft.resolve", draftId: "d1", action: "approve", body: "What do you get when you add the two parts?" }]);
    await ui.unmount();
  });

  test("rejecting a draft sends no body", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    const draft = { id: "d1", turnId: "t1", body: "x", createdAt: at, facilitatorAccountId: "tomas", model: "m", reason: "review" as const, status: "pending" as const };
    await ui.render(<RoomDraftReview drafts={[draft]} roomOpen mutate={async (operation) => { calls.push(operation); }} />);
    ui.button("Reject").props.onClick();
    await settle();
    expect(calls).toEqual([{ type: "draft.resolve", draftId: "d1", action: "reject" }]);
    await ui.unmount();
  });

  test("choosing a role only stages it; nothing changes until it is confirmed", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    await ui.render(<RoomPeoplePanel snapshot={snapshotFor("hana")} presentAccountIds={["hana", "priya"]} mutate={async (operation) => { calls.push(operation); }} onLeft={() => {}} />);
    // Priya is the only member the host can promote to teacher.
    const priyaIndex = ui.all("select").findIndex((node) =>
      node.children.some((option) => option.props.value === "teacher"));
    ui.all("select")[priyaIndex]!.props.onChange({ target: { value: "teacher" } });
    await settle();
    expect(calls).toHaveLength(0);
    expect(ui.text()).toContain("will see private guidance");
    ui.button("Make a teacher").props.onClick();
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "member.role", role: "teacher" });
    await ui.unmount();
  });

  test("hosts cannot leave; members confirm before leaving", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    let left = false;
    await ui.render(<RoomPeoplePanel snapshot={snapshotFor("hana")} presentAccountIds={[]} mutate={async (operation) => { calls.push(operation); }} onLeft={() => { left = true; }} />);
    expect(ui.text()).toContain("As host you cannot leave");
    await ui.render(<RoomPeoplePanel snapshot={snapshotFor("priya")} presentAccountIds={[]} mutate={async (operation) => { calls.push(operation); }} onLeft={() => { left = true; }} />);
    expect(ui.text()).not.toContain("Change role");
    expect(ui.text()).not.toContain("Mute");
    ui.button("Leave room…").props.onClick();
    await settle();
    expect(calls).toHaveLength(0);
    ui.button("Leave room").props.onClick();
    await settle();
    expect(calls).toEqual([{ type: "member.leave" }]);
    expect(left).toBe(true);
    await ui.unmount();
  });
});
