import { useLayoutEffect, useRef, useState } from "react";
import { css } from "../../../styled-system/css";
import { getRoomPrivateForkContext } from "../../rooms/client";
import { createRoomPrivateForkSession } from "../../rooms/private-fork-session";
import { resolvePrivateForkPassage } from "../../keating/private-fork-provenance";
import type { RoomMessage, RoomOperationInput, RoomPrivateForkContext, RoomPrivateForkOffer, RoomViewerSnapshot } from "../../rooms/contracts";
import { PrivateForkPanel, type PrivateForkPassage } from "../private-fork/PrivateForkPanel";
import { errorMessage, roomStyles as s } from "./room-ui";

export function isPrivateForkLearner(snapshot: RoomViewerSnapshot): boolean {
  return snapshot.viewer.role === "learner" && snapshot.room.members.some(member => member.accountId === snapshot.viewer.accountId && member.role === "learner");
}

export function canContinueRoomMessage(snapshot: RoomViewerSnapshot, message: RoomMessage): boolean {
  return isPrivateForkLearner(snapshot) && !message.hidden && message.audience === "room"
    && (message.kind === "chat" || message.kind === "keating") && Boolean(message.body.trim());
}

export function roomPrivateOfferKey(accountId: string, roomId: string, offerId: string): string {
  return JSON.stringify(["room-private-offer", accountId, roomId, offerId]);
}

export interface RoomPrivateForkDependencies {
  getContext: typeof getRoomPrivateForkContext;
  createSession: typeof createRoomPrivateForkSession;
}
const production: RoomPrivateForkDependencies = { getContext: getRoomPrivateForkContext, createSession: createRoomPrivateForkSession };
type OpenChat = (sessionId: string, question: string) => void | Promise<void>;
type Mutate = (operation: RoomOperationInput) => Promise<unknown>;

/** New branch from a transcript message, or a stable continuation of an offer. */
export function RoomPrivateFork({ snapshot, source, offer, onCancel, onOpenChat, mutate, dependencies = production }: {
  snapshot: RoomViewerSnapshot;
  source: RoomMessage;
  offer?: RoomPrivateForkOffer;
  onCancel: () => void;
  onOpenChat: OpenChat;
  mutate: Mutate;
  dependencies?: RoomPrivateForkDependencies;
}) {
  const initial = useRef({ roomId: snapshot.room.id, accountId: snapshot.viewer.accountId, member: JSON.stringify(snapshot.viewer), source });
  const current = useRef(snapshot);
  current.current = snapshot;
  const branchKey = useRef<string | null>(null);
  const validNow = () => {
    const live = current.current;
    if (live.room.id !== initial.current.roomId || live.viewer.accountId !== initial.current.accountId
      || JSON.stringify(live.viewer) !== initial.current.member || !isPrivateForkLearner(live)) return false;
    const message = live.room.messages.find(item => item.id === source.id);
    // Offer sources can precede the loaded page; the fresh context endpoint validates those.
    if (message && (!canContinueRoomMessage(live, message) || message.body !== initial.current.source.body)) return false;
    if (!message && !offer) return false;
    return !offer || live.room.privateForkOffers.some(item => item.id === offer.id && item.learnerAccountId === live.viewer.accountId && item.status !== "dismissed"
      && item.sourceMessageId === offer.sourceMessageId && item.selectedText === offer.selectedText && item.start === offer.start && item.end === offer.end && item.sourceHash === offer.sourceHash);
  };
  let initialPassage: PrivateForkPassage | undefined;
  let sourceError = "";
  if (offer) {
    try {
      const exact = resolvePrivateForkPassage(source.body, offer);
      initialPassage = { selectedText: exact.quote, start: exact.start, end: exact.end, sourceHash: exact.sourceHash };
    } catch (cause) { sourceError = errorMessage(cause, "This source is no longer available."); }
  }
  if (!validNow() || sourceError) return <div className={s.notice} role="status">
    <p>{sourceError || "The source or your room access changed. Choose the source again."}</p>
    <button type="button" className={s.button} onClick={onCancel}>Close</button>
  </div>;
  return <PrivateForkPanel title={offer ? "Keating offered a private continuation" : "Continue privately"}
    sourceText={source.body} sourceLabel={`From ${source.authorName} in ${snapshot.room.title}`} sourceKind="room"
    {...(initialPassage ? { initialPassage } : {})} lockPassage={Boolean(offer)} onCancel={onCancel}
    onOpen={async ({ passage, question, signal }) => {
      const check = () => { if (signal.aborted || !validNow()) throw new Error("The source or your room access changed. Choose the source again."); };
      check();
      const context = await dependencies.getContext(initial.current.roomId, { sourceMessageId: source.id, ...passage }, { signal });
      check();
      branchKey.current ??= offer ? roomPrivateOfferKey(initial.current.accountId, initial.current.roomId, offer.id)
        : JSON.stringify(["room-private-branch", initial.current.accountId, initial.current.roomId, crypto.randomUUID()]);
      const key = offer ? branchKey.current : `${branchKey.current}:${passage.sourceHash}:${passage.start}:${passage.end}`;
      const sessionId = await dependencies.createSession(context, { question, key });
      check();
      if (offer && current.current.room.privateForkOffers.find(item => item.id === offer.id)?.status === "pending") {
        await mutate({ type: "private-fork.resolve", offerId: offer.id, action: "open" });
        check();
      }
      await onOpenChat(sessionId, question);
    }} />;
}

