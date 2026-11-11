import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { beginNotOrganicAuthorization, getNotOrganicAccount, notOrganicPublicClient } from "../notorganic-provider";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../keating/model-prefs";
import { connectLearningProfile, restoreLearningProfileSession } from "../keating/learning-profile-oauth";
import { LearningProfilePublisher } from "../keating/public-learning-profile";
import {
	PROFILE_ACCENTS,
	PROFILE_LAYOUTS,
	PROFILE_LIMITS,
	PROFILE_SECTION_LABELS,
	ProfileValidationError,
	WORK_KINDS,
	WORK_KIND_LABELS,
	isEmptyProfile,
	publicProfileContent,
	publicProfilePath,
	type FullLearningProfile,
	type ProfileAccent,
	type ProfileLayout,
	type PublicProfileContent,
	type WorkKind,
} from "../keating/public-profile-contract";
import {
	EMPTY_PROFILE_DRAFT,
	clearProfileDraft,
	draftFromProfile,
	draftToInput,
	loadProfileDraft,
	saveProfileDraft,
	type ProfileDraft,
} from "../keating/public-profile-draft";
import { Nav } from "../components/Nav";
import { PublicProfileView } from "../components/profile/PublicProfileView";
import "../components/profile/public-profile.css";

const ACCENT_LABELS: Record<ProfileAccent, string> = { ink: "Ink", moss: "Moss", ember: "Ember", tide: "Tide", plum: "Plum" };
const LAYOUT_LABELS: Record<ProfileLayout, string> = { stacked: "Open page", cards: "Cards" };

interface SharedSessionChoice { title: string; url: string }

function move<T>(items: T[], index: number, delta: number): T[] {
	const target = index + delta;
	if (target < 0 || target >= items.length) return items;
	const next = [...items];
	[next[index], next[target]] = [next[target]!, next[index]!];
	return next;
}

