import { useCallback, useEffect, useId, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, QrCode } from "lucide-react";
import { css } from "../../../styled-system/css";
import { createRoomInvite, listRoomInvites, revokeRoomInvite, roomInviteUrl } from "../../rooms/client";
import { ROOM_MAX_MEMBERS, type RoomInviteRole, type RoomInviteSummary, type RoomViewerSnapshot } from "../../rooms/contracts";
import { RoomChoice } from "./RoomCreateForm";
import {
  INVITE_EXPIRY_OPTIONS,
  INVITE_ROLE_HINTS,
  ROLE_LABELS,
  errorMessage,
  formatUntil,
  inviteState,
  roomStyles as s,
} from "./room-ui";

export function clampUses(text: string): number {
  const value = Math.round(Number(text));
  return Number.isFinite(value) && value >= 1 ? Math.min(ROOM_MAX_MEMBERS, value) : 1;
}

const STATE_LABELS = { active: "Active", expired: "Expired", revoked: "Revoked", used: "All uses taken" } as const;

function NewInviteLink({ url, role }: { url: string; role: RoomInviteRole }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 208, margin: 1, color: { dark: "#1c211b", light: "#f6f2e8" } })
      .then((data) => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQr(""); });
    return () => { cancelled = true; };
  }, [url]);
  const copy = async () => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopyError("Copying was blocked. Select the link and copy it manually.");
    }
  };
  return (
    <div className={css({ mt: "0.75rem", display: "grid", gap: "0.65rem", border: "1px solid var(--ink)", bg: "var(--paper)", p: "0.75rem" })}>
      <p className={css({ fontSize: "0.75rem", fontWeight: 750 })}>New {role} link. Copy it now; it is shown only once.</p>
      <div className={css({ display: "grid", justifyItems: "center", bg: "#f6f2e8", border: "1px solid var(--ink)", p: "0.4rem" })}>
        {qr ? <img src={qr} alt={`QR code that opens the ${role} invitation`} width={208} height={208} /> : <span className={s.help}>Rendering QR code…</span>}
      </div>
      <label>
        <span className={css({ srOnly: true })}>Invitation link</span>
        <input readOnly className={s.input} style={{ fontFamily: "var(--mono-body)", fontSize: "0.68rem" }} value={url} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button type="button" className={s.button} onClick={() => void copy()}>
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied ? "Copied" : "Copy link"}
      </button>
      {copyError ? <p role="alert" className={s.error}>{copyError}</p> : null}
    </div>
  );
}

