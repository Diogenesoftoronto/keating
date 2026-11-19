import { useState, type ReactNode } from "react";
import { Stat } from "../../design-system/charts";
import { KeatingBot } from "../KeatingBot";
import { KeatingGlyph } from "../../design-system/glyphs";
import { EmptyState } from "../../design-system/kit";
import "../../pages/learning-profile.css";
import {
	PROFILE_SECTION_LABELS,
	PROFILE_AVATAR_PREFIX,
	WORK_KIND_LABELS,
	profilePlantStage,
	visibleProfileSections,
	type ProfileSection,
	type PublicProfileContent,
} from "../../keating/public-profile-contract";
import "./public-profile.css";

export interface PublicProfileViewProps {
	profile: PublicProfileContent;
	/** Shown under the name. A handle when known, otherwise the DID. */
	identity?: string;
	updatedAt?: string;
	/** The editor preview uses this to say plainly that nothing is published yet. */
	preview?: boolean;
}

function formatUpdated(value: string | undefined): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return null;
	return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Learner-written text only ever reaches the page as text nodes, never as markup. */
function Paragraphs({ text }: { text: string }) {
	return <>{text.split(/\n{2,}/).map((block, index) => <p key={index}>{block}</p>)}</>;
}

function hostOf(url: string): string {
	try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
	// Learner-supplied destinations: no referrer, no opener, and not endorsed for search ranking.
	return <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">{children}<KeatingGlyph name="ext" size={13}/><span className="public-profile__sr"> (opens in a new tab)</span></a>;
}

function Section({ id, children }: { id: ProfileSection; children: ReactNode }) {
	return <section className="public-profile__section" aria-labelledby={`profile-${id}`}>
		<h2 id={`profile-${id}`}>{PROFILE_SECTION_LABELS[id]}</h2>
		{children}
	</section>;
}

export function ProfileAvatar({ avatar, title }: { avatar?: string; title: string }) {
	const [failed, setFailed] = useState<string>();
	return avatar && avatar !== failed
		? <img className="public-profile__monogram public-profile__avatar" alt="" width={48} height={48}
			src={PROFILE_AVATAR_PREFIX + avatar} onError={() => setFailed(avatar)} />
		: <span className="public-profile__monogram" aria-hidden="true">{Array.from(title.trim())[0]?.toUpperCase() ?? "K"}</span>;
}

/**
 * One renderer for the public page and the editor's preview, so the preview
 * is the exact thing a visitor will see.
 */
export function PublicProfileView({ profile, identity, updatedAt, preview = false }: PublicProfileViewProps) {
	const sections = visibleProfileSections(profile);
	const plant = profile.activity && profilePlantStage(profile.activity.savedSessions);
	const updated = formatUpdated(updatedAt);
	const title = profile.displayName ?? identity ?? "A Keating learner";

	const bodies: Record<ProfileSection, ReactNode> = {
		about: profile.about ? <Paragraphs text={profile.about} /> : null,
		learning: <ul className="public-profile__learning">
			{profile.learning.map((item) => <li key={item.topic}>
				<strong>{item.topic}</strong>
				{item.goal && <span>{item.goal}</span>}
			</li>)}
		</ul>,
		topics: <ul className="public-profile__topics">
			{profile.topics.map((topic) => <li key={topic}>{topic}</li>)}
		</ul>,
		work: <ul className="public-profile__work">
			{profile.work.map((item) => <li key={item.url}>
				<p className="public-profile__kind">{WORK_KIND_LABELS[item.kind]} · {hostOf(item.url)}</p>
				<h3><ExternalAnchor href={item.url}>{item.title}</ExternalAnchor></h3>
				{item.note && <Paragraphs text={item.note} />}
				{item.tutorFeedback && <aside className="public-profile__feedback" aria-label={`Keating's AI feedback on ${item.title}`}>
					<p className="public-profile__feedback-label" data-glyph-host><KeatingGlyph name="kmark" size={14}/> Keating’s AI feedback, shared by the learner</p>
					<Paragraphs text={item.tutorFeedback} />
				</aside>}
			</li>)}
		</ul>,
		next: <ol className="public-profile__next">
			{profile.nextSteps.map((step) => <li key={step}>{step}</li>)}
		</ol>,
		links: <ul className="public-profile__links">
			{profile.links.map((link) => <li key={link.url}><ExternalAnchor href={link.url}>{link.label}</ExternalAnchor> <span className="public-profile__host">{hostOf(link.url)}</span></li>)}
		</ul>,
	};

	return <article className="public-profile" data-accent={profile.appearance.accent} data-layout={profile.appearance.layout} aria-label={preview ? "Preview of your public profile" : `${title}'s learning profile`}>
		<header className="public-profile__header k-halftone">
			<ProfileAvatar avatar={profile.avatar} title={title} />
			<div><h1>{title}</h1>
			{profile.displayName && identity && <p className="public-profile__identity">{identity}</p>}
			{profile.headline && <p className="public-profile__headline">{profile.headline}</p>}
			<div className="public-profile__meta">
				{profile.activity && <Stat value={profile.activity.savedSessions} label={profile.activity.savedSessions === 1 ? "saved session" : "saved sessions"}/>}
				{updated ? <span>Updated {updated}</span> : preview && <span>Draft, not published yet</span>}
			</div>
			</div>
			{plant && <KeatingBot state="plant" label={plant.label} size={24 + 8 * plant.stage}/>}
		</header>
		{sections.length === 0 && !profile.avatar
			? <EmptyState heading={preview ? "Nothing to show yet. Add a section in the editor and it appears here." : "This learner has not added anything to their profile yet."}/>
			: sections.length > 0 && <div className="public-profile__sections">{sections.map((id) => <Section key={id} id={id}>{bodies[id]}</Section>)}</div>}
		<footer className="public-profile__footer">
			<p>Written and chosen by the learner. Keating has not verified these claims, and nothing here is a grade or certificate.</p>
		</footer>
	</article>;
}
