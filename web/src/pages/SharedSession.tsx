import { Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bot, Copy, GitFork, MessageSquareText, User } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { forkSharedSession, loadSharedSessionResultFromUrl, type SharedSession as SharedSessionData } from "../keating/shared-sessions";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { css, cx } from "../../styled-system/css";

const styles = {
	page: css({ minH: "100vh", bg: "var(--background)", color: "var(--foreground)" }),
	center: css({ display: "flex", minH: "100vh", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	notFound: css({ mx: "auto", display: "flex", minH: "100vh", maxW: "48rem", flexDir: "column", alignItems: "center", justifyContent: "center", px: "1rem", textAlign: "center" }),
	iconMuted: css({ mb: "1rem", color: "var(--muted-foreground)" }),
	h1: css({ fontSize: "1.25rem", fontWeight: "600" }),
	notFoundCopy: css({ mt: "0.5rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
	outlineButton: css({ display: "inline-flex", h: "2.25rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.75rem", fontSize: "0.875rem", _hover: { bg: "var(--accent)" } }),
	backButton: css({ mt: "1.5rem", display: "inline-flex", h: "2.25rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", px: "0.75rem", fontSize: "0.875rem", _hover: { bg: "var(--accent)" } }),
	header: css({ borderBottom: "1px solid var(--border)" }),
	headerInner: css({ mx: "auto", display: "flex", maxW: "56rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", px: "1rem", py: "1rem" }),
	minW0: css({ minW: 0 }),
	eyebrow: css({ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" }),
	title: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "1.25rem", fontWeight: "600" }),
	meta: css({ mt: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	modelBadge: css({ mt: "0.5rem", display: "inline-flex", maxW: "100%", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)", bg: "color-mix(in srgb, var(--primary) 10%, transparent)", px: "0.5rem", py: "0.25rem", fontSize: "0.75rem", color: "var(--primary)" }),
	shrink0: css({ flexShrink: 0 }),
	truncate: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
	modelDetails: css({ display: "none", color: "color-mix(in srgb, var(--primary) 80%, transparent)", sm: { display: "inline" } }),
	headerActions: css({ display: "flex", alignItems: "center", gap: "0.5rem" }),
	primaryButton: css({ display: "inline-flex", h: "2.25rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", bg: "var(--primary)", px: "0.75rem", fontSize: "0.875rem", color: "var(--primary-foreground)", _hover: { bg: "color-mix(in srgb, var(--primary) 90%, transparent)" }, _disabled: { opacity: 0.6 } }),
	main: css({ mx: "auto", maxW: "56rem", px: "1rem", py: "1.5rem" }),
	error: css({ mb: "1rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", bg: "color-mix(in srgb, var(--destructive) 5%, transparent)", px: "0.75rem", py: "0.5rem", fontSize: "0.875rem", color: "var(--destructive)" }),
	messageStack: css({ "& > * + *": { mt: "1rem" } }),
	messageArticle: css({ borderRadius: "0.5rem", border: "1px solid", bg: "var(--background)", p: "1rem" }),
	assistantArticle: css({ borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)", borderLeftWidth: "4px", borderLeftColor: "var(--primary)" }),
	learnerArticle: css({ borderColor: "rgba(245, 158, 11, 0.4)", borderLeftWidth: "4px", borderLeftColor: "#f59e0b", bg: "rgba(245, 158, 11, 0.05)" }),
	messageHeader: css({ mb: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontWeight: "500", textTransform: "uppercase", letterSpacing: "0.025em" }),
	assistantText: css({ color: "var(--primary)" }),
	learnerText: css({ color: "#b45309", _dark: { color: "#fcd34d" } }),
	markdown: css({ maxW: "none" }),
};

function formatDate(iso: string) {
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
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
		description: "View a shared Keating tutoring session. Socratic AI conversation with lesson artifacts and learning traces.",
	});
	const navigate = useNavigate();
	const shareId = useMemo(() => decodeURIComponent(window.location.pathname.split("/").pop() ?? ""), []);
	const [session, setSession] = useState<SharedSessionData | null>(null);
	const [loading, setLoading] = useState(true);
	const [copied, setCopied] = useState(false);
	const [forking, setForking] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setSession(null);
		setError("");
		loadSharedSessionResultFromUrl(shareId, window.location.hash)
			.then((result) => {
				if (cancelled) return;
				if (result.ok) setSession(result.session);
				else setError(result.message);
			})
			.catch((error) => {
				if (!cancelled) {
					setError(error instanceof Error ? error.message : "Could not load the shared session.");
					setSession(null);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [shareId]);

	const copyLink = async () => {
		await navigator.clipboard?.writeText(window.location.href);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	};

	const forkSession = async () => {
		if (!session) return;
		setForking(true);
		setError("");
		try {
			await forkSharedSession(session);
			await navigate({ to: "/chat" });
		} catch (error) {
			setError(error instanceof Error ? error.message : "Failed to fork session");
		} finally {
			setForking(false);
		}
	};

	if (loading) {
		return (
			<div className={styles.page}>
				<div className={styles.center}>
					Loading shared session...
				</div>
			</div>
		);
	}

	if (!session) {
		return (
			<div className={styles.page}>
				<div className={styles.notFound}>
					<MessageSquareText className={styles.iconMuted} size={32} />
					<h1 className={styles.h1}>Shared session not found</h1>
					<p className={styles.notFoundCopy}>
						{error || "This share link is missing its session snapshot. Ask for a fresh link or open a cached share from this browser."}
					</p>
					<button
						className={styles.backButton}
						onClick={() => navigate({ to: "/chat" })}
					>
						<ArrowLeft size={16} />
						Back to chat
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<div className={styles.headerInner}>
					<div className={styles.minW0}>
						<p className={styles.eyebrow}>Shared Keating session</p>
						<h1 className={styles.title}>{session.title}</h1>
						<p className={styles.meta}>
							{session.messageCount} messages | Shared {formatDate(session.sharedAt)}
						</p>
						<div className={styles.modelBadge}>
							<Bot size={13} className={styles.shrink0} />
							<span className={styles.truncate}>Shared from {modelLabel(session)}</span>
							<span className={styles.modelDetails}>| {modelDetails(session)}</span>
						</div>
					</div>
					<div className={styles.headerActions}>
						<button
							className={styles.outlineButton}
							onClick={copyLink}
						>
							<Copy size={16} />
							{copied ? "Copied" : "Copy link"}
						</button>
						<button
							className={styles.primaryButton}
							disabled={forking}
							onClick={forkSession}
						>
							<GitFork size={16} />
							{forking ? "Forking" : "Start from this"}
						</button>
					</div>
				</div>
			</header>

			<main className={styles.main}>
				{error ? (
					<div className={styles.error}>
						{error}
					</div>
				) : null}

				<div className={styles.messageStack}>
					{session.messages.map((message, index) => {
						const isAssistant = (message as any).role === "assistant";
						const RoleIcon = isAssistant ? Bot : User;
						return (
							<article
								key={index}
								className={cx(styles.messageArticle, isAssistant ? styles.assistantArticle : styles.learnerArticle)}
							>
								<div className={cx(styles.messageHeader, isAssistant ? styles.assistantText : styles.learnerText)}>
									<RoleIcon size={13} />
									<span>{messageLabel(message)}</span>
								</div>
								<div className={styles.markdown}>
									<MarkdownBlock content={messageText(message)} />
								</div>
							</article>
						);
					})}
				</div>
			</main>
		</div>
	);
}

export function SharedSession() {
	return (
		<Suspense fallback={
			<div className={styles.page}>
				<div className={styles.center}>
					Loading shared session...
				</div>
			</div>
		}>
			<SharedSessionContent />
		</Suspense>
	);
}
