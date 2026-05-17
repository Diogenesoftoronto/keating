import { Suspense, use, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpenCheck, Brain, Clock3, Cpu, Flame, Gem, MessageSquareText, TrendingUp, Wrench } from "lucide-react";
import { useSeo } from "../hooks/useSeo";
import { getInitPromise, keatingStorage, sessions } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { UsageCharts } from "../components/UsageCharts";

let metadataPromise: Promise<SessionMetadata[]> | null = null;

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
	if (!metadataPromise) {
		metadataPromise = sessions.getAllMetadata();
	}
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

function useArtifactMetrics() {
	const [metrics, setMetrics] = useState<{
		plans: number; maps: number; animations: number;
		benchmarks: number; evolutions: number; promptEvolutions: number; improvements: number;
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			keatingStorage.getLessonPlans(),
			keatingStorage.getLessonMaps(),
			keatingStorage.getAnimations(),
			keatingStorage.getBenchmarks(),
			keatingStorage.getEvolutions(),
			keatingStorage.getPromptEvolutions(),
			keatingStorage.getImprovementAttempts(),
		]).then(([plans, maps, animations, benchmarks, evolutions, promptEvolutions, improvements]) => {
			if (!cancelled) {
				setMetrics({ plans: plans.length, maps: maps.length, animations: animations.length, benchmarks: benchmarks.length, evolutions: evolutions.length, promptEvolutions: promptEvolutions.length, improvements: improvements.length });
			}
		}).catch(() => {});
		return () => { cancelled = true; };
	}, []);

	return metrics;
}

function UsageContent() {
	const navigate = useNavigate();
	const metadata = useSessionMetadata().sort((a, b) => b.lastModified.localeCompare(a.lastModified));
	const artifactMetrics = useArtifactMetrics();
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

	const selfImprovement = artifactMetrics ? artifactMetrics.benchmarks + artifactMetrics.evolutions + artifactMetrics.promptEvolutions + artifactMetrics.improvements : 0;
	const teachingMats = artifactMetrics ? artifactMetrics.plans + artifactMetrics.maps + artifactMetrics.animations : 0;

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

				{/* Self-improvement vs Learning distinction */}
				<div className="mt-6 grid gap-3 sm:grid-cols-3">
					<MetricCard
						icon={<Gem size={18} />}
						label="Teaching materials"
						value={formatNumber(teachingMats)}
						detail={`${formatNumber(artifactMetrics?.plans ?? 0)} plans · ${formatNumber(artifactMetrics?.maps ?? 0)} maps · ${formatNumber(artifactMetrics?.animations ?? 0)} animations`}
					/>
					<MetricCard
						icon={<Cpu size={18} />}
						label="Self-improvement runs"
						value={formatNumber(selfImprovement)}
						detail={`${formatNumber(artifactMetrics?.evolutions ?? 0)} evolutions · ${formatNumber(artifactMetrics?.promptEvolutions ?? 0)} prompt evos`}
					/>
					<MetricCard
						icon={<Flame size={18} />}
						label="Improvement attempts"
						value={formatNumber(artifactMetrics?.improvements ?? 0)}
						detail={artifactMetrics && artifactMetrics.improvements > 0 ? `${formatNumber(artifactMetrics.benchmarks)} benchmarks measured` : "No improvements logged yet"}
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

				<UsageCharts sessionMetadata={metadata} />
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
	useSeo({
		title: "Keating Dashboard — Usage & Analytics",
		description: "View your Keating usage statistics, session history, and learning analytics.",
		canonical: "https://keating.help/usage",
	});
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
