import { useState } from "react";
import {
	Check,
	GitBranch,
	MoreVertical,
	Pencil,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { css } from "../../styled-system/css";
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

import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { Spinner } from "./Spinner";

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
		<section className={css({ display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: "1rem", border: "1px solid var(--border)", background: "var(--background)", boxShadow: "var(--shadow-sm)" })}>
			<header
				className={css({ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 0.875rem" })}
				style={{ background: "linear-gradient(135deg, var(--accent) 0%, transparent 70%)" }}
			>
				<GitBranch size={15} className={css({ flexShrink: 0, color: "var(--primary)" })} />
				<span className={css({ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" })}>{root.session.title}</span>
				<span className={css({ flexShrink: 0, borderRadius: "9999px", background: "color-mix(in srgb, var(--primary) 15%, transparent)", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 500, color: "var(--primary)" })}>
					{forkCount} {forkCount === 1 ? "fork" : "forks"}
				</span>
			</header>

			<div className={css({ padding: "0.25rem 0.5rem 0.625rem" })}>
				{rows.map((row) => (
					<div key={row.session.id} className={css({ display: "flex", alignItems: "stretch" })}>
						{row.ancestorHasNext.map((cont, i) => (
							<span key={i} className={css({ position: "relative", width: "1rem", flexShrink: 0 })}>
								{cont ? (
									<span className={css({ position: "absolute", left: "50%", top: 0, height: "100%", width: "1px", transform: "translateX(-50%)", background: "var(--border)" })} />
								) : null}
							</span>
						))}
						{row.depth >= 1 ? (
							<span className={css({ position: "relative", width: "1rem", flexShrink: 0 })} aria-hidden="true">
								<span className={css({ position: "absolute", left: "50%", top: 0, height: "50%", width: "1px", transform: "translateX(-50%)", background: "var(--border)" })} />
								{!row.isLast ? (
									<span className={css({ position: "absolute", left: "50%", top: "50%", height: "50%", width: "1px", transform: "translateX(-50%)", background: "var(--border)" })} />
								) : null}
								<span className={css({ position: "absolute", left: "50%", top: "50%", height: "1px", width: "50%", background: "var(--border)" })} />
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
	const [renaming, setRenaming] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [draft, setDraft] = useState(session.title);
	const [busy, setBusy] = useState(false);
	const [suggesting, setSuggesting] = useState(false);

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
			setConfirmingDelete(false);
			setDraft(suggestion);
			setRenaming(true);
		} finally {
			setSuggesting(false);
		}
	};

	if (renaming) {
		return (
			<div className={css({ marginBlock: "0.125rem", display: "flex", flex: 1, alignItems: "center", gap: "0.375rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--background) 60%, transparent)", padding: "0.375rem" })}>
				<input
					className={css({ minWidth: 0, flex: 1, borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.25rem 0.5rem", fontSize: "0.75rem", outline: "none", _focus: { borderColor: "var(--ring)" } })}
					value={draft}
					autoFocus
					disabled={busy}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") void saveRename();
						if (event.key === "Escape") setRenaming(false);
					}}
				/>
				<button type="button" className={css({ display: "inline-flex", height: "1.5rem", width: "1.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.25rem", _hover: { background: "var(--accent)" } })} aria-label="Cancel rename" onClick={() => setRenaming(false)}>
					<X size={13} />
				</button>
				<button type="button" className={css({ display: "inline-flex", height: "1.5rem", width: "1.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.25rem", background: "var(--primary)", color: "var(--primary-foreground)", _disabled: { opacity: 0.5 } })} aria-label="Save rename" disabled={busy} onClick={() => void saveRename()}>
					<Check size={13} />
				</button>
			</div>
		);
	}

	if (confirmingDelete) {
		return (
			<div className={css({ marginBlock: "0.125rem", display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderRadius: "0.5rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", background: "color-mix(in srgb, var(--destructive) 5%, transparent)", padding: "0.375rem" })}>
				<span className={css({ fontSize: "0.6875rem", color: "var(--foreground)" })}>Delete fork?</span>
				<div className={css({ display: "flex", gap: "0.375rem" })}>
					<button type="button" className={css({ borderRadius: "0.25rem", padding: "0.25rem 0.5rem", fontSize: "0.6875rem", _hover: { background: "var(--accent)" } })} onClick={() => setConfirmingDelete(false)}>Cancel</button>
					<button type="button" className={css({ borderRadius: "0.25rem", background: "var(--destructive)", padding: "0.25rem 0.5rem", fontSize: "0.6875rem", color: "var(--destructive-foreground)", _disabled: { opacity: 0.5 } })} disabled={busy} onClick={() => void confirmDelete()}>Delete</button>
				</div>
			</div>
		);
	}

	return (
		<div
			className={css({
				marginBlock: "0.125rem",
				display: "flex",
				minWidth: 0,
				flex: 1,
				alignItems: "center",
				gap: "0.25rem",
				borderRadius: "0.5rem",
				border: "1px solid",
				borderColor: active ? "var(--primary)" : "var(--border)",
				background: active ? "color-mix(in srgb, var(--primary) 5%, transparent)" : undefined,
				padding: "0.375rem 0.5rem",
				boxShadow: active ? "0 0 0 1px var(--primary)" : undefined,
				transition: "color 150ms, background-color 150ms, border-color 150ms",
				_hover: active ? undefined : { background: "color-mix(in srgb, var(--accent) 40%, transparent)" },
			})}
		>
			<button type="button" className={css({ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", textAlign: "left" })} onClick={() => void onLoad(session.id)}>
				<span className={css({ display: "flex", alignItems: "center", gap: "0.375rem" })}>
					<span className={css({ height: "0.375rem", width: "0.375rem", flexShrink: 0, borderRadius: "9999px" })} style={{ background: isRoot ? "var(--primary)" : "var(--muted-foreground)" }} aria-hidden="true" />
					<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: 500, color: "var(--foreground)" })}>{session.title}</span>
				</span>
				<span className={css({ marginLeft: "0.75rem", fontSize: "0.625rem", color: "var(--muted-foreground)" })}>
					{isRoot ? "Original" : "Fork"} · {formatTime(session.lastModified)} · {session.messageCount} msg
				</span>
			</button>
			<OverflowMenu
				width="8rem"
				items={[
					{
						key: "fork",
						label: "Fork",
						icon: forking ? <Spinner size={12} /> : <GitBranch size={12} />,
						disabled: forking,
						onSelect: () => void onFork(session.id),
					},
					...(onSuggestTitle
						? [
								{
									key: "suggest",
									label: "Suggest",
									icon: suggesting ? <Spinner size={12} /> : <Sparkles size={12} />,
									disabled: busy || suggesting,
									onSelect: () => void suggestTitle(),
								} satisfies OverflowMenuItem,
							]
						: []),
					{
						key: "rename",
						label: "Rename",
						icon: <Pencil size={12} />,
						onSelect: () => {
							setDraft(session.title);
							setRenaming(true);
						},
					},
					{
						key: "delete",
						label: "Delete",
						icon: <Trash2 size={12} />,
						destructive: true,
						onSelect: () => setConfirmingDelete(true),
					},
				]}
			>
				{({ open }) => (
					<button
						type="button"
						className={css({ display: "inline-flex", height: "1.5rem", width: "1.5rem", alignItems: "center", justifyContent: "center", borderRadius: "9999px", color: "var(--muted-foreground)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
						aria-label="Fork actions"
						aria-haspopup="menu"
						aria-expanded={open}
						disabled={suggesting}
					>
						<Spinner size={13} loading={busy}>
							<MoreVertical size={14} />
						</Spinner>
					</button>
				)}
			</OverflowMenu>
		</div>
	);
}
