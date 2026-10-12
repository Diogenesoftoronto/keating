import { useEffect, useRef, useState } from "react";
import { beginNotOrganicAuthorization, getNotOrganicAccount, notOrganicPublicClient } from "../notorganic-provider";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../keating/model-prefs";
import { connectLearningProfile, restoreLearningProfileSession } from "../keating/learning-profile-oauth";
import { LearningProfilePublisher, type PublicLearningProfile } from "../keating/public-learning-profile";
import "./learning-profile.css";

export function LearningProfile() {
  const [did, setDid] = useState<string | null>(null);
  const [publisher, setPublisher] = useState<LearningProfilePublisher | null>(null);
  const [published, setPublished] = useState<PublicLearningProfile | null | undefined>(undefined);
  const [topics, setTopics] = useState("");
  const [count, setCount] = useState<number | undefined>();
  const [includeCount, setIncludeCount] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const current = ++generation.current;
      request.current?.abort();
      request.current = new AbortController();
      const signal = request.current.signal;
      setPublisher(null); setDid(null); setPublished(undefined); setTopics(""); setIncludeCount(false); setConsent(false); setMessage(""); setBusy(true);
      try {
        const client = notOrganicPublicClient();
        const identity = client?.getSession()?.id;
        // The dedicated callback must finish even if the product login has expired.
        const [session, account] = await Promise.all([
          restoreLearningProfileSession(),
          identity ? getNotOrganicAccount() : Promise.resolve(null),
        ]);
        if (disposed || current !== generation.current || signal.aborted) return;
        if (!identity || !account?.did || client?.getSession()?.id !== identity) {
          setMessage("Sign in to your Not Organic account with a verified AT Protocol identity to continue.");
          return;
        }
        setDid(account.did);
        if (!session || session.sub !== account.did) {
          setMessage(session ? "Reconnect the PDS that belongs to this Not Organic account." : "Connect your PDS, then review exactly what you want to make public.");
          return;
        }
        const next = new LearningProfilePublisher(session, {
          did: account.did,
          isCurrent: () => !disposed && current === generation.current && client?.getSession()?.id === identity,
        });
        setPublisher(next);
        const record = await next.read(signal);
        if (disposed || current !== generation.current) return;
        setPublished(record); setTopics(record?.topics.join("\n") ?? "");
        setMessage(record ? "Your profile is public. Review changes before publishing again." : "Your learning profile is private.");
      } catch (error) {
        if (!disposed && current === generation.current) setMessage(error instanceof Error ? error.message : "Could not load your public profile.");
      } finally {
        if (!disposed && current === generation.current) setBusy(false);
      }
    };
    void load();
    window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, load);
    return () => { disposed = true; generation.current++; request.current?.abort(); window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, load); };
  }, []);

  useEffect(() => {
    let disposed = false;
    // Read only the session metadata count. Nothing from this store is sent until explicit consent.
    void import("../hooks/keating-storage").then(({ sessions }) => sessions.getAllMetadata()).then((items) => {
      if (!disposed) setCount(items.filter(item => !item.hiddenAlternative).length);
    }).catch(() => { /* The user can still publish labels without a count. */ });
    return () => { disposed = true; };
  }, []);

  const perform = async (operation: (commit: (update: () => void) => void) => Promise<void>, changesPublicState = false) => {
    const current = generation.current;
    setBusy(true); setMessage("");
    try { await operation(update => { if (current === generation.current) update(); }); }
    catch (error) {
      if (current === generation.current) {
        if (changesPublicState) { setPublished(undefined); setConsent(false); }
        setMessage(error instanceof Error ? error.message : "The request failed. Public status could not be confirmed.");
      }
    }
    finally { if (current === generation.current) setBusy(false); }
  };

  return <main className="learning-profile">
    <a href="/">← Back to Keating</a>
    <h1>Your public learning profile</h1>
    <p>Choose a few topics to share with your site and other apps. Your profile lives on your AT Protocol PDS, under your identity.</p>
    <p className="learning-profile-note">This publishes only the labels below and, if selected, a count of saved sessions. Conversations, answers, grades, and private learner records stay private. This summary is authored by you; achievements verified by Not Organic are separate.</p>
    {did && <p className="learning-profile-did">Publishing identity: <code>{did}</code></p>}
    {!did && !busy && <button type="button" onClick={() => void perform(() => beginNotOrganicAuthorization("/review/learning-profile"))}>Sign in to Not Organic</button>}
    {did && <button type="button" disabled={busy} onClick={() => void perform(async () => { await connectLearningProfile(did); })}>{publisher ? "Reconnect PDS permissions" : "Connect my PDS"}</button>}
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!publisher) return;
      void perform(async (commit) => {
        const record = await publisher.publish({ topics: topics.split("\n").map(label => label.trim()).filter(Boolean), ...(includeCount ? { savedSessions: count } : {}), consent }, request.current?.signal);
        commit(() => { setPublished(record); setConsent(false); setMessage("Your learning profile is now public on your PDS."); });
      }, true);
    }}>
      <label htmlFor="public-learning-topics">Public topic labels</label>
      <textarea id="public-learning-topics" rows={7} maxLength={1620} value={topics} disabled={!publisher || busy} onChange={event => { setTopics(event.target.value); setConsent(false); }} placeholder={"One short topic per line, up to 20\nFor example: Bayesian reasoning"} />
      <label className="learning-profile-choice"><input type="checkbox" checked={includeCount} disabled={!publisher || busy || count === undefined} onChange={event => { setIncludeCount(event.target.checked); setConsent(false); }} /> Include {count === undefined ? "saved-session count (unavailable on this device)" : `${count} saved sessions on this device`}</label>
      {published?.activity && <p className="learning-profile-note">Currently published: {published.activity.savedSessions} saved sessions. The next publication replaces this count with your choice above.</p>}
      <label className="learning-profile-choice"><input type="checkbox" checked={consent} disabled={!publisher || busy} onChange={event => setConsent(event.target.checked)} /> I want these labels and the selected count to be public and readable by other apps.</label>
      <div className="learning-profile-actions">
        <button type="submit" disabled={!publisher || busy || !consent || (includeCount && count === undefined)}>{published ? "Publish changes" : "Publish my profile"}</button>
        <button type="button" disabled={!publisher || busy || published === null} onClick={() => void perform(async (commit) => {
          await publisher!.remove(request.current?.signal);
          commit(() => { setPublished(null); setConsent(false); setMessage("Your public topics and count were removed from your PDS. Other apps may retain copies they already read."); });
        }, true)}>Make private</button>
        <button type="button" disabled={busy} onClick={() => window.location.reload()}>Reload status</button>
      </div>
    </form>
    <p role="status" aria-live="polite">{busy ? "Working…" : message}</p>
    {published && did && <p className="learning-profile-note">Public record: <code>at://{did}/app.keating.learningProfile/self</code></p>}
    <p className="learning-profile-note">Updates are manual: publishing replaces your previous summary. Making it private removes your public labels and count; already collected copies may remain elsewhere.</p>
  </main>;
}
