import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { RoomJoinDisclosureList } from "../components/rooms/RoomJoinDisclosure";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { articleRole, errorMessage, INVITE_ROLE_HINTS, ROLE_LABELS, roomStyles as s } from "../components/rooms/room-ui";
import { acceptRoomInvite, previewRoomInvite } from "../rooms/client";
import type { RoomInvitePreview, RoomRole } from "../rooms/contracts";
import { type CoursesAccount, useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

const cardClass = css({
  w: "100%",
  border: "2px solid var(--ink)",
  bg: "var(--card)",
  p: { base: "1.25rem", md: "2rem" },
  boxShadow: "6px 6px 0 var(--course-green, #1e9b50)",
});

const ROLE_HINTS: Record<RoomRole, string> = {
  ...INVITE_ROLE_HINTS,
  host: "Runs the room and manages everyone in it.",
};

function JoinCard({ token, account }: { token: string; account: CoursesAccount }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<RoomInvitePreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [displayName, setDisplayName] = useState(account.displayName);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setPreview(await previewRoomInvite(token));
    } catch (cause) {
      setLoadError(errorMessage(cause, "This invitation could not be opened."));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = async () => {
    if (joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const name = displayName.trim();
      const snapshot = await acceptRoomInvite(token, name && name !== account.displayName ? name : undefined);
      await navigate({ to: "/rooms/$roomId", params: { roomId: snapshot.room.id }, replace: true });
    } catch (cause) {
      setJoinError(errorMessage(cause, "This invitation could not be accepted."));
      setJoining(false);
    }
  };

  if (loadError) {
    return (
      <section className={cardClass} aria-labelledby="room-join-title">
        <h1 id="room-join-title" className={css({ fontFamily: "Georgia, serif", fontSize: "1.8rem" })}>Invitation unavailable</h1>
        <p role="alert" className={css({ mt: "0.75rem", color: "var(--destructive)", lineHeight: 1.6 })}>{loadError}</p>
        <p className={css({ mt: "0.5rem", color: "var(--ink-soft)", fontSize: "0.85rem" })}>Ask the person who invited you for a new link.</p>
        <div className={css({ mt: "1.25rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
          <button type="button" className={s.button} onClick={() => void load()}>Try again</button>
          <Link to="/rooms" className={s.button}>Open your rooms</Link>
        </div>
      </section>
    );
  }

  if (!preview) {
    return (
      <section className={cardClass} aria-busy="true">
        <p role="status" className={css({ color: "var(--ink-soft)" })}>Checking the invitation…</p>
      </section>
    );
  }

  return (
    <section className={cardClass} aria-labelledby="room-join-title">
      <p className={s.label}>Study room invitation{preview.courseTitle ? ` · ${preview.courseTitle}` : ""}</p>
      <h1 id="room-join-title" className={css({ mt: "0.4rem", fontFamily: "Georgia, serif", fontSize: { base: "1.7rem", md: "2.1rem" }, lineHeight: 1.15, overflowWrap: "anywhere" })}>
        {preview.roomTitle}
      </h1>
      {preview.topic ? <p className={css({ mt: "0.5rem", color: "var(--ink-soft)", lineHeight: 1.6 })}>{preview.topic}</p> : null}

      <div className={css({ mt: "1.25rem", borderTop: "1px solid var(--ink)", pt: "1rem" })}>
        <p className={css({ fontSize: "0.95rem" })}>
          {preview.alreadyMember
            ? <>You are in this room as <strong>{articleRole(preview.effectiveRole)}</strong>.</>
            : <>{preview.hostName} invited you. You will join as <strong>{articleRole(preview.effectiveRole)}</strong>.</>}
        </p>
        {!preview.alreadyMember && preview.effectiveRole !== preview.role ? (
          <p className={s.help}>The link grants {articleRole(preview.role)}, but a host’s earlier change to your role in this room still applies.</p>
        ) : null}
        <p className={s.help}>{ROLE_HINTS[preview.effectiveRole]}</p>
        <p className={s.help}>
          Keating {preview.settings.participation === "on-request" ? "replies when someone mentions @Keating or a teacher asks" : "joins the conversation when it can help"}.
          Link valid until <time dateTime={preview.expiresAt}>{new Date(preview.expiresAt).toLocaleString()}</time>.
        </p>
      </div>

      {preview.alreadyMember ? (
        <div className={css({ mt: "1.25rem" })}>
          <p className={s.notice}>You are already in this room.</p>
          <button type="button" className={`${s.primary} ${css({ mt: "1rem" })}`} onClick={() => void join()} disabled={joining}>
            Open the room <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <div className={css({ mt: "1.25rem", borderTop: "1px solid var(--ink)", pt: "1rem" })}>
            <h2 className={css({ mb: "0.75rem", fontWeight: 800, fontSize: "0.9rem" })}>Before you join</h2>
            <RoomJoinDisclosureList disclosure={preview} role={preview.effectiveRole} />
          </div>
          <label className={`${s.field} ${css({ mt: "1.25rem" })}`}>
            <span className={s.fieldLabel}>Your name in this room</span>
            <input className={s.input} value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} />
            <span className={s.help}>Shown beside your messages. You can rename yourself later.</span>
          </label>
          {joinError ? <p role="alert" className={`${s.error} ${css({ mt: "0.9rem" })}`}>{joinError}</p> : null}
          <div className={css({ mt: "1.25rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
            <button type="button" className={s.primary} onClick={() => void join()} disabled={joining || !displayName.trim()}>
              {joining ? "Joining…" : `Join as ${ROLE_LABELS[preview.effectiveRole].toLowerCase()}`} {joining ? null : <ArrowRight size={16} aria-hidden="true" />}
            </button>
            <Link to="/rooms" className={s.button}>Not now</Link>
          </div>
        </>
      )}
    </section>
  );
}

export function RoomJoin() {
  useSeo({ title: "Join a study room — Keating", description: "Review and accept a Keating study room invitation." });
  const { token } = useParams({ strict: false }) as { token: string };
  const [access, retry] = useCoursesAccess();
  return (
    <div className={css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" })}>
      <Nav />
      {access.status === "ready" ? (
        <main className={css({ mx: "auto", display: "grid", minH: "calc(100vh - 3.5rem)", maxW: "38rem", placeItems: "center", px: "1rem", py: "2.5rem" })}>
          <JoinCard token={token} account={access.account} />
        </main>
      ) : (
        <CoursesAccessGate state={access} onRetry={retry} />
      )}
    </div>
  );
}
