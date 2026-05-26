import { Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bot, Copy, GitFork, MessageSquareText, User } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { forkSharedSession, loadSharedSessionFromUrl, type SharedSession as SharedSessionData } from "../keating/shared-sessions";
import { MarkdownBlock } from "../components/MarkdownBlock";

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
		loadSharedSessionFromUrl(shareId, window.location.hash)
			.then((shared) => {
				if (!cancelled) setSession(shared);
			})
			.catch(() => {
				if (!cancelled) setSession(null);
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
			<div className="min-h-screen bg-background text-foreground">
				<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
					Loading shared session...
				</div>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="min-h-screen bg-background text-foreground">
				<div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4 text-center">
					<MessageSquareText className="mb-4 text-muted-foreground" size={32} />
					<h1 className="text-xl font-semibold">Shared session not found</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						This share link is missing its session snapshot. Ask for a fresh link or open a cached share from this browser.
					</p>
					<button
						className="mt-6 inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
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
		<div className="min-h-screen bg-background text-foreground">
			<header className="border-b border-border">
				<div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
					<div className="min-w-0">
						<p className="text-xs uppercase tracking-wide text-muted-foreground">Shared Keating session</p>
						<h1 className="truncate text-xl font-semibold">{session.title}</h1>
						<p className="mt-1 text-xs text-muted-foreground">
							{session.messageCount} messages | Shared {formatDate(session.sharedAt)}
						</p>
						<div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
							<Bot size={13} className="shrink-0" />
							<span className="truncate">Shared from {modelLabel(session)}</span>
							<span className="hidden text-primary/80 sm:inline">| {modelDetails(session)}</span>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
							onClick={copyLink}
						>
							<Copy size={16} />
							{copied ? "Copied" : "Copy link"}
						</button>
						<button
							className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
							disabled={forking}
							onClick={forkSession}
						>
							<GitFork size={16} />
							{forking ? "Forking" : "Start from this"}
						</button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-4xl px-4 py-6">
				{error ? (
					<div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
						{error}
					</div>
				) : null}

				<div className="space-y-4">
					{session.messages.map((message, index) => {
						const isAssistant = (message as any).role === "assistant";
						const RoleIcon = isAssistant ? Bot : User;
						return (
							<article
								key={index}
								className={`rounded-lg border bg-background p-4 ${
									isAssistant
										? "border-primary/30 border-l-4 border-l-primary"
										: "border-amber-500/40 border-l-4 border-l-amber-500 bg-amber-500/5"
								}`}
							>
								<div className={`mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide ${
									isAssistant ? "text-primary" : "text-amber-700 dark:text-amber-300"
								}`}>
									<RoleIcon size={13} />
									<span>{messageLabel(message)}</span>
								</div>
								<div className={`prose prose-sm max-w-none ${isAssistant ? "dark:prose-invert" : "dark:prose-invert"}`}>
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
			<div className="min-h-screen bg-background text-foreground">
				<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
					Loading shared session...
				</div>
			</div>
		}>
			<SharedSessionContent />
		</Suspense>
	);
}
