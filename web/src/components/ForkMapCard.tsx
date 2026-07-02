import { useEffect, useRef, useState } from "react";
import {
	Check,
	GitBranch,
	Loader2,
	MoreVertical,
	Pencil,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import type { SessionMetadata } from "../types/session";
import type { SessionTreeNode } from "./session-tree";
import { countDescendants, flattenWithGuides } from "./fork-map-layout";

export interface ForkMapCardProps {
	root: SessionTreeNode;
	activeSessionId?: string;
	forkingSessionId?: string | null;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onSuggestTitle?: (sessionId: string) => Promise<string>;
	onRename: (sessionId: string, title: string) => void | Promise<void>;
	onDelete: (sessionId: string) => void | Promise<void>;
}

function formatTime(isoString: string) {
	const date = new Date(isoString);
	const now = new Date();
	const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (days === 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days}d ago`;
	return date.toLocaleDateString();
}

export function ForkMapCard({
	root,
	activeSessionId,
	forkingSessionId,
	onLoad,
	onFork,
	onSuggestTitle,
	onRename,
	onDelete,
}: ForkMapCardProps) {
	const rows = flattenWithGuides(root);
	const forkCount = countDescendants(root);

	return (
		<section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
			<header
				className="flex items-center gap-2 px-3.5 py-2.5"
				style={{ background: "linear-gradient(135deg, var(--accent) 0%, transparent 70%)" }}
			>
				<GitBranch size={15} className="shrink-0 text-primary" />
				<span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{root.session.title}</span>
				<span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
					{forkCount} {forkCount === 1 ? "fork" : "forks"}
				</span>
			</header>

			<div className="px-2 pb-2.5 pt-1">
				{rows.map((row) => (
					<div key={row.session.id} className="flex items-stretch">
						{row.ancestorHasNext.map((cont, i) => (
							<span key={i} className="relative w-4 shrink-0">
								{cont ? (
									<span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
								) : null}
							</span>
						))}
						{row.depth >= 1 ? (
							<span className="relative w-4 shrink-0" aria-hidden="true">
								<span className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-border" />
								{!row.isLast ? (
									<span className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 bg-border" />
								) : null}
								<span className="absolute left-1/2 top-1/2 h-px w-1/2 bg-border" />
							</span>
						) : null}
						<ForkNode
							session={row.session}
							isRoot={row.depth === 0}
							active={row.session.id === activeSessionId}
							forking={row.session.id === forkingSessionId}
							onLoad={onLoad}
							onFork={onFork}
							onSuggestTitle={onSuggestTitle}
							onRename={onRename}
							onDelete={onDelete}
						/>
					</div>
				))}
			</div>
		</section>
	);
}

interface ForkNodeProps {
	session: SessionMetadata;
	isRoot: boolean;
	active: boolean;
	forking: boolean;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onSuggestTitle?: (sessionId: string) => Promise<string>;
	onRename: (sessionId: string, title: string) => void | Promise<void>;
	onDelete: (sessionId: string) => void | Promise<void>;
}

function ForkNode({
	session,
	isRoot,
	active,
	forking,
	onLoad,
	onFork,
	onSuggestTitle,
	onRename,
	onDelete,
}: ForkNodeProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [draft, setDraft] = useState(session.title);
	const [busy, setBusy] = useState(false);
	const [suggesting, setSuggesting] = useState(false);
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

	const suggestTitle = async () => {
		if (!onSuggestTitle) return;
		setSuggesting(true);
		try {
			const suggestion = await onSuggestTitle(session.id);
			setMenuOpen(false);
			setConfirmingDelete(false);
			setDraft(suggestion);
			setRenaming(true);
		} finally {
			setSuggesting(false);
		}
	};

	if (renaming) {
		return (
			<div className="my-0.5 flex flex-1 items-center gap-1.5 rounded-lg border border-border bg-background/60 p-1.5">
				<input
					className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-ring"
					value={draft}
					autoFocus
					disabled={busy}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") void saveRename();
						if (event.key === "Escape") setRenaming(false);
					}}
				/>
				<button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent" aria-label="Cancel rename" onClick={() => setRenaming(false)}>
					<X size={13} />
				</button>
				<button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground disabled:opacity-50" aria-label="Save rename" disabled={busy} onClick={() => void saveRename()}>
					<Check size={13} />
				</button>
			</div>
		);
	}

	if (confirmingDelete) {
		return (
			<div className="my-0.5 flex flex-1 items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-1.5">
				<span className="text-[11px] text-foreground">Delete fork?</span>
				<div className="flex gap-1.5">
					<button type="button" className="rounded px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setConfirmingDelete(false)}>Cancel</button>
					<button type="button" className="rounded bg-destructive px-2 py-1 text-[11px] text-destructive-foreground disabled:opacity-50" disabled={busy} onClick={() => void confirmDelete()}>Delete</button>
				</div>
			</div>
		);
	}

	return (
		<div
			className={`group my-0.5 flex min-w-0 flex-1 items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${
				active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-accent/40"
			}`}
		>
			<button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => void onLoad(session.id)}>
				<span className="flex items-center gap-1.5">
					<span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: isRoot ? "var(--primary)" : "var(--muted-foreground)" }} aria-hidden="true" />
					<span className="truncate text-xs font-medium text-foreground">{session.title}</span>
				</span>
				<span className="ml-3 text-[10px] text-muted-foreground">
					{isRoot ? "Original" : "Fork"} · {formatTime(session.lastModified)} · {session.messageCount} msg
				</span>
			</button>
			<div ref={menuRef} className="relative shrink-0">
				<button
					type="button"
					className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					aria-label="Fork actions"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					disabled={suggesting}
					onClick={() => setMenuOpen((open) => !open)}
				>
					{busy ? <Loader2 size={13} className="animate-spin" /> : <MoreVertical size={14} />}
				</button>
				{menuOpen ? (
					<div role="menu" className="absolute right-0 top-7 z-20 w-32 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg">
						<button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50" disabled={forking} onClick={() => { setMenuOpen(false); void onFork(session.id); }}>
							{forking ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
							Fork
						</button>
						{onSuggestTitle ? (
							<button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50" disabled={busy || suggesting} onClick={() => void suggestTitle()}>
								{suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
								Suggest
							</button>
						) : null}
						<button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { setMenuOpen(false); setDraft(session.title); setRenaming(true); }}>
							<Pencil size={12} />
							Rename
						</button>
						<button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10" onClick={() => { setMenuOpen(false); setConfirmingDelete(true); }}>
							<Trash2 size={12} />
							Delete
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
