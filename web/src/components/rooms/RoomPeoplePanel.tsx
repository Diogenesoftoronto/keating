import { useMemo, useState } from "react";
import { css } from "../../../styled-system/css";
import { courseAvatarColor } from "../courses/course-ui";
import type { RoomInviteRole, RoomMember, RoomOperationInput, RoomViewerSnapshot } from "../../rooms/contracts";
import { summarizeParticipation, type ParticipationStatus } from "../../rooms/participation";
import { ROLE_LABELS, articleRole, errorMessage, memberActions, memberName, roomStyles as s } from "./room-ui";

type Mutate = (operation: RoomOperationInput) => Promise<unknown>;

export const PARTICIPATION_LABELS: Record<ParticipationStatus, string> = {
  silent: "Has not posted",
  quiet: "Quiet lately",
  balanced: "Taking part",
  dominant: "Most of the talk",
};

/** What a role change does, said before it is applied. */
export function roleChangeConsequence(member: Pick<RoomMember, "displayName" | "role">, role: RoomInviteRole): string {
  const name = member.displayName;
  if (role === "teacher") {
    return `${name} will see private guidance and held replies, and can moderate members, change settings, and run Keating.`;
  }
  if (member.role === "teacher") {
    return role === "observer"
      ? `${name} loses teacher access and can no longer post.`
      : `${name} loses teacher access, private guidance, and held replies.`;
  }
  return role === "observer" ? `${name} will only be able to read the conversation.` : `${name} will be able to post again.`;
}

