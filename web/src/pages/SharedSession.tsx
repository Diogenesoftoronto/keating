import { Suspense, useEffect, useMemo, useState } from "react";
import { usePostHog } from "@posthog/react";
import { useNavigate } from "@tanstack/react-router";
import { KeatingGlyph } from "../design-system/glyphs";
import { SharedTrajectoryWorkspace } from "../components/trajectory";
import { useSeo } from "../hooks/useSeo";
import { forkSharedSession, loadSharedSessionResultFromUrl, type SharedSession as SharedSessionData } from "../keating/shared-sessions";
import { OpenUIPreview } from "../components/OpenUIPreview";
import { buildOpenUIPreview } from "../keating/openui/preview";
import { learnerResponseReviewMarkdown } from "../keating/learner-response";
import { stripReviewNotice } from "../keating/judgement/review-notice";
import { AppBar, Button, Chip, EmptyState, Loading, Note, Prose } from "../design-system/kit";
import "../components/trajectory/review.css";
import { sharedSessionOmissionNotice, sharedSessionWorkspaceData } from "./shared-session-view-model";

function SharedSessionLoading() {
	return <main><div role="heading" aria-level={1}><Loading size="page" label="Loading shared session…" /></div></main>;
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/**
 * A shared reply reads like the chat: interactive components appear as inert
 * summaries (a stranger's link must not mount live controls), and learner
 * answers read as their summary rather than raw JSON.
 */
function sharedMessageBlocks(message: unknown) {
	return buildOpenUIPreview(learnerResponseReviewMarkdown(stripReviewNotice(messageText(message))));
}

function messageText(message: unknown): string {
	const content = (message as any)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function messageLabel(message: unknown) {
	const role = (message as any)?.role;
	return role === "assistant" ? "Keating" : "Learner";
}

function modelLabel(session: SharedSessionData) {
	const model = session.model;
	if (!model) return "Unknown model";
	return model.name || model.id;
}

function modelDetails(session: SharedSessionData) {
	const model = session.model;
	const parts = [
		model ? model.provider : "unknown provider",
		session.thinkingLevel ? `${session.thinkingLevel} reasoning` : null,
	].filter(Boolean);
	return parts.join(" | ");
}

function SharedSessionContent() {
	useSeo({
		title: "Keating Shared Session",
		description: "View a shared Keating tutoring session with conversation, teaching artifacts, and published review feedback.",
	});
	const posthog = usePostHog();
	const navigate = useNavigate();
	const shareId = useMemo(() => decodeURIComponent(window.location.pathname.split("/").pop() ?? ""), []);
	const [session, setSession] = useState<SharedSessionData | null>(null);
	const [loading, setLoading] = useState(true);
	const [copied, setCopied] = useState(false);
	const [forking, setForking] = useState(false);
	const [error, setError] = useState("");
	const workspaceData = useMemo(() => session ? sharedSessionWorkspaceData(session) : null, [session]);
	const omissionNotice = useMemo(() => session ? sharedSessionOmissionNotice(session) : null, [session]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setSession(null);
		setError("");
		loadSharedSessionResultFromUrl(shareId, window.location.hash)
			.then((result) => {
				if (cancelled) return;
				if (result.ok) {
					setSession(result.session);
					posthog?.capture("shared_session_opened", {
						success: true,
						source: result.source,
						message_count: result.session.messageCount,
						artifact_count: result.session.trajectory?.artifactCount ?? 0,
						review_included: Boolean(result.session.trajectory?.review),
						provider: result.session.model?.provider ?? "unknown",
					});
				} else {
					setError(result.message);
					posthog?.capture("shared_session_opened", {
						success: false,
						failure_type: result.reason,
					});
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setError(error instanceof Error ? error.message : "Could not load the shared session.");
					setSession(null);
					posthog?.capture("shared_session_opened", {
						success: false,
						failure_type: "unexpected",
					});
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [posthog, shareId]);

	const copyLink = async () => {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard unavailable. Copy the link from your address bar.");
			await navigator.clipboard.writeText(window.location.href);
			posthog?.capture("shared_session_link_copied", { clipboard_available: true });
			setError("");
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not copy the link.");
		}
	};

	const forkSession = async () => {
		if (!session) return;
		setForking(true);
		setError("");
		try {
			await forkSharedSession(session);
			posthog?.capture("shared_session_forked", {
				success: true,
				message_count: session.messageCount,
				artifact_count: session.trajectory?.artifactCount ?? 0,
				provider: session.model?.provider ?? "unknown",
			});
			await navigate({ to: "/chat" });
		} catch (error) {
			posthog?.capture("shared_session_forked", {
				success: false,
				failure_type: error instanceof Error ? error.name : "unknown",
			});
			setError(error instanceof Error ? error.message : "Failed to fork session");
		} finally {
			setForking(false);
		}
	};

	if (loading) return <SharedSessionLoading />;
	if (!session) return <EmptyState className="rv-viewer-state" heading={<span role="heading" aria-level={1}>Shared session not found</span>} actions={<Button glyph="left" variant="ghost" onClick={() => navigate({ to: "/chat" })}>Back to chat</Button>}>
		<span role="alert">{error || "This share link is missing its session snapshot. Ask for a fresh link or open a cached share from this browser."}</span>
	</EmptyState>;

	return <div className="rv-viewer">
		<AppBar className="k-halftone" data-glyph-host menu={false} start={<KeatingGlyph name="kmark" size={28} label="Keating"/>} title={<h1>{session.title}</h1>}
			subtitle={<>{workspaceData ? `${workspaceData.messages.length} turns · ${workspaceData.artifacts.length} artifacts` : `${session.messageCount} messages`} · Shared {formatDate(session.sharedAt)}</>}>
			<Chip data-glyph-host><KeatingGlyph name="lock"/>Read only</Chip>
			<Button variant="ghost" glyph="copy" onClick={copyLink} aria-live="polite">{copied ? "Copied" : "Copy link"}</Button>
			<Button glyph="fork" variant="primary" busy={forking} onClick={forkSession}
				title="Starts a new chat from the shared conversation">{forking ? <Loading size="inline" label="Forking" /> : "Start from this"}</Button>
		</AppBar>
		<p className="rv-viewer-model">Shared from {modelLabel(session)} · {modelDetails(session)}</p>
		{error && <Note data-glyph-host role="alert" tone="warn">{error}</Note>}
		{omissionNotice?.hasOmissions && <Note data-glyph-host>Some details were left out because they were private, unsupported, or too large for this link. {omissionNotice.items.join(" · ")}</Note>}
		{workspaceData ? <SharedTrajectoryWorkspace data={workspaceData} chrome="page" /> : <main>
			<h1 className="rv-snapshot-heading k-halftone">Shared conversation snapshot</h1>
			{session.messages.map((message, index) => <article key={index} className="rv-page-turn">
				<header data-glyph-host className="rv-page-turn-heading"><KeatingGlyph name={messageLabel(message) === "Keating" ? "bot" : "person"}/><h2>{messageLabel(message)}</h2></header>
				<Prose><OpenUIPreview blocks={sharedMessageBlocks(message)} /></Prose>
			</article>)}
		</main>}
	</div>;
}

export function SharedSession() {
	return <Suspense fallback={<SharedSessionLoading />}><SharedSessionContent /></Suspense>;
}
