import { useState } from "react";
import { Hand, Lock, Pause, Play, Power } from "lucide-react";
import { css } from "../../../styled-system/css";
import type { RoomDraft, RoomMember, RoomMessage, RoomOperationInput, RoomViewerSnapshot } from "../../rooms/contracts";
import type { RoomFacilitatorControls } from "../../rooms/useRoomFacilitator";
import { describeKeatingBehavior, errorMessage, formatRoomTime, keatingRunState, roomStyles as s } from "./room-ui";

type Mutate = (operation: RoomOperationInput) => Promise<unknown>;

/** Consent copy shown before this browser starts running Keating. */
export function ModelAccessDisclosure({
  takeOverFrom,
  modelLabel,
  includesGuidance,
}: {
  takeOverFrom?: string;
  /** The model this browser resolved, when known before starting. */
  modelLabel?: string;
  /** Teachers' tabs read private guidance; learner tabs never receive it. */
  includesGuidance: boolean;
}) {
  return (
    <div className={css({ display: "grid", gap: "0.35rem", fontSize: "0.75rem", lineHeight: 1.5 })}>
      <p>
        Keating will run <strong>from this browser tab using your own model access</strong>
        {modelLabel ? <>: <strong>{modelLabel}</strong>, the chat model you chose in Chat</> : <>: the chat model you chose in Chat</>}.
        Each reply counts against your provider’s usage or credits.
      </p>
      <p>
        {includesGuidance
          ? "The room’s transcript, topic, goal, and private teacher guidance are sent to that model to decide each turn."
          : "The room’s shared transcript, topic, and goal are sent to that model to decide each turn. Private teacher guidance is never sent from your browser."}
      </p>
      <p>Keep this tab open. Closing it, or leaving the room, stops Keating for everyone.</p>
      {takeOverFrom ? (
        <p>
          {takeOverFrom === "Your other tab"
            ? <>Your other tab stops running Keating when you take over here.</>
            : <><strong>{takeOverFrom}</strong>’s browser stops running Keating when you take over.</>}
        </p>
      ) : null}
    </div>
  );
}

function outcomeLabel(snapshot: RoomViewerSnapshot): string | null {
  const outcome = snapshot.room.turn.lastOutcome;
  if (!outcome) return null;
  const when = formatRoomTime(outcome.at);
  const detail = snapshot.permissions.canOversee && outcome.detail ? `: ${outcome.detail}` : "";
  switch (outcome.kind) {
    case "spoke": return `Last turn ${when}: replied.`;
    case "passed": return `Last turn ${when}: stayed quiet${detail}.`;
    case "drafted": return `Last turn ${when}: drafted a reply for review.`;
    case "offered-private": return `Last turn ${when}: offered private study.`;
    case "failed": return `Last turn ${when}: failed${detail}.`;
  }
}

