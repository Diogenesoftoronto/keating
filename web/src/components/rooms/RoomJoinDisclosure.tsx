import { DefinitionList } from "../../design-system/kit";
import type { RoomJoinDisclosure, RoomRole } from "../../rooms/contracts";

/** What someone agrees to by joining, stated before they accept. */
export function RoomJoinDisclosureList({ disclosure, role }: { disclosure: RoomJoinDisclosure; role: RoomRole }) {
  const overseers = [`${disclosure.hostName} (host)`, ...disclosure.teacherNames].join(", ");
  const people = `${disclosure.memberCount} ${disclosure.memberCount === 1 ? "member" : "members"}`;
  return (
    <DefinitionList items={[
      {
        term: "One shared transcript.",
        detail: <>{role === "observer"
          ? `You can read everything posted by the ${people}, but observers cannot post.`
          : `Everything you post, and every reply from Keating, is visible under your display name to all ${people} and anyone who joins later.`}
          {" "}Members can export the transcript.</>,
      },
      {
        term: "Teacher oversight.",
        detail: <>{overseers} can see participation counts, mute or remove members, and guide Keating privately.
          {disclosure.settings.replyReview === "teacher-approves"
            ? " Keating’s replies are held until a teacher approves them." : " Keating’s replies post directly."}</>,
      },
      {
        term: "Who processes messages.",
        detail: <>Keating runs in one member’s browser
          {disclosure.settings.facilitators === "anyone" ? " (a teacher’s or a learner’s)" : " (a teacher’s)"}, using that person’s chosen AI provider.
          The room’s messages are sent to that provider so Keating can reply.</>,
      },
      {
        term: "Your private work stays private.",
        detail: "Joining does not share your chats, course progress, or learning profile. Only what you write in this room is shared.",
      },
    ]} />
  );
}