export function LearningProfile() {
	const [did, setDid] = useState<string | null>(null);
	const [publisher, setPublisher] = useState<LearningProfilePublisher | null>(null);
	// undefined: status unknown. null: confirmed private. Otherwise the published profile.
	const [published, setPublished] = useState<FullLearningProfile | null | undefined>(undefined);
	const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE_DRAFT);
	const [draftSaved, setDraftSaved] = useState(true);
	const [count, setCount] = useState<number | undefined>();
	const [shares, setShares] = useState<SharedSessionChoice[]>([]);
	const [consent, setConsent] = useState(false);
	const [busy, setBusy] = useState(true);
	const [message, setMessage] = useState("");
	const [tab, setTab] = useState<"edit" | "preview">("edit");
	const [copied, setCopied] = useState(false);
	const request = useRef<AbortController | null>(null);
	const generation = useRef(0);
	const draftOwner = useRef<string | null>(null);

	useEffect(() => {
		let disposed = false;
		const load = async () => {
			const current = ++generation.current;
			request.current?.abort();
			request.current = new AbortController();
			const signal = request.current.signal;
			setPublisher(null); setDid(null); setPublished(undefined); setConsent(false); setMessage(""); setBusy(true);
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
				draftOwner.current = account.did;
				const saved = loadProfileDraft(account.did);
				if (saved) setDraft(saved);
				if (!session || session.sub !== account.did) {
					setMessage(session ? "Reconnect the PDS that belongs to this Not Organic account." : "Connect your PDS to publish. You can write and preview your profile first.");
					return;
				}
				const next = new LearningProfilePublisher(session, {
					did: account.did,
					isCurrent: () => !disposed && current === generation.current && client?.getSession()?.id === identity,
				});
				setPublisher(next);
				const record = await next.readProfile(signal);
				if (disposed || current !== generation.current) return;
				setPublished(record);
				// An unsaved draft on this device wins over what is published; otherwise start from the public version.
				if (!saved && record) setDraft(draftFromProfile(record));
				setMessage(record
					? saved ? "Your profile is public. You have unpublished edits on this device." : "Your profile is public. Edits stay on this device until you publish them."
					: "Your learning profile is private. Nothing is public until you publish.");
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
		// Counts and share links are read locally to offer as choices. Nothing is sent until the learner publishes.
		void import("../hooks/keating-storage").then(({ sessions }) => sessions.getAllMetadata()).then((items) => {
			if (!disposed) setCount(items.filter(item => !item.hiddenAlternative).length);
		}).catch(() => { /* The profile can still be published without a count. */ });
		void import("../keating/shared-sessions").then(({ listCachedSharedSessions }) => {
			if (disposed) return;
			const origin = window.location.origin;
			setShares(listCachedSharedSessions()
				// A locally cached share that never reached the server has a long local id and no public page.
				.filter((shared) => /^[A-Za-z0-9_-]{8,32}$/u.test(shared.id))
				.map((shared) => ({ title: shared.title || "Shared session", url: `${origin}/s/${encodeURIComponent(shared.id)}` })));
		}).catch(() => { /* Work can still be added by pasting a link. */ });
		return () => { disposed = true; };
	}, []);

	const update = (change: (draft: ProfileDraft) => ProfileDraft) => {
		setConsent(false);
		setDraft((current) => {
			const next = change(current);
			setDraftSaved(draftOwner.current ? saveProfileDraft(draftOwner.current, next) : false);
			return next;
		});
	};

	const { content, error } = useMemo((): { content: PublicProfileContent | null; error: ProfileValidationError | null } => {
		try {
			return { content: publicProfileContent(draftToInput(draft, count)), error: null };
		} catch (problem) {
			return { content: null, error: problem instanceof ProfileValidationError ? problem : new ProfileValidationError("Something in the profile cannot be published.", "profile") };
		}
	}, [draft, count]);
	const lastGood = useRef<PublicProfileContent | null>(null);
	if (content) lastGood.current = content;
	const preview = content ?? lastGood.current;
	const empty = !content || isEmptyProfile(content);

	const perform = async (operation: (commit: (apply: () => void) => void) => Promise<void>, changesPublicState = false) => {
		const current = generation.current;
		setBusy(true); setMessage("");
		try { await operation(apply => { if (current === generation.current) apply(); }); }
		catch (problem) {
			if (current === generation.current) {
				// After a failed write the public status is unknown, so stop claiming either state.
				if (changesPublicState) { setPublished(undefined); setConsent(false); }
				setMessage(problem instanceof Error ? problem.message : "The request failed. Public status could not be confirmed.");
			}
		}
		finally { if (current === generation.current) setBusy(false); }
	};

	const publicUrl = did ? `${window.location.origin}${publicProfilePath(did)}` : "";
	const fieldError = (field: string) => error?.field === field ? <p className="profile-editor__error" role="alert">{error.message}</p> : null;
	const unusedShares = shares.filter((share) => !draft.work.some((item) => item.url.trim() === share.url));

	return <div className="profile-shell retro-layout retro-page">
	<Nav />
	<main className="profile-editor">
		<div className="profile-editor__top">
			<h1>Your public learning profile</h1>
		</div>
		<p className="profile-editor__lede">Say what you are learning, show work you are proud of, and choose how the page looks. You decide every word that appears. Conversations, answers, grades and learner records are never added for you.</p>

		<section className="profile-editor__account" aria-label="Account and publishing status">
			{did ? <p>Publishing identity: <code>{did}</code></p> : !busy && <p>Sign in to connect the identity your profile is published under.</p>}
			<div className="profile-page__actions" style={{ marginTop: 0 }}>
				{!did && !busy && <button type="button" className="profile-button profile-button--primary" onClick={() => void perform(() => beginNotOrganicAuthorization("/review/learning-profile"))}>Sign in to Not Organic</button>}
				{did && <button type="button" className="profile-button" disabled={busy} onClick={() => void perform(async () => { await connectLearningProfile(did); })}>{publisher ? "Reconnect PDS permissions" : "Connect my PDS"}</button>}
				{published && did && <a className="profile-button" href={publicProfilePath(did)} target="_blank" rel="noopener">View public page</a>}
			</div>
			<p className="profile-editor__status" role="status" aria-live="polite">{busy ? "Working…" : message}</p>
		</section>

		<div className="profile-editor__tabs" role="tablist" aria-label="Profile editor views" onKeyDown={(event) => {
			// Tabs follow the standard pattern: one tab stop, arrows move between tabs.
			const next = event.key === "Home" ? "edit" : event.key === "End" ? "preview"
				: event.key === "ArrowRight" || event.key === "ArrowLeft" ? (tab === "edit" ? "preview" : "edit") : null;
			if (!next) return;
			event.preventDefault();
			setTab(next);
			document.getElementById(`profile-tab-${next}`)?.focus();
		}}>
			<button type="button" role="tab" id="profile-tab-edit" aria-controls="profile-panel-edit" aria-selected={tab === "edit"} tabIndex={tab === "edit" ? 0 : -1} className="profile-button" onClick={() => setTab("edit")}>Edit</button>
			<button type="button" role="tab" id="profile-tab-preview" aria-controls="profile-panel-preview" aria-selected={tab === "preview"} tabIndex={tab === "preview" ? 0 : -1} className="profile-button" onClick={() => setTab("preview")}>Preview</button>
		</div>

		<div className="profile-editor__grid" data-tab={tab}>
			<form id="profile-panel-edit" aria-labelledby="profile-tab-edit" onSubmit={(event) => {
				event.preventDefault();
				if (!publisher || !content || empty) return;
				void perform(async (commit) => {
					const record = await publisher.publishProfile({ ...draftToInput(draft, count), consent }, request.current?.signal);
					commit(() => {
						setPublished(record); setConsent(false);
						if (draftOwner.current) clearProfileDraft(draftOwner.current);
						setDraft(draftFromProfile(record)); setDraftSaved(true);
						setMessage("Your learning profile is now public.");
					});
				}, true);
			}}>
				<fieldset>
					<legend>About you</legend>
					<label className="profile-editor__field"><span>Name to show</span>
						<input type="text" maxLength={PROFILE_LIMITS.displayName} value={draft.displayName} onChange={event => update(d => ({ ...d, displayName: event.target.value }))} autoComplete="nickname" />
					</label>
					{fieldError("displayName")}
					<label className="profile-editor__field"><span>Headline</span>
						<input type="text" maxLength={PROFILE_LIMITS.headline} value={draft.headline} onChange={event => update(d => ({ ...d, headline: event.target.value }))} placeholder="For example: Working through transformers from first principles" />
					</label>
					{fieldError("headline")}
					<label className="profile-editor__field"><span>About</span>
						<textarea maxLength={PROFILE_LIMITS.about} rows={4} value={draft.about} onChange={event => update(d => ({ ...d, about: event.target.value }))} />
						<span className="profile-editor__hint" aria-live="polite" data-near={draft.about.length > PROFILE_LIMITS.about * 0.9 || undefined}>Plain text. {draft.about.length} of {PROFILE_LIMITS.about} characters.</span>
					</label>
					{fieldError("about")}
				</fieldset>

				<fieldset>
					<legend>Learning now</legend>
					<p className="profile-editor__hint">What you are studying and what you want to be able to do. Up to {PROFILE_LIMITS.learning}.</p>
					{draft.learning.map((item, index) => <div className="profile-editor__row" key={index}>
						<div className="profile-editor__row-head"><strong>Item {index + 1}</strong>
							<button type="button" className="profile-button profile-button--quiet" onClick={() => update(d => ({ ...d, learning: d.learning.filter((_, i) => i !== index) }))}><Trash2 size={14} aria-hidden="true" /> Remove<span className="public-profile__sr"> learning item {index + 1}</span></button>
						</div>
						<label className="profile-editor__field"><span>What you are learning</span>
							<input type="text" maxLength={PROFILE_LIMITS.learningTopic} value={item.topic} onChange={event => update(d => ({ ...d, learning: d.learning.map((entry, i) => i === index ? { ...entry, topic: event.target.value } : entry) }))} />
						</label>
						<label className="profile-editor__field"><span>Goal (optional)</span>
							<input type="text" maxLength={PROFILE_LIMITS.learningGoal} value={item.goal} onChange={event => update(d => ({ ...d, learning: d.learning.map((entry, i) => i === index ? { ...entry, goal: event.target.value } : entry) }))} />
						</label>
					</div>)}
					{fieldError("learning")}
					<button type="button" className="profile-button" disabled={draft.learning.length >= PROFILE_LIMITS.learning} onClick={() => update(d => ({ ...d, learning: [...d.learning, { topic: "", goal: "" }] }))}><Plus size={14} aria-hidden="true" /> Add something you are learning</button>
				</fieldset>

				<fieldset>
					<legend>Topics</legend>
					<label className="profile-editor__field"><span>Topic labels, one per line</span>
						<textarea rows={5} maxLength={1620} value={draft.topics} onChange={event => update(d => ({ ...d, topics: event.target.value }))} placeholder={"Bayesian reasoning\nAttention mechanisms"} />
						<span className="profile-editor__hint">Up to {PROFILE_LIMITS.topics} short labels.</span>
					</label>
					{fieldError("topics")}
				</fieldset>

				<fieldset>
					<legend>Shared work</legend>
					<p className="profile-editor__hint">Link to work that is already public: a session you shared, an assignment write-up, notes or a project. Adding a link here never shares the conversation behind it.</p>
					{draft.work.map((item, index) => <div className="profile-editor__row" key={index}>
						<div className="profile-editor__row-head"><strong>Work {index + 1}</strong>
							<span>
								<button type="button" className="profile-button profile-button--quiet" disabled={index === 0} onClick={() => update(d => ({ ...d, work: move(d.work, index, -1) }))}><ArrowUp size={14} aria-hidden="true" /><span className="public-profile__sr">Move work {index + 1} up</span></button>
								<button type="button" className="profile-button profile-button--quiet" disabled={index === draft.work.length - 1} onClick={() => update(d => ({ ...d, work: move(d.work, index, 1) }))}><ArrowDown size={14} aria-hidden="true" /><span className="public-profile__sr">Move work {index + 1} down</span></button>
								<button type="button" className="profile-button profile-button--quiet" onClick={() => update(d => ({ ...d, work: d.work.filter((_, i) => i !== index) }))}><Trash2 size={14} aria-hidden="true" /> Remove<span className="public-profile__sr"> work {index + 1}</span></button>
							</span>
						</div>
						<label className="profile-editor__field"><span>Kind</span>
							<select value={item.kind} onChange={event => update(d => ({ ...d, work: d.work.map((entry, i) => i === index ? { ...entry, kind: event.target.value as WorkKind } : entry) }))}>
								{WORK_KINDS.map(kind => <option key={kind} value={kind}>{WORK_KIND_LABELS[kind]}</option>)}
							</select>
						</label>
						<label className="profile-editor__field"><span>Title</span>
							<input type="text" maxLength={PROFILE_LIMITS.workTitle} value={item.title} onChange={event => update(d => ({ ...d, work: d.work.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry) }))} />
						</label>
						<label className="profile-editor__field"><span>Public link</span>
							<input type="url" inputMode="url" maxLength={PROFILE_LIMITS.url} value={item.url} onChange={event => update(d => ({ ...d, work: d.work.map((entry, i) => i === index ? { ...entry, url: event.target.value } : entry) }))} placeholder="https://" />
						</label>
						<label className="profile-editor__field"><span>Your note (optional)</span>
							<textarea rows={2} maxLength={PROFILE_LIMITS.workNote} value={item.note} onChange={event => update(d => ({ ...d, work: d.work.map((entry, i) => i === index ? { ...entry, note: event.target.value } : entry) }))} />
						</label>
						<label className="profile-editor__field"><span>Tutor feedback to show (optional)</span>
							<textarea rows={2} maxLength={PROFILE_LIMITS.workFeedback} value={item.tutorFeedback} onChange={event => update(d => ({ ...d, work: d.work.map((entry, i) => i === index ? { ...entry, tutorFeedback: event.target.value } : entry) }))} />
							<span className="profile-editor__hint">Paste only the feedback you want public. It is shown with a “Keating’s AI feedback” label.</span>
						</label>
					</div>)}
					{fieldError("work")}
					<div className="profile-page__actions" style={{ marginTop: 0 }}>
						<button type="button" className="profile-button" disabled={draft.work.length >= PROFILE_LIMITS.work} onClick={() => update(d => ({ ...d, work: [...d.work, { kind: "project", title: "", url: "", note: "", tutorFeedback: "" }] }))}><Plus size={14} aria-hidden="true" /> Add work</button>
						{unusedShares.length > 0 && draft.work.length < PROFILE_LIMITS.work && <label className="profile-editor__field" style={{ flex: "1 1 14rem" }}>
							<span>Or add a session you already shared</span>
							<select value="" onChange={event => {
								const share = unusedShares.find(candidate => candidate.url === event.target.value);
								if (share) update(d => ({ ...d, work: [...d.work, { kind: "session", title: share.title.slice(0, PROFILE_LIMITS.workTitle), url: share.url, note: "", tutorFeedback: "" }] }));
							}}>
								<option value="">Choose a shared session…</option>
								{unusedShares.map(share => <option key={share.url} value={share.url}>{share.title}</option>)}
							</select>
						</label>}
					</div>
				</fieldset>

				<fieldset>
					<legend>Next steps</legend>
					<label className="profile-editor__field"><span>What you plan to do next, one per line</span>
						<textarea rows={3} maxLength={1300} value={draft.nextSteps} onChange={event => update(d => ({ ...d, nextSteps: event.target.value }))} />
						<span className="profile-editor__hint">Up to {PROFILE_LIMITS.nextSteps}.</span>
					</label>
					{fieldError("nextSteps")}
				</fieldset>

				<fieldset>
					<legend>Links</legend>
					{draft.links.map((link, index) => <div className="profile-editor__row" key={index}>
						<div className="profile-editor__row-head"><strong>Link {index + 1}</strong>
							<button type="button" className="profile-button profile-button--quiet" onClick={() => update(d => ({ ...d, links: d.links.filter((_, i) => i !== index) }))}><Trash2 size={14} aria-hidden="true" /> Remove<span className="public-profile__sr"> link {index + 1}</span></button>
						</div>
						<label className="profile-editor__field"><span>Label</span>
							<input type="text" maxLength={PROFILE_LIMITS.linkLabel} value={link.label} onChange={event => update(d => ({ ...d, links: d.links.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry) }))} />
						</label>
						<label className="profile-editor__field"><span>Address</span>
							<input type="url" inputMode="url" maxLength={PROFILE_LIMITS.url} value={link.url} onChange={event => update(d => ({ ...d, links: d.links.map((entry, i) => i === index ? { ...entry, url: event.target.value } : entry) }))} placeholder="https://" />
						</label>
					</div>)}
					{fieldError("links")}
					<button type="button" className="profile-button" disabled={draft.links.length >= PROFILE_LIMITS.links} onClick={() => update(d => ({ ...d, links: [...d.links, { label: "", url: "" }] }))}><Plus size={14} aria-hidden="true" /> Add a link</button>
				</fieldset>

				<fieldset>
					<legend>Look and layout</legend>
					<div className="profile-editor__field" role="radiogroup" aria-label="Accent colour">
						<span>Accent colour</span>
						<div className="profile-editor__swatches">
							{PROFILE_ACCENTS.map(accent => <label key={accent} className="profile-swatch" data-accent={accent}><input type="radio" name="profile-accent" checked={draft.appearance.accent === accent} onChange={() => update(d => ({ ...d, appearance: { ...d.appearance, accent } }))} /><span className="profile-swatch__dot" aria-hidden="true" /> {ACCENT_LABELS[accent]}</label>)}
						</div>
					</div>
					<div className="profile-editor__field" role="radiogroup" aria-label="Layout">
						<span>Layout</span>
						<div className="profile-editor__swatches">
							{PROFILE_LAYOUTS.map(layout => <label key={layout}><input type="radio" name="profile-layout" checked={draft.appearance.layout === layout} onChange={() => update(d => ({ ...d, appearance: { ...d.appearance, layout } }))} /> {LAYOUT_LABELS[layout]}</label>)}
						</div>
					</div>
					<div className="profile-editor__field">
						<span id="profile-order-label">Sections: tick to show, use the arrows to reorder</span>
						<ol className="profile-editor__order" aria-labelledby="profile-order-label">
							{draft.sectionOrder.map((section, index) => <li key={section}>
								<label><input type="checkbox" checked={!draft.hiddenSections.includes(section)} onChange={event => update(d => ({ ...d, hiddenSections: event.target.checked ? d.hiddenSections.filter(name => name !== section) : [...d.hiddenSections, section] }))} /> {PROFILE_SECTION_LABELS[section]}</label>
								<button type="button" className="profile-button" disabled={index === 0} onClick={() => update(d => ({ ...d, sectionOrder: move(d.sectionOrder, index, -1) }))}><ArrowUp size={14} aria-hidden="true" /><span className="public-profile__sr">Move {PROFILE_SECTION_LABELS[section]} up</span></button>
								<button type="button" className="profile-button" disabled={index === draft.sectionOrder.length - 1} onClick={() => update(d => ({ ...d, sectionOrder: move(d.sectionOrder, index, 1) }))}><ArrowDown size={14} aria-hidden="true" /><span className="public-profile__sr">Move {PROFILE_SECTION_LABELS[section]} down</span></button>
							</li>)}
						</ol>
					</div>
					<label className="profile-editor__check"><input type="checkbox" checked={draft.includeCount} disabled={count === undefined} onChange={event => update(d => ({ ...d, includeCount: event.target.checked }))} /> <span>Show {count === undefined ? "a saved-session count (unavailable on this device)" : `that I have ${count} saved ${count === 1 ? "session" : "sessions"} on this device`}</span></label>
					{fieldError("appearance")}
				</fieldset>

				<section className="profile-editor__publish" aria-labelledby="profile-publish-heading">
					<h2 id="profile-publish-heading">Publish</h2>
					{error && !["displayName", "headline", "about", "learning", "topics", "work", "nextSteps", "links", "appearance"].includes(error.field) && <p className="profile-editor__error" role="alert">{error.message}</p>}
					{error && <p className="profile-editor__hint">Fix the highlighted field to publish. The preview shows your last valid version.</p>}
					{!draftSaved && <p className="profile-editor__error" role="alert">Your edits could not be saved on this device. They stay on screen, but will be lost if you leave this page before publishing.</p>}
					<p className="profile-editor__hint">The preview is exactly what becomes public: readable by anyone, and stored on your PDS where other apps can read it too.</p>
					<label className="profile-editor__check"><input type="checkbox" checked={consent} disabled={!publisher || busy || !!error || empty} onChange={event => setConsent(event.target.checked)} /> <span>I have checked the preview and want everything in it to be public.</span></label>
					<div className="profile-page__actions" style={{ marginTop: 0 }}>
						<button type="submit" className="profile-button profile-button--primary" disabled={!publisher || busy || !consent || !!error || empty}>{published ? "Publish changes" : "Publish my profile"}</button>
						<button type="button" className="profile-button" disabled={!publisher || busy || published === null} onClick={() => void perform(async (commit) => {
							await publisher!.remove(request.current?.signal);
							commit(() => { setPublished(null); setConsent(false); setMessage("Your profile was removed from your PDS and from Keating. Other apps may keep copies they already read."); });
						}, true)}>Make private</button>
						<button type="button" className="profile-button" disabled={busy} onClick={() => {
							if (draftOwner.current) clearProfileDraft(draftOwner.current);
							setDraft(published ? draftFromProfile(published) : EMPTY_PROFILE_DRAFT); setDraftSaved(true); setConsent(false);
						}}>{published ? "Discard my edits" : "Clear the form"}</button>
						<button type="button" className="profile-button profile-button--quiet" disabled={busy} onClick={() => window.location.reload()}>Reload status</button>
					</div>
					{!publisher && did && <p className="profile-editor__hint">Connect your PDS above to enable publishing.</p>}
					{published && did && <div className="profile-editor__share">
						<span>Public page:</span> <code>{publicUrl}</code>
						<button type="button" className="profile-button" onClick={() => { void navigator.clipboard?.writeText(publicUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy link"}</button>
						<span role="status" className="public-profile__sr">{copied ? "Link copied" : ""}</span>
					</div>}
					<p className="profile-editor__hint">Making your profile private removes it from your PDS. Keating stops showing it within about a minute; copies other apps already read may remain.</p>
				</section>
			</form>

			<aside id="profile-panel-preview" role="tabpanel" className="profile-editor__preview" aria-labelledby="profile-tab-preview">
				<p className="profile-editor__preview-label">Preview: what visitors will see</p>
				{preview
					? <PublicProfileView profile={preview} identity={did ?? undefined} preview />
					: <p className="public-profile__empty">Fix the highlighted field to see the preview.</p>}
			</aside>
		</div>
	</main>
	</div>;
}
