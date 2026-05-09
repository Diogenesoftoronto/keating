import { Suspense, use, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpenCheck, Brain, Clock3, MessageSquareText, TrendingUp } from "lucide-react";
import { type SessionMetadata } from "@mariozechner/pi-web-ui";
import { getInitPromise, sessions } from "../hooks/keating-storage";

function formatNumber(value: number) {
	return new Intl.NumberFormat().format(Math.round(value));
}

function formatCost(value: number) {
	return value > 0 ? `$${value.toFixed(value < 1 ? 4 : 2)}` : "$0";
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysBetween(start: string, end: string) {
	return Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1);
}

function firstSentence(text: string) {
	return text.replace(/\s+/g, " ").trim().split(/[.!?]\s/)[0]?.slice(0, 120) || "No preview saved";
}

function useSessionMetadata() {
	use(getInitPromise());
	const metadataPromise = useMemo(() => sessions.getAllMetadata(), []);
	return use(metadataPromise);
}

function MetricCard({
	icon,
	label,
	value,
	detail,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-lg border border-border bg-background p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="text-sm text-muted-foreground">{label}</div>
				<div className="text-muted-foreground">{icon}</div>
			</div>
			<div className="mt-3 text-2xl font-semibold">{value}</div>
			<div className="mt-1 text-xs text-muted-foreground">{detail}</div>
		</div>
	);
}

function UsageContent() {
	const navigate = useNavigate();
	const metadata = useSessionMetadata().sort((a, b) => b.lastModified.localeCompare(a.lastModified));
	const totals = metadata.reduce(
		(acc, session) => {
			acc.messages += session.messageCount;
			acc.input += session.usage.input;
			acc.output += session.usage.output;
			acc.tokens += session.usage.totalTokens;
			acc.cost += session.usage.cost.total;
			return acc;
		},
		{ messages: 0, input: 0, output: 0, tokens: 0, cost: 0 },
	);
	const activeSpan = metadata.length
		? daysBetween(metadata[metadata.length - 1].createdAt, metadata[0].lastModified)
		: 0;
	const recent = metadata.slice(0, 8);
	const deepest = [...metadata].sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
	const dailyMessages = activeSpan ? totals.messages / activeSpan : 0;

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="border-b border-border">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
					<div>
						<p className="text-xs uppercase tracking-wide text-muted-foreground">Keating usage</p>
						<h1 className="text-2xl font-semibold">Learning activity</h1>
					</div>
					<button
						className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
						onClick={() => navigate({ to: "/chat" })}
					>
						<ArrowLeft size={16} />
						Back to chat
					</button>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 py-6">
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<MetricCard
						icon={<BookOpenCheck size={18} />}
						label="Learning sessions"
						value={formatNumber(metadata.length)}
						detail={activeSpan ? `${activeSpan} day learning window` : "No sessions yet"}
					/>
					<MetricCard
						icon={<MessageSquareText size={18} />}
						label="Socratic turns"
						value={formatNumber(totals.messages)}
						detail={`${dailyMessages.toFixed(1)} messages per active day`}
					/>
					<MetricCard
						icon={<Brain size={18} />}
						label="Model tokens"
						value={formatNumber(totals.tokens || totals.input + totals.output)}
						detail={`${formatNumber(totals.input)} in / ${formatNumber(totals.output)} out`}
					/>
					<MetricCard
						icon={<TrendingUp size={18} />}
						label="Estimated spend"
						value={formatCost(totals.cost)}
						detail="Based on provider usage metadata"
					/>
				</div>

				<div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
					<section className="rounded-lg border border-border bg-background">
						<div className="border-b border-border px-4 py-3">
							<h2 className="text-sm font-semibold">Recent learning</h2>
							<p className="mt-1 text-xs text-muted-foreground">Latest saved sessions and their focus</p>
						</div>
						<div className="divide-y divide-border">
							{recent.length === 0 ? (
								<div className="px-4 py-8 text-center text-sm text-muted-foreground">
									Start a chat and Keating will track your learning activity here.
								</div>
							) : recent.map((session) => (
								<SessionRow key={session.id} session={session} />
							))}
						</div>
					</section>

					<section className="rounded-lg border border-border bg-background">
						<div className="border-b border-border px-4 py-3">
							<h2 className="text-sm font-semibold">Deepest dives</h2>
							<p className="mt-1 text-xs text-muted-foreground">Sessions with the most back-and-forth</p>
						</div>
						<div className="space-y-3 p-4">
							{deepest.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">No learning history yet</div>
							) : deepest.map((session, index) => (
								<div key={session.id} className="flex items-start gap-3">
									<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
										{index + 1}
									</div>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">{session.title}</div>
										<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
											<Clock3 size={13} />
											{session.messageCount} messages | {formatDate(session.lastModified)}
										</div>
									</div>
								</div>
							))}
						</div>
					</section>
				</div>
			</main>
		</div>
	);
}

function SessionRow({ session }: { session: SessionMetadata }) {
	const tokens = session.usage.totalTokens || session.usage.input + session.usage.output;
	return (
		<div className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
			<div className="min-w-0">
				<div className="truncate text-sm font-medium">{session.title}</div>
				<div className="mt-1 text-xs text-muted-foreground">{firstSentence(session.preview)}</div>
			</div>
			<div className="flex flex-wrap gap-2 text-xs text-muted-foreground sm:justify-end">
				<span className="rounded-md bg-muted px-2 py-1">{formatDate(session.lastModified)}</span>
				<span className="rounded-md bg-muted px-2 py-1">{session.messageCount} turns</span>
				<span className="rounded-md bg-muted px-2 py-1">{formatNumber(tokens)} tokens</span>
			</div>
		</div>
	);
}

export function Usage() {
	return (
		<Suspense fallback={
			<div className="min-h-screen bg-background text-foreground">
				<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
					Loading usage...
				</div>
			</div>
		}>
			<UsageContent />
		</Suspense>
	);
}
