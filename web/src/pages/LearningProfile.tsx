import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE, SOFT, useMotionAllowed } from "../design-system/motion";
import { KeatingGlyph } from "../design-system/glyphs";
import { AppBar, Button, Chip, EmptyState, Loading, IconButton, Segmented, StatusDot, Tabs } from "../design-system/kit";
import "./learning-profile.css";
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
	type ProfileSection,
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
import { ProfileAvatar, PublicProfileView } from "../components/profile/PublicProfileView";
import { preparePublicProfileImage, PROFILE_IMAGE_ACCEPT } from "../keating/public-profile-image";
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
	const animate = useMotionAllowed();
	const [did, setDid] = useState<string | null>(null);
	const [handle, setHandle] = useState<string | null>(null);
	const [publisher, setPublisher] = useState<LearningProfilePublisher | null>(null);
	// undefined: status unknown. null: confirmed private. Otherwise the published profile.
	const [published, setPublished] = useState<FullLearningProfile | null | undefined>(undefined);
	const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE_DRAFT);
	const [draftSaved, setDraftSaved] = useState(true);
	const [count, setCount] = useState<number | undefined>();
	const [shares, setShares] = useState<SharedSessionChoice[]>([]);
	const [consent, setConsent] = useState(false);
	const [busy, setBusy] = useState(true);
	const [imageError, setImageError] = useState("");
	const imageInput = useRef<HTMLInputElement>(null);
	const [message, setMessage] = useState("");
	const [tab, setTab] = useState("profile-panel-edit");
	const [copyState, setCopyState] = useState("");
	type EditorSection = ProfileSection | "look";
	const [open, setOpen] = useState<EditorSection[]>(["about", "look"]);
	const focusAfterOpen = useRef<string | null>(null);
	useEffect(() => {
		if (focusAfterOpen.current) document.querySelector<HTMLElement>(focusAfterOpen.current)?.focus({ preventScroll: true });
		focusAfterOpen.current = null;
	}, [open]);
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
			draftOwner.current = null; setDraft(EMPTY_PROFILE_DRAFT); setDraftSaved(true);
			setPublisher(null); setDid(null); setHandle(null); setPublished(undefined); setConsent(false); setMessage(""); setImageError(""); setBusy(true);
			try {
				const client = notOrganicPublicClient();
				const identity = client?.getSession()?.id;
				// The dedicated callback must finish even if the product login has expired.
				const [connection, account] = await Promise.all([
					restoreLearningProfileSession().then(
						session => ({ session, error: null }),
						(error: Error) => ({ session: null, error: error.message }),
					),
					identity ? getNotOrganicAccount() : Promise.resolve(null),
				]);
				if (disposed || current !== generation.current || signal.aborted) return;
				if (!identity || !account?.did || client?.getSession()?.id !== identity) {
					setMessage("Sign in to your Not Organic account with a verified AT Protocol identity to continue.");
					return;
				}
				setDid(account.did);
				const publicHandle = typeof account.handle === "string" ? account.handle.trim().replace(/^@/, "") : "";
				setHandle(publicHandle.includes(".") && /^[a-z0-9.-]+$/i.test(publicHandle) && publicHandle.toLowerCase() !== "handle.invalid" ? publicHandle : null);
				// A draft never follows the learner to a different account: the image and text belong to the identity they were written under.
				const switchedAccount = draftOwner.current !== null && draftOwner.current !== account.did;
				draftOwner.current = account.did;
				const saved = loadProfileDraft(account.did);
				if (saved || switchedAccount) setDraft(saved ?? EMPTY_PROFILE_DRAFT);
				const { session, error: connectionError } = connection;
				if (connectionError) {
					setMessage(connectionError);
					return;
				}
				if (!session || session.sub !== account.did) {
					setMessage(session ? "Reconnect using the same AT Protocol account you use with Not Organic." : "Connect your account to publish. You can write and preview your profile first.");
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
					? "Your profile is public. Edits stay on this device until you publish them."
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

	const unusedShares = shares.filter((share) => !draft.work.some((item) => item.url.trim() === share.url));

	const fields = {
		about: <>
			<div className="profile-editor__field">
				<span id="profile-image-label">Profile image</span>
				<div className="profile-editor__image" role="group" aria-labelledby="profile-image-label" aria-describedby="profile-image-hint">
					<ProfileAvatar avatar={draft.avatar} title={draft.displayName || handle || "Keating"} />
					<div className="profile-editor__image-actions">
						<input ref={imageInput} type="file" accept={PROFILE_IMAGE_ACCEPT} hidden disabled={busy} onChange={event => {
							const file = event.currentTarget.files?.[0];
							event.currentTarget.value = "";
							if (!file) return;
							setImageError("");
							void perform(async (commit) => {
								try {
									const avatar = await preparePublicProfileImage(file);
									commit(() => update(current => ({ ...current, avatar })));
								} catch (problem) {
									commit(() => setImageError(problem instanceof Error ? problem.message : "Couldn’t prepare this image."));
								}
							});
						}} />
						<button type="button" className="profile-button" disabled={busy} onClick={() => imageInput.current?.click()}>{draft.avatar ? "Change image" : "Choose image"}</button>
						{draft.avatar && <button type="button" className="profile-button profile-button--quiet" disabled={busy} onClick={() => {
							setImageError("");
							update(current => ({ ...current, avatar: "" }));
						}}>Remove image</button>}
					</div>
					<p id="profile-image-hint" className="profile-editor__hint">JPEG, PNG or WebP up to 10 MB. Keating crops the image to a square.</p>
				</div>
				{imageError && <p className="profile-editor__error" role="alert">{imageError}</p>}
			</div>

			<div className="pf-field-pair">
				<label className="profile-editor__field"><span>Name to show</span>
				<input type="text" maxLength={PROFILE_LIMITS.displayName} value={draft.displayName} onChange={event => update(d => ({ ...d, displayName: event.target.value }))} autoComplete="nickname" />
			</label>
			<label className="profile-editor__field"><span>Headline</span>
				<input type="text" maxLength={PROFILE_LIMITS.headline} value={draft.headline} onChange={event => update(d => ({ ...d, headline: event.target.value }))} placeholder="For example: Working through transformers from first principles" />
			</label>
			</div>

			<label className="profile-editor__field"><span>About</span>
				<textarea maxLength={PROFILE_LIMITS.about} rows={4} value={draft.about} onChange={event => update(d => ({ ...d, about: event.target.value }))} />
				<span className="profile-editor__hint" aria-live="polite" data-near={draft.about.length > PROFILE_LIMITS.about * 0.9 || undefined}>Plain text. {draft.about.length} of {PROFILE_LIMITS.about} characters.</span>
			</label>
		</>,
		learning: <>
			<p className="profile-editor__hint">What you are studying and what you want to be able to do. Up to {PROFILE_LIMITS.learning}.</p>
			{draft.learning.map((item, index) => <div className="profile-editor__row" key={index}>
				<div className="profile-editor__row-head"><strong>Item {index + 1}</strong>
					<button type="button" className="profile-button profile-button--quiet" onClick={() => update(d => ({ ...d, learning: d.learning.filter((_, i) => i !== index) }))}><KeatingGlyph name="trash" size={14} /> Remove<span className="public-profile__sr"> learning item {index + 1}</span></button>
				</div>
				<label className="profile-editor__field"><span>What you are learning</span>
					<input type="text" maxLength={PROFILE_LIMITS.learningTopic} value={item.topic} onChange={event => update(d => ({ ...d, learning: d.learning.map((entry, i) => i === index ? { ...entry, topic: event.target.value } : entry) }))} />
				</label>
				<label className="profile-editor__field"><span>Goal (optional)</span>
					<input type="text" maxLength={PROFILE_LIMITS.learningGoal} value={item.goal} onChange={event => update(d => ({ ...d, learning: d.learning.map((entry, i) => i === index ? { ...entry, goal: event.target.value } : entry) }))} />
				</label>
			</div>)}

			<button type="button" className="profile-button" disabled={draft.learning.length >= PROFILE_LIMITS.learning} onClick={() => update(d => ({ ...d, learning: [...d.learning, { topic: "", goal: "" }] }))}><KeatingGlyph name="plus" size={14} /> Add something you are learning</button>
		</>,
		topics: <>
			<label className="profile-editor__field"><span>Topic labels, one per line</span>
				<textarea rows={5} maxLength={1620} value={draft.topics} onChange={event => update(d => ({ ...d, topics: event.target.value }))} placeholder={"Bayesian reasoning\nAttention mechanisms"} />
				<span className="profile-editor__hint">Up to {PROFILE_LIMITS.topics} short labels.</span>
			</label>
		</>,
		work: <>
			<p className="profile-editor__hint">Link to work that is already public: a session you shared, an assignment write-up, notes or a project. Adding a link here never shares the conversation behind it.</p>
			{draft.work.map((item, index) => <div className="profile-editor__row" key={index}>
				<div className="profile-editor__row-head"><strong>Work {index + 1}</strong>
					<span>
						<button type="button" className="k-bloom profile-button profile-button--quiet" disabled={index === 0} onClick={() => update(d => ({ ...d, work: move(d.work, index, -1) }))}><KeatingGlyph name="rise" size={14} /><span className="public-profile__sr">Move work {index + 1} up</span></button>
						<button type="button" className="k-bloom profile-button profile-button--quiet" disabled={index === draft.work.length - 1} onClick={() => update(d => ({ ...d, work: move(d.work, index, 1) }))}><KeatingGlyph name="down" size={14} /><span className="public-profile__sr">Move work {index + 1} down</span></button>
						<button type="button" className="profile-button profile-button--quiet" onClick={() => update(d => ({ ...d, work: d.work.filter((_, i) => i !== index) }))}><KeatingGlyph name="trash" size={14} /> Remove<span className="public-profile__sr"> work {index + 1}</span></button>
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

			<div className="profile-page__actions" style={{ marginTop: 0 }}>
				<button type="button" className="profile-button" disabled={draft.work.length >= PROFILE_LIMITS.work} onClick={() => update(d => ({ ...d, work: [...d.work, { kind: "project", title: "", url: "", note: "", tutorFeedback: "" }] }))}><KeatingGlyph name="plus" size={14} /> Add work</button>
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
		</>,
		next: <>
			<label className="profile-editor__field"><span>What you plan to do next, one per line</span>
				<textarea rows={3} maxLength={1300} value={draft.nextSteps} onChange={event => update(d => ({ ...d, nextSteps: event.target.value }))} />
				<span className="profile-editor__hint">Up to {PROFILE_LIMITS.nextSteps}.</span>
			</label>
		</>,
		links: <>
			{draft.links.map((link, index) => <div className="profile-editor__row" key={index}>
				<div className="profile-editor__row-head"><strong>Link {index + 1}</strong>
					<button type="button" className="profile-button profile-button--quiet" onClick={() => update(d => ({ ...d, links: d.links.filter((_, i) => i !== index) }))}><KeatingGlyph name="trash" size={14} /> Remove<span className="public-profile__sr"> link {index + 1}</span></button>
				</div>
				<label className="profile-editor__field"><span>Label</span>
					<input id={"pf-link-label-" + index} type="text" maxLength={PROFILE_LIMITS.linkLabel} value={link.label} onChange={event => update(d => ({ ...d, links: d.links.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry) }))} />
				</label>
				<label className="profile-editor__field"><span>Address</span>
					<input type="url" inputMode="url" maxLength={PROFILE_LIMITS.url} value={link.url} onChange={event => update(d => ({ ...d, links: d.links.map((entry, i) => i === index ? { ...entry, url: event.target.value } : entry) }))} placeholder="https://" />
				</label>
			</div>)}


		</>,
		look: <>
			<div className="profile-editor__field" role="radiogroup" aria-label="Accent colour">
				<span>Accent colour</span>
				<div className="profile-editor__swatches">
					{PROFILE_ACCENTS.map(accent => <label key={accent} className="profile-swatch" data-accent={accent}><input type="radio" name="profile-accent" checked={draft.appearance.accent === accent} onChange={() => update(d => ({ ...d, appearance: { ...d.appearance, accent } }))} /><span className="profile-swatch__dot" aria-hidden="true" /> <span className="pf-swatch-name">{ACCENT_LABELS[accent]}</span></label>)}
				</div>
			</div>
			<Segmented label="Layout" value={draft.appearance.layout} options={PROFILE_LAYOUTS.map(value => ({value, label: LAYOUT_LABELS[value]}))} onChange={layout => update(d => ({...d, appearance: {...d.appearance, layout}}))}/>
			<span id="pf-activity">Activity</span>
			<Chip aria-describedby="pf-activity" as="button" selected={draft.includeCount} disabled={count === undefined} onClick={() => update(d => ({ ...d, includeCount: !d.includeCount }))}>{draft.includeCount && <KeatingGlyph name="check" size={14}/>}Show {count === undefined ? "a saved-session count (unavailable on this device)" : `that I have ${count} saved ${count === 1 ? "session" : "sessions"} on this device`}</Chip>
		</>,
	};
	const changed = !content || (published && JSON.stringify(content) !== JSON.stringify(publicProfileContent({ ...published, savedSessions: published.activity?.savedSessions })));
	const needsReconnect = /reconnect/i.test(message);
	const fieldSections: Record<string, string> = { displayName: "about", headline: "about", nextSteps: "next", appearance: "look" };
	const invalidSection = error && (fieldSections[error.field] ?? error.field);
	const status = busy ? "Working…" : !did ? "Needs sign-in" : needsReconnect ? "Needs reconnect" : !publisher ? "Needs connection" : published === undefined ? "Status unknown" : published ? changed ? "Public · unpublished edits" : "Public" : "Private";
	const subtitle = !did ? "Sign in to connect the identity your profile is published under." : handle ? `Publishing as @${handle}` : "Publishing with your Not Organic account";
	const lineCount = (value: string) => value.split("\n").filter(line => line.trim()).length;
	const counts = { learning: draft.learning.length + " of 8", topics: lineCount(draft.topics) + " of 20", work: draft.work.length + " of 12", next: lineCount(draft.nextSteps) + " of 6", links: draft.links.length + " of 6" };
	return <div className="profile-shell retro-layout retro-page pf-editor">
	<div className="pf-pinned">
		<AppBar back={{ label: "Chat", to: "/chat" }} title="Your public learning profile" subtitle={subtitle}>
			<div className="pf-status" aria-live="polite"><AnimatePresence initial={false}>
				<motion.div key={status} initial={{ opacity: animate ? 0.3 : 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: animate ? DURATION.quick : 0 }}>{busy ? <Loading size="inline" label={status}/> : <span className="pf-status-text"><StatusDot tone={published && changed ? "warn" : "idle"}/>{status}</span>}</motion.div>
			</AnimatePresence></div>
			{published && did && <a href={publicProfilePath(did)} target="_blank" rel="noopener"><KeatingGlyph name="ext" size={14}/> View public page</a>}
			<Chip as="button" selected={consent} disabled={!publisher || needsReconnect || busy || !!error || empty} onClick={() => setConsent(!consent)}>{consent && <KeatingGlyph name="check" size={14}/>}I have checked the preview</Chip>
			{!did ? <Button variant="ghost" disabled={busy} onClick={() => void perform(() => beginNotOrganicAuthorization("/review/learning-profile"))}>Sign in to Not Organic</Button>
			: !publisher || needsReconnect ? <Button variant="ghost" disabled={busy} onClick={() => void perform(() => connectLearningProfile(did))}>{needsReconnect ? "Reconnect account" : "Connect my account"}</Button>
			: <Button type="submit" form="profile-panel-edit" variant="accent" disabled={busy || !consent || !!error || empty}>{published ? "Publish changes" : "Publish my profile"}</Button>}
		</AppBar>
		<p className="pf-notice" role="status">{(error && `${error.message} Fix the highlighted field to publish. The preview shows your last valid version.`) || (!draftSaved ? (draftOwner.current ? "Your edits could not be saved on this device. They stay on screen, but will be lost if you leave this page before publishing." : "You are not signed in, so these edits are only on this page. Sign in before you leave to keep them.") : message)}</p>
	</div>
	<main className="profile-editor">
		<p className="profile-editor__lede">Say what you are learning, show work you are proud of, and choose how the page looks. You decide every word that appears. Conversations, answers, grades and learner records are never added for you.</p>
		<div className="profile-editor__tabs"><Tabs label="Profile editor views" value={tab} onChange={setTab} items={[{id:"profile-panel-edit", label:"Edit"}, {id:"profile-panel-preview", label:"Preview"}]}/></div>
		<div className="profile-editor__grid" data-tab={tab === "profile-panel-edit" ? "edit" : "preview"}>
			<form noValidate id="profile-panel-edit" aria-label="Edit profile" onSubmit={(event) => {
				event.preventDefault();
				if (!publisher || needsReconnect || busy || !consent || !content || empty) return;
				void perform(async (commit) => {
					const record = await publisher.publishProfile({ ...draftToInput(draft, count), consent }, request.current?.signal);
					commit(() => {
						setPublished(record); setConsent(false);
						// Keep the local draft, including sections withheld from this publication.
						setMessage("Your learning profile is now public.");
					});
				}, true);
			}}>
				{([...draft.sectionOrder, "look"] as const).map((section, index) => {
					const label = section === "look" ? "Look and layout" : PROFILE_SECTION_LABELS[section];
					const hidden = section !== "look" && draft.hiddenSections.includes(section);
					return <motion.section key={section} layout={animate ? "position" : false} transition={SOFT} className="pf-card" data-hidden={hidden || undefined} data-invalid={invalidSection === section || undefined}>
						<div className="pf-card-head">
							<button className="pf-disclose" type="button" aria-expanded={open.includes(section)} aria-controls={"pf-body-" + section} onClick={() => {
								if (!open.includes(section)) focusAfterOpen.current = "#pf-body-" + section + " :is(input:not([hidden]):not(:disabled), textarea, select, button:not(:disabled))";
								setOpen(previous => previous.includes(section) ? previous.filter(id => id !== section) : [...previous, section]);
							}}>
								<KeatingGlyph name={open.includes(section) ? "chev" : "chevr"}/>{label}
							</button>
							{section !== "look" && <>
								{section !== "about" && <small>{counts[section]}</small>}
								{section === "links" && <Button variant="ghost" size="sm" glyph="plus" disabled={draft.links.length >= PROFILE_LIMITS.links} onClick={() => {
									focusAfterOpen.current = "#pf-link-label-" + draft.links.length;
									setOpen(previous => [...previous.filter(id => id !== "links"), "links"]);
									update(d => ({ ...d, links: [...d.links, { label: "", url: "" }] }));
								}}>Add a link</Button>}{invalidSection === section && <span>Needs attention</span>}<small className="pf-visibility">{hidden ? "hidden: not shown, not published" : "shown"}</small>
								<IconButton size="sm" glyph="rise" label={`Move ${label} up`} disabled={!index} onClick={() => update(d => ({...d, sectionOrder: move(d.sectionOrder, index, -1)}))}/>
								<IconButton size="sm" glyph="down" label={`Move ${label} down`} disabled={index === draft.sectionOrder.length - 1} onClick={() => update(d => ({...d, sectionOrder: move(d.sectionOrder, index, 1)}))}/>
								<IconButton size="sm" glyph={hidden ? "eyeoff" : "eye"} label={`${hidden ? "Show" : "Hide"} ${label}`} pressed={!hidden} onClick={() => update(d => ({...d, hiddenSections: hidden ? d.hiddenSections.filter(id => id !== section) : [...d.hiddenSections, section]}))}/>
							</>}
						</div>
						<motion.div id={"pf-body-" + section} inert={!open.includes(section)} aria-hidden={!open.includes(section)}
							initial={false} animate={{height: open.includes(section) ? "auto" : 0}} transition={{ duration: animate ? DURATION.quick : 0, ease: EASE }} style={{ overflow: "hidden" }}>
							<div className="pf-card-body">{fields[section]}</div>
						</motion.div>
					</motion.section>;
				})}
				<section className="profile-editor__publish" aria-label="Publication options">

					<div className="profile-page__actions" style={{ marginTop: 0 }}>
						<button type="button" className="profile-button" disabled={!publisher || busy || published === null} onClick={() => {
							if (!window.confirm("Make your profile private? Copies other apps already read may remain.")) return;
							void perform(async (commit) => {
							await publisher!.remove(request.current?.signal);
							commit(() => { setPublished(null); setConsent(false); setMessage("Your profile was removed from your PDS and from Keating. Other apps may keep copies they already read."); });
						}, true); }}>Make private</button>
						<button type="button" className="profile-button" disabled={busy} onClick={() => {
							if (draftOwner.current) clearProfileDraft(draftOwner.current);
							setDraft(published ? draftFromProfile(published) : EMPTY_PROFILE_DRAFT); setDraftSaved(true); setConsent(false);
						}}>{published ? "Discard my edits" : "Clear the form"}</button>
					</div>
					<details><summary>Publication details and recovery</summary>
					<p className="profile-editor__hint">The preview is exactly what becomes public: readable by anyone, and stored on your PDS where other apps can read it too.</p>
						<button type="button" className="profile-button profile-button--quiet" disabled={busy} onClick={() => window.location.reload()}>Reload status</button>
					{publisher && did && <button type="button" disabled={busy} onClick={() => void perform(() => connectLearningProfile(did))}>Reconnect account</button>}
					{!publisher && did && <p className="profile-editor__hint">Connect your account above to enable publishing.</p>}
					{published && did && <div className="profile-editor__share">
						<span>Public page:</span> <a href={publicUrl}>{publicUrl}</a>
						<button type="button" className="profile-button" onClick={async () => {
							try { await navigator.clipboard.writeText(publicUrl); setCopyState("Link copied"); }
							catch { setCopyState("Copying was blocked"); }
						}}>Copy link</button>
						<span role="status">{copyState}</span>
					</div>}
					<p className="profile-editor__hint">Making your profile private removes it from your PDS. Keating stops showing it within about a minute; copies other apps already read may remain.</p>
					</details>
				</section>
			</form>

			<aside id="profile-panel-preview" role="tabpanel" className="profile-editor__preview" aria-labelledby="profile-panel-preview-tab">
				<p className="profile-editor__preview-label k-grid">Preview: what visitors will see</p>
				<p className="pf-destination">{publicUrl || "Sign in to see your public page address."}</p>
				{preview
					? <PublicProfileView profile={preview} identity={handle ? `@${handle}` : did ?? undefined} updatedAt={published && !changed ? published.updatedAt : undefined} preview />
					: <EmptyState heading="Fix the highlighted field to see the preview."/>}
			</aside>
		</div>
	</main>
	</div>;
}
