import { Cpu, Eye, MessagesSquare, ShieldCheck } from "lucide-react";
import { css } from "../../../styled-system/css";
import type { RoomJoinDisclosure, RoomRole } from "../../rooms/contracts";

/** What someone agrees to by joining, stated before they accept. */
export function RoomJoinDisclosureList({ disclosure, role }: { disclosure: RoomJoinDisclosure; role: RoomRole }) {
  const overseers = [`${disclosure.hostName} (host)`, ...disclosure.teacherNames].join(", ");
  const row = css({ display: "grid", gridTemplateColumns: "1.25rem minmax(0, 1fr)", gap: "0.55rem" });
  const icon = css({ mt: "0.15rem" });
  const people = `${disclosure.memberCount} ${disclosure.memberCount === 1 ? "member" : "members"}`;
  return (
    <ul className={css({ display: "grid", gap: "0.75rem", fontSize: "0.86rem", lineHeight: 1.55 })}>
      <li className={row}>
        <MessagesSquare size={17} aria-hidden="true" className={icon} />
        <span>
          <strong>One shared transcript.</strong>{" "}
          {role === "observer"
            ? `You can read everything posted by the ${people}, but observers cannot post.`
            : `Everything you post, and every reply from Keating, is visible under your display name to all ${people} and anyone who joins later.`}
          {" "}Members can export the transcript.
        </span>
      </li>
      <li className={row}>
        <Eye size={17} aria-hidden="true" className={icon} />
        <span>
          <strong>Teacher oversight.</strong> {overseers} can see participation counts, mute or remove members, and guide
          Keating privately.
          {disclosure.settings.replyReview === "teacher-approves"
            ? " Keating’s replies are held until a teacher approves them."
            : " Keating’s replies post directly."}
        </span>
      </li>
      <li className={row}>
        <Cpu size={17} aria-hidden="true" className={icon} />
        <span>
          <strong>Who processes messages.</strong> Keating runs in one member’s browser
          {disclosure.settings.facilitators === "anyone" ? " (a teacher’s or a learner’s)" : " (a teacher’s)"}, using that
          person’s chosen AI provider. The room’s messages are sent to that provider so Keating can reply.
        </span>
      </li>
      <li className={row}>
        <ShieldCheck size={17} aria-hidden="true" className={icon} />
        <span>
          <strong>Your private work stays private.</strong> Joining does not share your chats, course progress, or
          learning profile. Only what you write in this room is shared.
        </span>
      </li>
    </ul>
  );
}

