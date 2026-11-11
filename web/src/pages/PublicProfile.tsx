import { useEffect, useId, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Flag } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { isProfileDid, publicProfilePath, type FullLearningProfile } from "../keating/public-profile-contract";
import { PublicProfileView } from "../components/profile/PublicProfileView";
import "../components/profile/public-profile.css";

type LoadState =
	| { status: "loading" }
	| { status: "public"; handle?: string; profile: FullLearningProfile }
	| { status: "not_public" }
	| { status: "hidden" }
	| { status: "invalid" }
	| { status: "unavailable"; message: string };

/** Mirrors server/utils/public-profile-moderation.ts; kept here so the page ships no server code. */
const REPORT_REASONS = [
	["harassment", "Harassment or hate"],
	["impersonation", "Pretending to be someone else"],
	["spam", "Spam or advertising"],
	["sexual", "Sexual or graphic content"],
	["private-information", "Shares someone's private information"],
	["other", "Something else"],
] as const;

export async function fetchPublicProfile(did: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<LoadState> {
	if (!isProfileDid(did)) return { status: "invalid" };
	let response: Response;
	try {
		response = await fetcher(`/api/profiles/${encodeURIComponent(did)}`, { headers: { accept: "application/json" }, signal });
	} catch {
		return { status: "unavailable", message: "Keating could not be reached. Check your connection and try again." };
	}
	if (response.status === 400) return { status: "invalid" };
	if (response.status === 404) return { status: "not_public" };
	if (response.status === 429) return { status: "unavailable", message: "Too many profiles were opened from here in a short time. Wait a few minutes and try again." };
	if (!response.ok) return { status: "unavailable", message: "This learner's data server could not be read just now. Their profile may still exist; try again shortly." };
	const body = await response.json().catch(() => null) as { status?: string; handle?: string; profile?: FullLearningProfile } | null;
	if (body?.status === "public" && body.profile) return { status: "public", profile: body.profile, ...(body.handle ? { handle: body.handle } : {}) };
	if (body?.status === "hidden") return { status: "hidden" };
	if (body?.status === "not_public") return { status: "not_public" };
	return { status: "unavailable", message: "Keating received a profile it could not display." };
}

function ReportDialog({ did, publicationId, onClose }: { did: string; publicationId?: string; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const [reason, setReason] = useState<string>("");
	const [detail, setDetail] = useState("");
	const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
	const [error, setError] = useState("");

	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
	}, []);

	const submit = async () => {
		if (!reason) { setError("Choose a reason."); return; }
		if (reason === "other" && !detail.trim()) { setError("Tell us what is wrong with this profile."); return; }
		setState("sending"); setError("");
		try {
			const response = await fetch("/api/profiles/report", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ did, reason, ...(detail.trim() ? { detail: detail.trim() } : {}), ...(publicationId ? { publicationId } : {}) }),
			});
			if (response.status === 429) throw new Error("You have sent several reports recently. Please wait before sending another.");
			if (!response.ok) throw new Error("The report could not be sent. Please try again.");
			setState("sent");
		} catch (problem) {
			setState("idle");
			setError(problem instanceof Error ? problem.message : "The report could not be sent. Please try again.");
		}
	};

	return <dialog ref={dialog} className="profile-report" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
		<h2 id={titleId}>Report this profile</h2>
		{state === "sent" ? <>
			<p role="status">Thank you. The report was sent to Keating for review. We do not tell the profile's owner who reported it.</p>
			<div className="profile-report__actions"><button type="button" className="profile-button profile-button--primary" autoFocus onClick={onClose}>Close</button></div>
		</> : <form method="dialog" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
			<p>Reports go to Keating, not to the profile's owner. Keating can stop showing a profile on this site; the content itself is stored by the learner's own data server.</p>
			<fieldset>
				<legend>What is wrong?</legend>
				{REPORT_REASONS.map(([value, label]) => <label key={value}><input type="radio" name="report-reason" value={value} checked={reason === value} onChange={() => { setReason(value); setError(""); }} /> {label}</label>)}
			</fieldset>
			<label>
				<span>Details {reason === "other" ? "(required)" : "(optional)"}</span>
			</label>
			<textarea rows={3} maxLength={1000} value={detail} aria-label="Details" onChange={event => setDetail(event.target.value)} />
			{error && <p className="profile-editor__error" role="alert">{error}</p>}
			<div className="profile-report__actions">
				<button type="button" className="profile-button" onClick={onClose}>Cancel</button>
				<button type="submit" className="profile-button profile-button--primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send report"}</button>
			</div>
		</form>}
	</dialog>;
}

export function PublicProfile() {
	const { did: rawDid } = useParams({ strict: false }) as { did?: string };
	const did = rawDid ?? "";
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [attempt, setAttempt] = useState(0);
	const [reporting, setReporting] = useState(false);
	const reportButton = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		void fetchPublicProfile(did, fetch, controller.signal).then((next) => { if (!controller.signal.aborted) setState(next); });
		return () => controller.abort();
	}, [did, attempt]);

	const name = state.status === "public" ? state.profile.displayName ?? state.handle ?? "A Keating learner" : "Learning profile";
	useSeo({
		title: `${name} · Keating`,
		description: state.status === "public"
			? state.profile.headline ?? `What ${name} is learning with Keating.`
			: "A learner's public profile on Keating.",
		...(isProfileDid(did) ? { canonical: `https://chat.keating.help${publicProfilePath(did)}` } : {}),
	});

	return <div className="profile-shell retro-layout">
	<main className="profile-page">
		<nav className="profile-page__nav" aria-label="Site">
			<a href="/">Keating</a>
			<a href="/review/learning-profile">Make your own profile</a>
		</nav>

		{state.status === "loading" && <p role="status" aria-live="polite">Loading profile…</p>}

		{state.status === "public" && <>
			<PublicProfileView profile={state.profile} identity={state.handle ? `@${state.handle}` : did} updatedAt={state.profile.updatedAt} />
			<div className="profile-page__actions">
				<button ref={reportButton} type="button" className="profile-button profile-button--quiet" onClick={() => setReporting(true)}><Flag size={14} aria-hidden="true" /> Report this profile</button>
			</div>
			<p className="profile-page__note">This profile is stored on the learner's own AT Protocol data server and shown here by Keating.</p>
		</>}

		{state.status === "not_public" && <section className="profile-page__status" role="status">
			<h1>No public profile here</h1>
			<p>This learner has not published a profile, or has made it private.</p>
			<a className="profile-button" href="/">Go to Keating</a>
		</section>}

		{state.status === "hidden" && <section className="profile-page__status" role="status">
			<h1>This profile is not shown on Keating</h1>
			<p>Keating has stopped displaying this profile after a review. If it is yours and you think that is a mistake, contact Keating support.</p>
			<a className="profile-button" href="/">Go to Keating</a>
		</section>}

		{state.status === "invalid" && <section className="profile-page__status" role="alert">
			<h1>That profile link is not valid</h1>
			<p>Profile links look like <code>/u/did:plc:…</code>. Check that the whole link was copied.</p>
			<a className="profile-button" href="/">Go to Keating</a>
		</section>}

		{state.status === "unavailable" && <section className="profile-page__status" role="alert">
			<h1>The profile could not be loaded</h1>
			<p>{state.message}</p>
			<button type="button" className="profile-button profile-button--primary" onClick={() => setAttempt(value => value + 1)}>Try again</button>
		</section>}

		{reporting && state.status === "public" && <ReportDialog did={did} publicationId={state.profile.publicationId} onClose={() => { setReporting(false); reportButton.current?.focus(); }} />}
	</main>
	</div>;
}