export function RoomInvitesPanel({ snapshot }: { snapshot: RoomViewerSnapshot }) {
  const id = useId();
  const roomId = snapshot.room.id;
  const roles = snapshot.permissions.inviteRoles;
  const [role, setRole] = useState<RoomInviteRole>(roles.includes("learner") ? "learner" : roles[0] ?? "learner");
  const [hours, setHours] = useState(72);
  const [maxUsesText, setMaxUsesText] = useState("30");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ url: string; role: RoomInviteRole } | null>(null);
  const [invites, setInvites] = useState<RoomInviteSummary[] | null>(null);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const { canInvite, canOversee } = snapshot.permissions;
  // The server scopes the list to what this viewer may see, so a role change
  // means a fresh list rather than keeping links fetched with teacher access.
  const scope = `${canInvite}:${canOversee}:${roles.join(",")}`;

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setListError("");
    try {
      const items = await listRoomInvites(roomId);
      if (request === requestRef.current) setInvites(items);
    } catch (cause) {
      if (request === requestRef.current) setListError(errorMessage(cause, "Invitations could not be loaded."));
    }
  }, [roomId]);

  useEffect(() => {
    setInvites(null);
    if (canInvite) void load();
    return () => {
      requestRef.current += 1;
    };
  }, [canInvite, load, scope]);

  useEffect(() => {
    if (!roles.includes(role) && roles[0]) setRole(roles[0]);
    // A link made with access this viewer no longer has must not stay on screen.
    setCreated((current) => (current && roles.includes(current.role) ? current : null));
  }, [role, roles]);

  if (!snapshot.permissions.canInvite) {
    return (
      <section aria-labelledby={`${id}-heading`} className={s.section}>
        <h2 id={`${id}-heading`} className={s.heading}>Invitations</h2>
        <p className={s.help}>
          {snapshot.room.status === "ended"
            ? "The room has ended, so no new invitations can be made."
            : "Only teachers can invite people to this room."}
        </p>
      </section>
    );
  }

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const result = await createRoomInvite(roomId, { role, expiresInHours: hours, maxUses: clampUses(maxUsesText) });
      setMaxUsesText(String(clampUses(maxUsesText)));
      setCreated({ url: roomInviteUrl(result.token), role: result.invite.role });
      setInvites((current) => [result.invite, ...(current ?? [])]);
    } catch (cause) {
      setError(errorMessage(cause, "The invitation could not be created."));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (invite: RoomInviteSummary) => {
    setError("");
    try {
      await revokeRoomInvite(roomId, invite.id);
      setInvites((current) => current?.map((item) => item.id === invite.id ? { ...item, revokedAt: new Date().toISOString() } : item) ?? null);
    } catch (cause) {
      setError(errorMessage(cause, "The invitation could not be revoked."));
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className={s.section}>
      <h2 id={`${id}-heading`} className={s.heading}><QrCode size={15} aria-hidden="true" className={css({ display: "inline", mr: "0.3rem", verticalAlign: "-2px" })} />Invite people</h2>
      <p className={s.help}>Anyone with the link signs in, sees what joining shares, and then chooses to join.</p>
      <div className={css({ mt: "0.65rem", display: "grid", gap: "0.65rem" })}>
        {roles.length > 1 ? (
          <RoomChoice
            legend="Join as"
            name={`${id}-role`}
            value={role}
            options={roles.map((value) => ({ value, label: ROLE_LABELS[value] }))}
            onChange={setRole}
          />
        ) : (
          <p className={css({ fontSize: "0.76rem" })}>Links you make invite <strong>learners</strong>.</p>
        )}
        <p className={s.help}>{INVITE_ROLE_HINTS[role]}</p>
        <div className={css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem" })}>
          <label className={s.field}>
            <span className={s.fieldLabel}>Expires after</span>
            <select className={s.input} value={hours} onChange={(event) => setHours(Number(event.target.value))}>
              {INVITE_EXPIRY_OPTIONS.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}
            </select>
          </label>
          <label className={s.field}>
            <span className={s.fieldLabel}>Uses</span>
            <input
              className={s.input}
              type="number"
              inputMode="numeric"
              min={1}
              max={ROOM_MAX_MEMBERS}
              value={maxUsesText}
              onChange={(event) => setMaxUsesText(event.target.value)}
              onBlur={() => setMaxUsesText(String(clampUses(maxUsesText)))}
            />
          </label>
        </div>
        <button type="button" className={s.primary} disabled={creating} onClick={() => void create()}>
          {creating ? "Creating link…" : "Create invite link"}
        </button>
      </div>
      {created ? <NewInviteLink url={created.url} role={created.role} /> : null}
      {error ? <p role="alert" className={`${s.error} ${css({ mt: "0.6rem" })}`}>{error}</p> : null}

      <h3 className={css({ mt: "1rem", fontSize: "0.8rem", fontWeight: 800 })}>
        {roles.length === 1 && roles[0] === "learner" && !snapshot.permissions.canOversee ? "Links you made" : "Links"}
      </h3>
      {listError ? (
        <div role="alert" className={css({ mt: "0.35rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" })}>
          <p className={s.error}>{listError}</p>
          <button type="button" className={s.quiet} onClick={() => void load()}>Try again</button>
        </div>
      ) : invites === null ? (
        <p className={s.help}>Loading…</p>
      ) : invites.length === 0 ? (
        <p className={s.help}>No invitation links yet.</p>
      ) : (
        <ul className={css({ mt: "0.35rem", display: "grid", gap: "0.35rem" })}>
          {invites.map((invite) => {
            const state = inviteState(invite);
            return (
              <li key={invite.id} className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.4rem", fontSize: "0.74rem", borderBottom: "1px solid color-mix(in srgb, var(--ink) 15%, transparent)", pb: "0.35rem" })}>
                <span>
                  <strong>{ROLE_LABELS[invite.role]}</strong> · {invite.uses}/{invite.maxUses} used ·{" "}
                  {state === "active" ? formatUntil(invite.expiresAt) : STATE_LABELS[state]}
                </span>
                {state === "active" ? (
                  <button type="button" className={s.quietDanger} onClick={() => void revoke(invite)} aria-label={`Revoke ${invite.role} link with ${invite.uses} of ${invite.maxUses} uses`}>
                    Revoke
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
