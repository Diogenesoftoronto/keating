import { useEffect, useRef, useState } from "react";
import {
	Check,
	Code2,
	Film,
	FlaskConical,
	GitBranch,
	Landmark,
	Languages,
	ListChecks,
	Loader2,
	Map as MapIcon,
	MoreVertical,
	Palette,
	Pencil,
	Sigma,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionMetadata } from "../types/session";
import {
	type ArtifactHero,
	type CategoryKey,
	categorize,
	categoryGradient,
} from "./session-card-visuals";

const CATEGORY_ICON: Record<CategoryKey, LucideIcon> = {
	science: FlaskConical,
	"physics-math": Sigma,
	history: Landmark,
	cs: Code2,
	language: Languages,
	arts: Palette,
	general: Sparkles,
};

const HERO_ICON = {
	map: MapIcon,
	animation: Film,
	plan: ListChecks,
} as const;

export interface SessionCardProps {
	session: SessionMetadata;
	hero?: ArtifactHero;
	/** Number of direct forks, shown as a badge when this card stands alone. */
	childCount?: number;
	active?: boolean;
	forking?: boolean;
	justForked?: boolean;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onRename: (sessionId: string, title: string) => void | Promise<void>;
	onDelete: (sessionId: string) => void | Promise<void>;
}

function formatDate(isoString: string) {
	const date = new Date(isoString);
	const now = new Date();
	const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (days === 0) {
		return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	}
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days}d ago`;
	return date.toLocaleDateString();
}

export function SessionCard({
	session,
	hero,
	childCount = 0,
	active = false,
	forking = false,
	justForked = false,
	onLoad,
	onFork,
	onRename,
	onDelete,
}: SessionCardProps) {
	const category = categorize(session.title);
	const Icon = CATEGORY_ICON[category.key];
	const [menuOpen, setMenuOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [draft, setDraft] = useState(session.title);
	const [busy, setBusy] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (event: MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [menuOpen]);

	const saveRename = async () => {
		const next = draft.trim();
		if (!next || next === session.title.trim()) {
			setRenaming(false);
			return;
		}
		setBusy(true);
		try {
			await onRename(session.id, next);
			setRenaming(false);
		} finally {
			setBusy(false);
		}
	};

	const confirmDelete = async () => {
		setBusy(true);
		try {
			await onDelete(session.id);
		} finally {
			setBusy(false);
			setConfirmingDelete(false);
		}
	};

	const HeroBadgeIcon = hero ? HERO_ICON[hero.type] : null;

	return (
		<div
			className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border text-left shadow-sm transition-colors ${
				active ? "border-primary ring-1 ring-primary" : "border-border"
			} ${justForked ? "session-fork-arrive" : ""}`}
		>
			{/* Hero band: rendered map SVG when available, otherwise a category tile. */}
			<button
				type="button"
				className="relative block w-full text-left"
				onClick={() => void onLoad(session.id)}
				aria-label={`Open session ${session.title}`}
			>
				{hero?.svg ? (
					<div
						className="session-card-hero-svg flex h-20 sm:h-28 w-full items-center justify-center overflow-hidden bg-muted/40"
						// Locally generated mermaid SVG from the user's own IndexedDB.
						dangerouslySetInnerHTML={{ __html: hero.svg }}
					/>
				) : (
					<div
						className="flex h-12 sm:h-20 w-full items-center justify-between px-3 sm:px-4"
						style={{ background: categoryGradient(category.accent) }}
					>
						<Icon size={20} className="sm:size-[26px]" style={{ color: category.accent }} aria-hidden="true" />
						<span
							className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
							style={{ color: category.accent, background: `${category.accent}1f` }}
						>
							{category.label}
						</span>
					</div>
				)}
				{HeroBadgeIcon ? (
					<span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur">
						<HeroBadgeIcon size={11} />
						{hero?.type}
					</span>
				) : null}
			</button>

			<button
				type="button"
				className="flex min-w-0 flex-1 flex-col px-2.5 sm:px-3.5 pb-2.5 sm:pb-3 pt-2 sm:pt-2.5 text-left"
				onClick={() => void onLoad(session.id)}
			>
				<span className="text-[11px] text-muted-foreground">{formatDate(session.lastModified)}</span>
				<h3 className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs sm:text-sm font-semibold leading-snug text-foreground">
					{session.parentSessionId ? (
						<GitBranch size={13} className="mt-0.5 shrink-0 self-start text-primary" />
					) : null}
					<span className="line-clamp-2 sm:line-clamp-3 break-words">{session.title}</span>
				</h3>
				{session.preview ? (
					<p className="mt-1 line-clamp-2 sm:line-clamp-3 break-words text-xs leading-snug sm:leading-5 text-muted-foreground">{session.preview}</p>
				) : null}
				<div className="mt-1.5 sm:mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
					<span>{session.messageCount} messages</span>
					{childCount > 0 ? (
						<span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5">
							<GitBranch size={9} />
							{childCount}
						</span>
					) : null}
				</div>
			</button>

			{/* Overflow menu */}
			<div ref={menuRef} className="absolute right-1.5 top-1.5">
				<button
					type="button"
					className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur hover:bg-accent hover:text-accent-foreground"
					aria-label="Session actions"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					onClick={() => setMenuOpen((open) => !open)}
				>
					{busy ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={15} />}
				</button>
				{menuOpen ? (
					<div
						role="menu"
						className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
					>
						<button
							type="button"
							role="menuitem"
							className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent disabled:opacity-50"
							disabled={forking}
							onClick={() => {
								setMenuOpen(false);
								void onFork(session.id);
							}}
						>
							{forking ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />}
							Fork
						</button>
						{session.aiGeneratedTitle ? (
							<button
								type="button"
								role="menuitem"
								className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
								onClick={() => {
									setMenuOpen(false);
									setConfirmingDelete(false);
									setDraft(session.title);
									setRenaming(true);
								}}
							>
								<Pencil size={13} />
								Rename
							</button>
						) : null}
						<button
							type="button"
							role="menuitem"
							className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
							onClick={() => {
								setMenuOpen(false);
								setRenaming(false);
								setConfirmingDelete(true);
							}}
						>
							<Trash2 size={13} />
							Delete
						</button>
					</div>
				) : null}
			</div>

			{renaming ? (
				<div className="flex items-center gap-1.5 border-t border-border bg-background/60 p-2">
					<input
						className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
						value={draft}
						autoFocus
						disabled={busy}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void saveRename();
							if (event.key === "Escape") setRenaming(false);
						}}
					/>
					<button
						type="button"
						className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
						aria-label="Cancel rename"
						onClick={() => setRenaming(false)}
					>
						<X size={14} />
					</button>
					<button
						type="button"
						className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
						aria-label="Save rename"
						disabled={busy}
						onClick={() => void saveRename()}
					>
						<Check size={14} />
					</button>
				</div>
			) : null}

			{confirmingDelete ? (
				<div className="flex items-center justify-between gap-2 border-t border-destructive/30 bg-destructive/5 p-2">
					<span className="text-[11px] text-foreground">Delete session?</span>
					<div className="flex gap-1.5">
						<button
							type="button"
							className="rounded-md px-2 py-1 text-[11px] hover:bg-accent"
							onClick={() => setConfirmingDelete(false)}
						>
							Cancel
						</button>
						<button
							type="button"
							className="rounded-md bg-destructive px-2 py-1 text-[11px] text-destructive-foreground disabled:opacity-50"
							disabled={busy}
							onClick={() => void confirmDelete()}
						>
							Delete
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
