import { useId, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { css } from "../../../styled-system/css";
import { deleteRoom, roomTranscriptUrl } from "../../rooms/client";
import type { RoomOperationInput, RoomSettings, RoomViewerSnapshot } from "../../rooms/contracts";
import { PARTICIPATION_OPTIONS, REPLY_REVIEW_OPTIONS, RoomChoice } from "./RoomCreateForm";
import { errorMessage, roomStyles as s } from "./room-ui";

type Mutate = (operation: RoomOperationInput) => Promise<unknown>;

export function RoomTranscriptExport({ roomId }: { roomId: string }) {
  return (
    <a href={roomTranscriptUrl(roomId)} download className={s.button}>
      <Download size={13} aria-hidden="true" /> Export transcript
    </a>
  );
}

function DetailsForm({ snapshot, mutate }: { snapshot: RoomViewerSnapshot; mutate: Mutate }) {
  const { room } = snapshot;
  const [title, setTitle] = useState(room.title);
  const [topic, setTopic] = useState(room.topic);
  const [goal, setGoal] = useState(room.goal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = title.trim() !== room.title || topic.trim() !== room.topic || goal.trim() !== room.goal;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || !title.trim()) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await mutate({ type: "room.update", patch: { title: title.trim(), topic: topic.trim(), goal: goal.trim() } });
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause, "The room details were not saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className={css({ mt: "0.55rem", display: "grid", gap: "0.6rem" })}>
      <label className={s.field}>
        <span className={s.fieldLabel}>Title</span>
        <input className={s.input} value={title} maxLength={160} required onChange={(event) => { setTitle(event.target.value); setSaved(false); }} />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>Topic</span>
        <textarea className={s.input} rows={2} maxLength={2_000} value={topic} onChange={(event) => { setTopic(event.target.value); setSaved(false); }} />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>Goal</span>
        <textarea className={s.input} rows={2} maxLength={2_000} value={goal} onChange={(event) => { setGoal(event.target.value); setSaved(false); }} />
      </label>
      <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
        <button type="submit" className={s.primary} disabled={busy || !dirty || !title.trim()}>{busy ? "Saving…" : "Save details"}</button>
        {saved ? <span role="status" className={s.help}>Saved.</span> : null}
      </div>
      {error ? <p role="alert" className={s.error}>{error}</p> : null}
    </form>
  );
}

function SettingsForm({ snapshot, mutate }: { snapshot: RoomViewerSnapshot; mutate: Mutate }) {
  const id = useId();
  const { settings } = snapshot.room;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const disabled = busy || snapshot.room.status !== "open";
  const update = async (patch: Partial<RoomSettings>) => {
    setBusy(true);
    setError("");
    try {
      await mutate({ type: "settings.update", patch });
    } catch (cause) {
      setError(errorMessage(cause, "That setting was not saved."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={css({ mt: "0.55rem", display: "grid", gap: "0.75rem" })}>
      <RoomChoice legend="How Keating participates" name={`${id}-participation`} value={settings.participation} options={PARTICIPATION_OPTIONS} disabled={disabled} onChange={(participation) => void update({ participation })} />
      <RoomChoice legend="Teacher review of Keating’s replies" name={`${id}-review`} value={settings.replyReview} options={REPLY_REVIEW_OPTIONS} disabled={disabled} onChange={(replyReview) => void update({ replyReview })} />
      <RoomChoice
        legend="Who can run Keating"
        name={`${id}-facilitators`}
        value={settings.facilitators}
        disabled={disabled}
        options={[
          { value: "teachers", label: "Teachers", hint: "Uses a teacher’s own model access." },
          { value: "anyone", label: "Teachers or learners", hint: "Learners can run it only while teacher review is off." },
        ]}
        onChange={(facilitators) => void update({ facilitators })}
      />
      <label className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.78rem" })}>
        <input type="checkbox" className={css({ mt: "0.2rem" })} checked={settings.learnerInvites} disabled={disabled} onChange={(event) => void update({ learnerInvites: event.target.checked })} />
        <span><strong>Learners can invite learners</strong><span className={css({ display: "block", color: "var(--ink-soft)" })}>Their links can only add learners.</span></span>
      </label>
      {error ? <p role="alert" className={s.error}>{error}</p> : null}
    </div>
  );
}

function Lifecycle({ snapshot, mutate, onDeleted }: { snapshot: RoomViewerSnapshot; mutate: Mutate; onDeleted: () => void }) {
  const { room, viewer } = snapshot;
  const [confirm, setConfirm] = useState<"end" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setConfirm(null);
      after?.();
    } catch (cause) {
      setError(errorMessage(cause, "That change was not saved."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={css({ mt: "0.55rem", display: "grid", gap: "0.5rem" })}>
      {room.status === "open" ? (
        confirm === "end" ? (
          <div className={css({ display: "grid", gap: "0.4rem", fontSize: "0.76rem" })}>
            <p>End the room for everyone? Keating stops, posting closes, and invites stop working. You can reopen it later.</p>
            <div className={css({ display: "flex", gap: "0.35rem" })}>
              <button type="button" className={s.danger} disabled={busy} onClick={() => void run(() => mutate({ type: "room.status", status: "ended" }))}>End room</button>
              <button type="button" className={s.button} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className={s.danger} onClick={() => setConfirm("end")}>End room…</button>
        )
      ) : (
        <button type="button" className={s.primary} disabled={busy} onClick={() => void run(() => mutate({ type: "room.status", status: "open" }))}>Reopen room</button>
      )}
      {viewer.role === "host" ? (
        confirm === "delete" ? (
          <div className={css({ display: "grid", gap: "0.4rem", fontSize: "0.76rem" })}>
            <p>Delete the room and its transcript for every member? This cannot be undone. Export the transcript first if you need it.</p>
            <div className={css({ display: "flex", gap: "0.35rem" })}>
              <button type="button" className={s.danger} disabled={busy} onClick={() => void run(() => deleteRoom(room.id), onDeleted)}>Delete permanently</button>
              <button type="button" className={s.button} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className={`${s.quietDanger} ${css({ justifySelf: "start" })}`} onClick={() => setConfirm("delete")}>Delete room…</button>
        )
      ) : null}
      {error ? <p role="alert" className={s.error}>{error}</p> : null}
    </div>
  );
}

export function RoomSettingsPanel({ snapshot, mutate, onDeleted }: { snapshot: RoomViewerSnapshot; mutate: Mutate; onDeleted: () => void }) {
  return (
    <>
      <section aria-labelledby="room-details-heading" className={s.section}>
        <h2 id="room-details-heading" className={s.heading}>Room details</h2>
        <DetailsForm key={snapshot.room.id} snapshot={snapshot} mutate={mutate} />
      </section>
      <section aria-labelledby="room-settings-heading" className={s.section}>
        <h2 id="room-settings-heading" className={s.heading}>Keating settings</h2>
        <SettingsForm snapshot={snapshot} mutate={mutate} />
      </section>
      <section aria-labelledby="room-lifecycle-heading" className={s.section}>
        <h2 id="room-lifecycle-heading" className={s.heading}>Session</h2>
        <div className={css({ mt: "0.5rem" })}><RoomTranscriptExport roomId={snapshot.room.id} /></div>
        <Lifecycle snapshot={snapshot} mutate={mutate} onDeleted={onDeleted} />
      </section>
    </>
  );
}
