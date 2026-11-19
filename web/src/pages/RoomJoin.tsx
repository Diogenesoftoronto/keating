import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, ButtonLink, Card, Eyebrow, Field, Loading, Note, TextInput } from "../design-system/kit";
import { KeatingBot } from "../components/KeatingBot";
import "../components/rooms/rooms.css";
import { RoomJoinDisclosureList } from "../components/rooms/RoomJoinDisclosure";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { articleRole, errorMessage, INVITE_ROLE_HINTS, ROLE_LABELS } from "../components/rooms/room-ui";
import { acceptRoomInvite, previewRoomInvite } from "../rooms/client";
import type { RoomInvitePreview, RoomRole } from "../rooms/contracts";
import { type CoursesAccount, useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

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

  if (loadError) return <Card as="section" className="rm-join" aria-labelledby="room-join-title">
    <KeatingBot state="blank-idle" size={48} label="" />
    <h1 id="room-join-title">Invitation unavailable</h1>
    <Note data-glyph-host role="alert" tone="warn">{loadError}</Note>
    <p>Ask the person who invited you for a new link.</p>
    <div className="rm-form-actions"><ButtonLink to="/rooms" variant="ghost">Open your rooms</ButtonLink><Button onClick={() => void load()}>Try again</Button></div>
  </Card>;

  if (!preview) return <Card as="section" className="rm-join" aria-busy="true">
    <Loading label="Checking the invitation…" />
  </Card>;

  return <Card as="section" className="rm-join" aria-labelledby="room-join-title">
    <KeatingBot state="waving" size={48} label="" />
    <Eyebrow>Study room invitation{preview.courseTitle && ` · ${preview.courseTitle}`}</Eyebrow>
    <h1 id="room-join-title">{preview.roomTitle}</h1>
    {preview.topic && <p>{preview.topic}</p>}
    <div className="rm-join-details">
      <p>{preview.alreadyMember
        ? <>{preview.hostName} hosts this room. You are in this room as <strong>{articleRole(preview.effectiveRole)}</strong>.</>
        : <>{preview.hostName} invited you. You will join as <strong>{articleRole(preview.effectiveRole)}</strong>.</>}</p>
      {!preview.alreadyMember && preview.effectiveRole !== preview.role && <p>The link grants {articleRole(preview.role)}, but a host’s earlier change to your role in this room still applies.</p>}
      <p>{ROLE_HINTS[preview.effectiveRole]}</p>
      <p>Keating {preview.settings.participation === "on-request" ? "replies when someone mentions @Keating or a teacher asks" : "joins the conversation when it can help"}.
        {" "}Link valid until <time dateTime={preview.expiresAt}>{new Date(preview.expiresAt).toLocaleString()}</time>.</p>
    </div>
    {joinError && <Note data-glyph-host role="alert" tone="warn">{joinError}</Note>}
    {preview.alreadyMember ? <>
      <Note data-glyph-host>You are already in this room.</Note>
      <div className="rm-form-actions"><Button variant="primary" glyph="right" busy={joining} onClick={() => void join()}>Open the room</Button></div>
    </> : <form onSubmit={e => { e.preventDefault(); if (displayName.trim()) void join(); }}>
      <h2>Before you join</h2>
      <RoomJoinDisclosureList disclosure={preview} role={preview.effectiveRole} />
      <Field label="Your name in this room" hint="Shown beside your messages. You can rename yourself later.">
        <TextInput value={displayName} maxLength={120} onChange={event => setDisplayName(event.target.value)} />
      </Field>
      <div className="rm-form-actions">
        <ButtonLink to="/rooms" variant="ghost">Not now</ButtonLink>
        <Button type="submit" variant="primary" busy={joining} disabled={!displayName.trim()}>
          {joining ? <Loading size="inline" label="Joining…" /> : `Join as ${ROLE_LABELS[preview.effectiveRole].toLowerCase()}`}
        </Button>
      </div>
    </form>}
  </Card>;
}

export function RoomJoin() {
  useSeo({ title: "Join a study room — Keating", description: "Review and accept a Keating study room invitation." });
  const { token } = useParams({ strict: false }) as { token: string };
  const [access, retry] = useCoursesAccess();
  return (
    <div className="rm-join-page">
      <Nav />
      {access.status === "ready"
        ? <main className="rm-join-stage k-halftone"><JoinCard key={token} token={token} account={access.account} /></main>
        : <div className="rm-join-gate"><CoursesAccessGate state={access} onRetry={retry} /></div>}
    </div>
  );
}