export function RoomKeatingPanel({
  snapshot,
  facilitator,
  mutate,
}: {
  snapshot: RoomViewerSnapshot;
  facilitator: RoomFacilitatorControls;
  mutate: Mutate;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { room, permissions } = snapshot;
  const run = keatingRunState(snapshot);
  const thisTab = facilitator.status !== "off";
  const otherBrowser = run.kind === "running" && !thisTab
    ? (run.self ? "Your other tab" : run.facilitatorName)
    : undefined;
  const canTakeOver = Boolean(otherBrowser) && permissions.canOversee;
  const canStart = permissions.canFacilitate && !thisTab && (run.kind === "off" || run.kind === "paused" || canTakeOver);

  const act = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(errorMessage(cause, "That did not work. Try again."));
    } finally {
      setBusy("");
    }
  };

  const status = run.kind === "ended"
    ? "The room has ended. Keating is off."
    : run.kind === "paused"
      ? "Paused by a teacher."
      : run.kind === "off"
        ? "Not running. Someone who can run Keating needs to start it from their browser."
        : run.self && thisTab
          ? `Running from this tab with ${run.modelLabel}${run.thinking ? ", thinking…" : facilitator.status === "thinking" ? ", thinking…" : ", listening."}`
          : run.self
            ? `Running from another of your tabs with ${run.modelLabel}.`
            : `Running from ${run.facilitatorName}’s browser with ${run.modelLabel}${run.thinking ? ", thinking…" : "."}`;

  const outcome = outcomeLabel(snapshot);

  return (
    <section aria-labelledby="room-keating-heading" className={s.section}>
      <h2 id="room-keating-heading" className={s.heading}>Keating</h2>
      <p role="status" className={css({ mt: "0.35rem", fontSize: "0.82rem", lineHeight: 1.5 })}>{status}</p>
      <p className={s.help}>{describeKeatingBehavior(room.settings)}</p>
      {outcome ? <p className={s.help}>{outcome}</p> : null}
      {room.turn.requestedAt && run.kind === "running" ? <p className={s.help}>A teacher asked Keating to step in.</p> : null}
      {room.summary ? (
        <details className={css({ mt: "0.6rem", fontSize: "0.78rem", lineHeight: 1.5 })}>
          <summary className={css({ cursor: "pointer", color: "var(--ink-soft)" })}>
            Keating’s summary of messages 1–{room.summary.throughSeq}
          </summary>
          <p className={css({ mt: "0.35rem", whiteSpace: "pre-wrap" })}>{room.summary.text}</p>
          <p className={s.help}>
            Keating reads this instead of the older messages themselves.
            {room.summary.facilitatorName ? ` Written in ${room.summary.facilitatorName}’s browser, not reviewed.` : ""}
            {permissions.canOversee ? " Hiding a summarized message makes Keating write a new one." : ""}
          </p>
        </details>
      ) : null}

      <div className={css({ mt: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" })}>
        {thisTab ? (
          <button type="button" className={s.button} disabled={Boolean(busy)} onClick={() => void act("stop", facilitator.stop)}>
            <Power size={13} aria-hidden="true" /> Stop running Keating
          </button>
        ) : canStart && !confirming ? (
          <button type="button" className={s.primary} disabled={facilitator.status === "starting"} onClick={() => setConfirming(true)}>
            <Play size={13} aria-hidden="true" /> {canTakeOver ? "Take over Keating" : "Run Keating from this tab"}
          </button>
        ) : null}
        {permissions.canOversee && room.status === "open" ? (
          <>
            <button
              type="button"
              className={s.button}
              disabled={Boolean(busy)}
              onClick={() => void act("pause", () => mutate({ type: "settings.update", patch: { keating: room.settings.keating === "paused" ? "active" : "paused" } }))}
            >
              {room.settings.keating === "paused" ? <><Play size={13} aria-hidden="true" /> Resume Keating</> : <><Pause size={13} aria-hidden="true" /> Pause Keating</>}
            </button>
            <button
              type="button"
              className={s.button}
              disabled={Boolean(busy) || run.kind !== "running" || Boolean(room.turn.requestedAt)}
              onClick={() => void act("request", () => mutate({ type: "turn.request" }))}
            >
              <Hand size={13} aria-hidden="true" /> Ask Keating to step in
            </button>
          </>
        ) : null}
      </div>

      {confirming && canStart ? (
        <div role="group" aria-label="Confirm running Keating" className={css({ mt: "0.75rem", border: "1px solid var(--ink)", bg: "var(--paper)", p: "0.75rem" })}>
          <ModelAccessDisclosure
            includesGuidance={permissions.canOversee}
            {...(facilitator.modelLabel ? { modelLabel: facilitator.modelLabel } : {})}
            {...(otherBrowser ? { takeOverFrom: otherBrowser } : {})}
          />
          <div className={css({ mt: "0.65rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" })}>
            <button
              type="button"
              className={s.primary}
              disabled={facilitator.status === "starting"}
              onClick={() => {
                setConfirming(false);
                void facilitator.start({ takeOver: canTakeOver });
              }}
            >
              {facilitator.status === "starting" ? "Starting…" : canTakeOver ? "Use my model and take over" : "Use my model access"}
            </button>
            <button type="button" className={s.button} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {!permissions.canFacilitate && run.kind === "off" && room.status === "open" ? (
        <p className={s.help}>
          {room.settings.facilitators === "teachers" ? "Only teachers can run Keating in this room." : "You cannot run Keating in this room."}
        </p>
      ) : null}
      {facilitator.error ? (
        <p role="alert" className={`${s.error} ${css({ mt: "0.6rem" })}`}>
          {facilitator.error}
          {facilitator.status === "off" ? " To choose or connect a model, open Chat settings, then try again." : ""}
        </p>
      ) : null}
      {error ? <p role="alert" className={`${s.error} ${css({ mt: "0.6rem" })}`}>{error}</p> : null}
    </section>
  );
}

/** Teacher review of replies and private-study offers held before delivery. */
export function RoomDraftReview({
  drafts,
  roomOpen,
  mutate,
  members = [],
  messages = [],
}: {
  drafts: readonly RoomDraft[];
  roomOpen: boolean;
  mutate: Mutate;
  members?: readonly RoomMember[];
  messages?: readonly RoomMessage[];
}) {
  const pending = drafts.filter((draft) => draft.status === "pending");
  if (pending.length === 0) return null;
  const offers = pending.filter((draft) => draft.privateFork).length;
  const replies = pending.length - offers;
  const heading = offers === 0
    ? (replies === 1 ? "1 Keating reply waiting for review" : `${replies} Keating replies waiting for review`)
    : replies === 0
      ? `${offers} private-study ${offers === 1 ? "offer" : "offers"} waiting for review`
      : `${replies} ${replies === 1 ? "reply" : "replies"} and ${offers} private-study ${offers === 1 ? "offer" : "offers"} waiting for review`;
  return (
    <section aria-labelledby="room-drafts-heading" className={css({ borderBottom: "2px solid var(--ink)", bg: "color-mix(in srgb, var(--course-green, #1e9b50) 8%, var(--card))", px: "1rem", py: "0.75rem" })}>
      <h2 id="room-drafts-heading" className={s.heading}>
        {heading}
      </h2>
      <p className={s.help}>
        {offers ? "Approve an offer to invite only its recipient to study privately. The learner chooses whether to open it." : "Learners do not see these until a teacher approves them."}
      </p>
      <ul className={css({ mt: "0.6rem", display: "grid", gap: "0.6rem" })}>
        {pending.map((draft) => draft.privateFork ? (
          <PrivateForkDraftItem key={draft.id} draft={draft} proposal={draft.privateFork} roomOpen={roomOpen} mutate={mutate} members={members} messages={messages} />
        ) : <DraftItem key={draft.id} draft={draft} roomOpen={roomOpen} mutate={mutate} />)}
      </ul>
    </section>
  );
}

function PrivateForkDraftItem({ draft, proposal, roomOpen, mutate, members, messages }: {
  draft: RoomDraft;
  proposal: NonNullable<RoomDraft["privateFork"]>;
  roomOpen: boolean;
  mutate: Mutate;
  members: readonly RoomMember[];
  messages: readonly RoomMessage[];
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const recipient = members.find((member) => member.accountId === proposal.learnerAccountId);
  const source = messages.find((message) => message.id === proposal.sourceMessageId
    && message.audience === "room" && !message.hidden && (message.kind === "chat" || message.kind === "keating"));
  const quote = proposal.selectedText ?? source?.body;
  const resolve = async (action: "approve" | "reject") => {
    setBusy(action);
    setError("");
    try {
      // Offers use the exact public source. Supplying a body is forbidden.
      await mutate({ type: "draft.resolve", draftId: draft.id, action });
    } catch (cause) {
      setError(errorMessage(cause, "The private-study offer could not be resolved."));
      setBusy(null);
    }
  };
  return (
    <li className={css({ border: "1px solid var(--ink)", bg: "var(--card)", p: "0.65rem", overflowWrap: "anywhere" })}>
      <p className={css({ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.86rem", fontWeight: 750 })}>
        <Lock size={14} aria-hidden="true" /> Private-study offer
      </p>
      <p className={css({ mt: "0.35rem", fontSize: "0.84rem" })}>
        For <strong>{recipient?.displayName ?? proposal.learnerAccountId}</strong>
      </p>
      <p className={s.help}>
        {draft.reason === "paused" ? "Proposed while Keating was paused" : "Held for review"} · {draft.model} · <time dateTime={draft.createdAt}>{formatRoomTime(draft.createdAt)}</time>
      </p>
      {source ? (
        <a href={`#room-message-${source.id}`} className={`${s.button} ${css({ mt: "0.5rem", whiteSpace: "normal" })}`}>
          View source from {source.authorName}
        </a>
      ) : (
        <p className={s.help}>Source message: {proposal.sourceMessageId}. Its original message is not loaded here.</p>
      )}
      {quote ? (
        <details className={css({ mt: "0.5rem", fontSize: "0.8rem", lineHeight: 1.5 })}>
          <summary className={css({ cursor: "pointer", fontWeight: 700, _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "2px" } })}>
            {proposal.selectedText ? "View selected passage" : "View source message"}
          </summary>
          <blockquote className={css({ mt: "0.35rem", whiteSpace: "pre-wrap" })}>{quote}</blockquote>
        </details>
      ) : null}
      <p className={s.help}>The invitation goes only to this learner. Their private conversation stays out of the room.</p>
      <div className={css({ mt: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" })}>
        <button type="button" className={s.primary} disabled={busy !== null || !roomOpen} onClick={() => void resolve("approve")}>
          {busy === "approve" ? "Approving…" : "Approve private-study offer"}
        </button>
        <button type="button" className={s.danger} disabled={busy !== null} onClick={() => void resolve("reject")}>
          {busy === "reject" ? "Rejecting…" : "Reject offer"}
        </button>
      </div>
      {error ? <p role="alert" className={`${s.error} ${css({ mt: "0.5rem" })}`}>{error}</p> : null}
    </li>
  );
}

function DraftItem({ draft, roomOpen, mutate }: { draft: RoomDraft; roomOpen: boolean; mutate: Mutate }) {
  const [body, setBody] = useState(draft.body);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolve = async (action: "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      const edited = action === "approve" && body.trim() && body.trim() !== draft.body;
      await mutate({ type: "draft.resolve", draftId: draft.id, action, ...(edited ? { body: body.trim() } : {}) });
    } catch (cause) {
      setError(errorMessage(cause, "The draft could not be resolved."));
      setBusy(false);
    }
  };
  return (
    <li className={css({ border: "1px solid var(--ink)", bg: "var(--card)", p: "0.65rem" })}>
      <p className={css({ fontSize: "0.7rem", color: "var(--ink-soft)" })}>
        {draft.reason === "paused" ? "Written while Keating was paused" : "Held for review"} · {draft.model} · <time dateTime={draft.createdAt}>{formatRoomTime(draft.createdAt)}</time>
        {draft.addressedTo?.length ? ` · to ${draft.addressedTo.join(", ")}` : ""}
      </p>
      {editing ? (
        <label className={css({ mt: "0.4rem", display: "block" })}>
          <span className={css({ srOnly: true })}>Edit Keating’s draft</span>
          <textarea className={s.input} rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
      ) : (
        <p className={css({ mt: "0.35rem", whiteSpace: "pre-wrap", fontSize: "0.86rem", lineHeight: 1.5 })}>{body}</p>
      )}
      <div className={css({ mt: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" })}>
        <button type="button" className={s.primary} disabled={busy || !roomOpen || !body.trim()} onClick={() => void resolve("approve")}>
          {body.trim() !== draft.body ? "Post edited reply" : "Approve and post"}
        </button>
        <button type="button" className={s.button} disabled={busy} onClick={() => setEditing((value) => !value)} aria-pressed={editing}>
          {editing ? "Done editing" : "Edit"}
        </button>
        <button type="button" className={s.danger} disabled={busy} onClick={() => void resolve("reject")}>Reject</button>
      </div>
      {error ? <p role="alert" className={`${s.error} ${css({ mt: "0.5rem" })}`}>{error}</p> : null}
    </li>
  );
}
