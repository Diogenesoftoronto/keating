import { useEffect, useRef, useState } from "react";
import { css } from "../../../styled-system/css";
import type { RoomViewerSnapshot } from "../../rooms/contracts";
import { errorMessage, roomStyles as s } from "./room-ui";

export function roomSourceReturnState(snapshot: RoomViewerSnapshot, hash: string): { id: string; state: "ready" | "earlier" | "unavailable" } | null {
  const match = /^#room-message-([A-Za-z0-9][A-Za-z0-9_-]{1,95})$/.exec(hash);
  if (!match) return null;
  const id = match[1]!;
  const message = snapshot.room.messages.find(item => item.id === id);
  return { id, state: message ? !message.hidden && message.audience === "room" && (message.kind === "chat" || message.kind === "keating") ? "ready" : "unavailable"
    : snapshot.hasEarlierMessages ? "earlier" : "unavailable" };
}

/** Resolve only the requested message; never substitute a nearby transcript point. */
export function RoomSourceReturn({ snapshot, onLoadEarlier, onReveal }: { snapshot: RoomViewerSnapshot; onLoadEarlier: () => Promise<void>; onReveal: () => void }) {
  const [hash, setHash] = useState(() => typeof window === "undefined" ? "" : window.location?.hash ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const revealed = useRef("");
  const target = roomSourceReturnState(snapshot, hash);
  const reveal = useRef(onReveal); reveal.current = onReveal;
  useEffect(() => {
    const update = () => { setHash(window.location.hash); revealed.current = ""; setError(""); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [snapshot.room.id]);
  useEffect(() => {
    if (target?.state !== "ready" || revealed.current === `${snapshot.room.id}:${target.id}`) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`room-message-${target.id}`);
      if (element) { reveal.current(); element.scrollIntoView({ block: "center" }); element.focus({ preventScroll: true }); revealed.current = `${snapshot.room.id}:${target.id}`; }
    });
    return () => cancelAnimationFrame(frame);
  }, [target?.id, target?.state, snapshot.room.id]);
  if (!target || target.state === "ready") return null;
  return <div role="status" className={`${s.notice} ${css({ mx: "0.75rem", mb: "0.5rem" })}`}>
    <p>{target.state === "earlier" ? "Your source message is not in the loaded transcript. Load earlier messages to find the exact source." : "This source message is no longer available to you. It may have been hidden or removed."}</p>
    {target.state === "earlier" ? <button type="button" className={s.button} disabled={loading} onClick={() => {
      setLoading(true); setError("");
      void onLoadEarlier().catch(cause => setError(errorMessage(cause, "Earlier messages could not be loaded. Try again."))).finally(() => setLoading(false));
    }}>{loading ? "Loading…" : "Load earlier source messages"}</button> : null}
    {error ? <p role="alert" className={s.error}>{error}</p> : null}
  </div>;
}