/** This panel receives a recipient projection and also filters explicitly at the UI boundary. */
export function RoomPrivateForkOffers({ snapshot, mutate, onOpenChat, dependencies = production }: {
  snapshot: RoomViewerSnapshot;
  mutate: Mutate;
  onOpenChat: OpenChat;
  dependencies?: RoomPrivateForkDependencies;
}) {
  const [chosen, setChosen] = useState<{ offer: RoomPrivateForkOffer; context: RoomPrivateForkContext } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const focusOffer = useRef<string | null>(null);
  const current = useRef(snapshot);
  current.current = snapshot;
  const identity = `${snapshot.room.id}:${snapshot.viewer.accountId}:${JSON.stringify(snapshot.viewer)}`;
  const offers = isPrivateForkLearner(snapshot) ? snapshot.room.privateForkOffers.filter(offer => offer.learnerAccountId === snapshot.viewer.accountId && offer.status !== "dismissed") : [];
  const visibleIdentity = JSON.stringify(offers.map(offer => [offer.id, offer.status, offer.sourceMessageId, offer.sourceHash, offer.start, offer.end, offer.selectedText]));
  useLayoutEffect(() => {
    pending.current?.abort(); pending.current = null; setBusy(null); setError("");
    setChosen(null);
    return () => { pending.current?.abort(); };
  }, [identity]);
  useLayoutEffect(() => {
    if (busy && !offers.some(offer => offer.id === busy)) { pending.current?.abort(); pending.current = null; setBusy(null); }
  }, [visibleIdentity, busy]);
  const cancel = () => {
    focusOffer.current = chosen?.offer.id ?? busy;
    pending.current?.abort(); pending.current = null; setBusy(null); setChosen(null); setError("");
  };
  const act = async (offer: RoomPrivateForkOffer, action: "review" | "dismiss") => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(offer.id); setError("");
    try {
      if (action === "dismiss") await mutate({ type: "private-fork.resolve", offerId: offer.id, action: "dismiss" });
      else {
        const context = await dependencies.getContext(snapshot.room.id, { sourceMessageId: offer.sourceMessageId,
          ...(offer.selectedText !== undefined ? { selectedText: offer.selectedText } : {}),
          ...(offer.start !== undefined ? { start: offer.start } : {}), ...(offer.end !== undefined ? { end: offer.end } : {}),
          ...(offer.sourceHash ? { sourceHash: offer.sourceHash } : {}) }, { signal: controller.signal });
        if (!controller.signal.aborted && current.current.room.privateForkOffers.some(item => item.id === offer.id && item.status !== "dismissed" && item.learnerAccountId === current.current.viewer.accountId)) setChosen({ offer, context });
      }
    } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause, "The offer could not be opened. Try again.")); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(null); } }
  };
  if (!offers.length) return null;
  const activeOffer = chosen && offers.find(offer => offer.id === chosen.offer.id);
  const source = chosen?.context.messages.find(message => message.id === chosen.offer.sourceMessageId);
  return <section aria-label="Your private study offers" className={css({ p: "0.75rem", borderBottom: "1px solid var(--ink)", display: "grid", gap: "0.65rem", maxH: "55vh", overflowY: "auto", flexShrink: 0 })}>
    <h2 className={s.heading}>Your private study offers</h2>
    <p className={s.help}>Only you receive these offers. Opening one is your choice.</p>
    {activeOffer && source ? <RoomPrivateFork key={activeOffer.id} snapshot={snapshot} source={source} offer={activeOffer}
      mutate={mutate} onCancel={cancel} onOpenChat={onOpenChat} dependencies={dependencies} />
      : <ul className={css({ display: "grid", gap: "0.65rem" })}>{offers.map(offer => {
        const message = snapshot.room.messages.find(item => item.id === offer.sourceMessageId);
        let preview = "Earlier public message. Review the source before opening.";
        if (message && canContinueRoomMessage(snapshot, message)) {
          try { preview = resolvePrivateForkPassage(message.body, offer).quote; } catch { preview = "The source changed. Review it to check availability."; }
        }
        return <li key={offer.id} className={css({ display: "grid", gap: "0.35rem" })}>
          <p className={css({ fontSize: "0.8rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxH: "6rem", overflowY: "auto" })}>{preview}</p>
          <div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
            <button ref={node => { if (node && focusOffer.current === offer.id) { node.focus(); focusOffer.current = null; } }} type="button" className={s.button} disabled={Boolean(busy)} onClick={() => void act(offer, "review")}>{busy === offer.id ? "Checking…" : offer.status === "opened" ? "Reopen private Chat" : "Review private offer"}</button>
            {offer.status === "pending" ? <button type="button" className={s.button} disabled={Boolean(busy)} onClick={() => void act(offer, "dismiss")}>Dismiss offer</button> : null}
          </div>
        </li>;
      })}</ul>}
    {error ? <p role="alert" className={s.error}>{error} Review the offer to try again.</p> : null}
    {busy ? <button type="button" className={s.button} onClick={cancel}>Cancel</button> : null}
  </section>;
}