function MemberRow({
  member,
  snapshot,
  online,
  mutate,
}: {
  member: RoomMember;
  snapshot: RoomViewerSnapshot;
  online: boolean;
  mutate: Mutate;
}) {
  const actions = memberActions(snapshot, member);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [stagedRole, setStagedRole] = useState<RoomInviteRole | "">("");
  const [error, setError] = useState("");
  const act = async (operation: RoomOperationInput) => {
    setBusy(true);
    setError("");
    try {
      await mutate(operation);
    } catch (cause) {
      setError(errorMessage(cause, "That change was not saved."));
    } finally {
      setBusy(false);
      setConfirmRemove(false);
      setStagedRole("");
    }
  };
  const manageable = actions.canMute || actions.canRemove || actions.roleOptions.length > 0;
  return (
    <li className={css({ display: "grid", gap: "0.35rem", py: "0.45rem", borderBottom: "1px solid color-mix(in srgb, var(--ink) 18%, transparent)", _last: { borderBottom: 0 } })}>
      <div className={css({ display: "flex", alignItems: "center", gap: "0.55rem", fontSize: "0.8rem" })}>
        <span aria-hidden="true" className={css({ position: "relative", display: "grid", h: "1.75rem", w: "1.75rem", flexShrink: 0, placeItems: "center", borderRadius: "50%", fontWeight: 800, color: "white" })} style={{ background: courseAvatarColor(member.role === "host" || member.role === "teacher" ? "teacher" : "student") }}>
          {member.displayName.charAt(0).toUpperCase()}
          <span className={css({ position: "absolute", right: "-1px", bottom: "-1px", h: "0.55rem", w: "0.55rem", border: "1px solid var(--paper-deep, #e9e2d2)", borderRadius: "50%" })} style={{ background: online ? "var(--phosphor, #4be388)" : "#9ba19a" }} />
        </span>
        <span className={css({ minW: 0, flex: 1 })}>
          <strong className={css({ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{memberName(member, snapshot.viewer.accountId)}</strong>
          <span className={css({ fontSize: "0.68rem", color: "var(--ink-soft)" })}>
            {ROLE_LABELS[member.role]} · {online ? "here now" : "away"}{member.muted ? " · muted" : ""}
          </span>
        </span>
      </div>
      {manageable ? (
        <div className={css({ display: "flex", flexWrap: "wrap", gap: "0.3rem", pl: "2.3rem" })}>
          {actions.roleOptions.length ? (
            <label className={css({ display: "inline-flex", alignItems: "center" })}>
              <span className={css({ srOnly: true })}>New role for {member.displayName}</span>
              <select
                className={s.button}
                value={stagedRole}
                disabled={busy}
                onChange={(event) => setStagedRole(event.target.value as RoomInviteRole | "")}
              >
                <option value="">Change role…</option>
                {actions.roleOptions.map((role) => <option key={role} value={role}>Make {articleRole(role)}</option>)}
              </select>
            </label>
          ) : null}
          {actions.canMute ? (
            <button type="button" className={s.quiet} disabled={busy} onClick={() => void act({ type: "member.mute", accountId: member.accountId, muted: !member.muted })}>
              {member.muted ? "Unmute" : "Mute"}
            </button>
          ) : null}
          {actions.canRemove ? (
            confirmRemove ? (
              <span className={css({ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem" })}>
                Remove {member.displayName}? They cannot rejoin with an invite.
                <button type="button" className={s.danger} disabled={busy} onClick={() => void act({ type: "member.remove", accountId: member.accountId })}>Remove</button>
                <button type="button" className={s.quiet} onClick={() => setConfirmRemove(false)}>Keep</button>
              </span>
            ) : (
              <button type="button" className={s.quietDanger} disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
            )
          ) : null}
        </div>
      ) : null}
      {stagedRole ? (
        <div role="group" aria-label={`Confirm role change for ${member.displayName}`} className={css({ display: "grid", gap: "0.35rem", ml: "2.3rem", fontSize: "0.72rem" })}>
          <p>{roleChangeConsequence(member, stagedRole)}</p>
          <div className={css({ display: "flex", gap: "0.3rem" })}>
            <button type="button" className={s.primary} disabled={busy} onClick={() => void act({ type: "member.role", accountId: member.accountId, role: stagedRole })}>
              Make {articleRole(stagedRole)}
            </button>
            <button type="button" className={s.quiet} disabled={busy} onClick={() => setStagedRole("")}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className={s.error}>{error}</p> : null}
    </li>
  );
}

export function RoomParticipationSummary({ snapshot }: { snapshot: RoomViewerSnapshot }) {
  const { room } = snapshot;
  const summary = useMemo(() => summarizeParticipation(room.members, room.messages), [room.members, room.messages]);
  return (
    <section aria-labelledby="room-participation-heading" className={s.section}>
      <h2 id="room-participation-heading" className={s.heading}>Participation</h2>
      <p className={s.help}>
        Counts of who has spoken in the loaded transcript. They measure taking part, not understanding.
        Keating uses them to invite quieter learners in.
      </p>
      {summary.learners.length === 0 ? (
        <p className={s.help}>No learners have joined yet.</p>
      ) : (
        <table className={css({ mt: "0.5rem", w: "100%", borderCollapse: "collapse", fontSize: "0.74rem", "& th, & td": { textAlign: "left", py: "0.3rem", pr: "0.4rem", borderBottom: "1px solid color-mix(in srgb, var(--ink) 15%, transparent)" }, "& th": { fontWeight: 750 } })}>
          <thead>
            <tr><th scope="col">Learner</th><th scope="col">Messages</th><th scope="col">Questions</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>
            {summary.learners.map((learner) => (
              <tr key={learner.accountId}>
                <th scope="row" className={css({ fontWeight: 600 })}>{learner.displayName}</th>
                <td>{learner.messages} <span className={css({ color: "var(--ink-soft)" })}>({Math.round(learner.share * 100)}%)</span></td>
                <td>{learner.questions}</td>
                <td>{PARTICIPATION_LABELS[learner.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={s.help}>
        {summary.learnerMessages} learner · {summary.teacherMessages} teacher · {summary.keatingMessages} Keating messages
      </p>
    </section>
  );
}

function SelfControls({ snapshot, mutate, onLeft }: { snapshot: RoomViewerSnapshot; mutate: Mutate; onLeft: () => void }) {
  const { viewer } = snapshot;
  const [name, setName] = useState(viewer.displayName);
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const rename = async () => {
    const next = name.trim();
    if (!next || next === viewer.displayName) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await mutate({ type: "member.rename", displayName: next });
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause, "Your name was not changed."));
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    setBusy(true);
    setError("");
    try {
      await mutate({ type: "member.leave" });
      onLeft();
    } catch (cause) {
      setError(errorMessage(cause, "You could not leave the room."));
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="room-self-heading" className={s.section}>
      <h2 id="room-self-heading" className={s.heading}>You</h2>
      <form className={css({ mt: "0.45rem", display: "flex", gap: "0.35rem" })} onSubmit={(event) => { event.preventDefault(); void rename(); }}>
        <label className={css({ flex: 1 })}>
          <span className={css({ srOnly: true })}>Your name in this room</span>
          <input className={s.input} value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setSaved(false); }} />
        </label>
        <button type="submit" className={s.button} disabled={busy || !name.trim() || name.trim() === viewer.displayName}>Rename</button>
      </form>
      {saved ? <p role="status" className={s.help}>Name updated.</p> : null}
      {viewer.role !== "host" ? (
        confirmLeave ? (
          <div className={css({ mt: "0.6rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem" })}>
            Leave this room? You will need a new invitation to return.
            <button type="button" className={s.danger} disabled={busy} onClick={() => void leave()}>Leave room</button>
            <button type="button" className={s.quiet} onClick={() => setConfirmLeave(false)}>Stay</button>
          </div>
        ) : (
          <button type="button" className={`${s.quiet} ${css({ mt: "0.5rem" })}`} onClick={() => setConfirmLeave(true)}>Leave room…</button>
        )
      ) : (
        <p className={s.help}>As host you cannot leave. End the room from Settings when you are done.</p>
      )}
      {error ? <p role="alert" className={`${s.error} ${css({ mt: "0.5rem" })}`}>{error}</p> : null}
    </section>
  );
}

const ROLE_ORDER: Record<RoomMember["role"], number> = { host: 0, teacher: 1, learner: 2, observer: 3 };

export function RoomPeoplePanel({
  snapshot,
  presentAccountIds,
  mutate,
  onLeft,
}: {
  snapshot: RoomViewerSnapshot;
  presentAccountIds: readonly string[];
  mutate: Mutate;
  onLeft: () => void;
}) {
  const present = new Set(presentAccountIds);
  const members = [...snapshot.room.members].sort((left, right) =>
    Number(present.has(right.accountId)) - Number(present.has(left.accountId))
    || ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
    || left.displayName.localeCompare(right.displayName));
  return (
    <>
      <section aria-labelledby="room-people-heading" className={s.section}>
        <h2 id="room-people-heading" className={s.heading}>
          People <span className={css({ fontFamily: "var(--mono-display)", fontSize: "0.72rem", color: "var(--ink-soft)" })}>{present.size} here · {members.length} total</span>
        </h2>
        <ul className={css({ mt: "0.4rem" })}>
          {members.map((member) => (
            <MemberRow key={member.accountId} member={member} snapshot={snapshot} online={present.has(member.accountId)} mutate={mutate} />
          ))}
        </ul>
      </section>
      {snapshot.permissions.canOversee ? <RoomParticipationSummary snapshot={snapshot} /> : null}
      <SelfControls snapshot={snapshot} mutate={mutate} onLeft={onLeft} />
    </>
  );
}
