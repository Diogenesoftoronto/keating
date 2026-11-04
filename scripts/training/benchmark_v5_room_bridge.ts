/** Teaching v5 group track: build one Keating study-room turn with the production room code.
 *
 * Reads JSON on stdin: {persona?, title, topic, goal, members:[{name, role}], messages:[{name, role, body, kind?}],
 * consideredSeq} and prints {systemPrompt, user, tools} built by web/src/rooms/facilitation.ts
 * `buildFacilitatorContext`. With {decode: assistantMessage} it instead prints `parseFacilitatorDecision`.
 * No network, no model: the Python adapter sends the context to the tutor model and returns its reply here.
 */
import { buildFacilitatorContext, parseFacilitatorDecision } from "../../web/src/rooms/facilitation.ts";
import { DEFAULT_TEACHER_PERSONA } from "../../web/src/keating/persona.ts";

const input = JSON.parse(await Bun.stdin.text());
if (input.decode) {
  console.log(JSON.stringify(parseFacilitatorDecision(input.decode)));
} else {
  const t0 = Date.parse("2026-10-24T12:00:00Z");
  const iso = (i: number) => new Date(t0 + i * 20_000).toISOString();
  const account = (name: string) => `acct-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const members = input.members.map((m: any, i: number) => ({
    accountId: account(m.name), displayName: m.name, role: m.role, joinedAt: iso(0), muted: false, via: "invite" }));
  const messages = input.messages.map((m: any, i: number) => ({
    id: `msg-${i + 1}`, seq: i + 1, kind: m.kind ?? (m.role === "keating" ? "keating" : "chat"),
    authorAccountId: m.role === "keating" ? undefined : account(m.name), authorName: m.name, authorRole: m.role,
    body: m.body, createdAt: iso(i + 1), audience: "room" }));
  const throughSeq = messages.length;
  const room: any = {
    schemaVersion: 1, id: "bench-room", title: input.title, topic: input.topic ?? "", goal: input.goal ?? "",
    hostAccountId: members.find((m: any) => m.role === "host")?.accountId ?? members[0].accountId,
    createdAt: iso(0), updatedAt: iso(throughSeq), revision: throughSeq, status: "open", context: { objectives: [] },
    members, messages, nextSeq: throughSeq + 1, drafts: [],
    settings: { keating: "active", participation: "facilitate", replyReview: "off", facilitators: "teachers", learnerInvites: false },
    turn: { status: "thinking", throughSeq, consideredSeq: input.consideredSeq ?? 0 },
  };
  const host = members.find((m: any) => m.role === "host") ?? members[0];
  const snapshot: any = { room, viewer: host, hasEarlierMessages: false,
    permissions: { canPost: true, canOversee: true, canManageRoles: true, canInvite: true, inviteRoles: [], canFacilitate: true, isFacilitator: true } };
  const ctx = buildFacilitatorContext({ snapshot, persona: input.persona ?? DEFAULT_TEACHER_PERSONA, throughSeq,
    trigger: input.trigger ?? "conversation", presentAccountIds: members.map((m: any) => m.accountId), now: t0 + (throughSeq + 1) * 20_000 });
  const user = ctx.messages.map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
  console.log(JSON.stringify({ systemPrompt: ctx.systemPrompt, user, tools: ctx.tools }));
}
