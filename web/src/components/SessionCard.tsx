import { useMemo, useState } from "react";
import {
	Atom,
	Check,
	Code2,
	Film,
	FlaskConical,
	GitBranch,
	Landmark,
	Languages,
	ListChecks,
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
import { formatRelativeSessionDate } from "../lib/session-date";
import { sanitizeSvg } from "../lib/sanitize-svg";
import { css, cx } from "../../styled-system/css";
import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { Spinner } from "./Spinner";

const CATEGORY_ICON: Record<CategoryKey, LucideIcon> = {
	science: FlaskConical,
	math: Sigma,
	physics: Atom,
	chemistry: FlaskConical,
	astronomy: Atom,
	"earth-science": FlaskConical,
	"materials-science": FlaskConical,
	history: Landmark,
	cs: Code2,
	language: Languages,
	arts: Palette,
	"molecular-biology": FlaskConical,
	"ecology-environment": FlaskConical,
	"human-anatomy": FlaskConical,
	microbiology: FlaskConical,
	law: Landmark,
	politics: Landmark,
	economics: Landmark,
	philosophy: Landmark,
	"visual-arts": Palette,
	music: Palette,
	"performing-arts": Palette,
	design: Palette,
	linguistics: Languages,
	literature: Languages,
	"creative-writing": Languages,
	"language-learning": Languages,
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
	onSuggestTitle?: (sessionId: string) => Promise<string>;
	onRename: (sessionId: string, title: string) => void | Promise<void>;
	onDelete: (sessionId: string) => void | Promise<void>;
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
	onSuggestTitle,
	onRename,
	onDelete,
}: SessionCardProps) {
	const category = categorize(session.title);
	const Icon = CATEGORY_ICON[category.key];
	const [renaming, setRenaming] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [draft, setDraft] = useState(session.title);
	const [busy, setBusy] = useState(false);
	const [suggesting, setSuggesting] = useState(false);
	const safeHeroSvg = useMemo(() => (hero?.svg ? sanitizeSvg(hero.svg) : ""), [hero?.svg]);

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

	const HeroBadgeIcon = hero ? HERO_ICON[hero.type] : null;

	return (
		<div
			className={cx(
				justForked ? "session-fork-arrive" : "",
				css({
					position: "relative",
					display: "flex",
					height: "100%",
					flexDirection: "column",
					overflow: "hidden",
					borderRadius: "1rem",
					border: "1px solid",
					borderColor: active ? "var(--primary)" : "var(--border)",
					textAlign: "left",
					boxShadow: active ? "0 0 0 1px var(--primary), var(--shadow-sm)" : "var(--shadow-sm)",
					transition: "color 150ms, background-color 150ms, border-color 150ms",
				}),
			)}
		>
			{/* Hero band: rendered map SVG when available, otherwise a category tile. */}
			<button
				type="button"
				className={css({ position: "relative", display: "block", width: "100%", textAlign: "left" })}
				onClick={() => void onLoad(session.id)}
				aria-label={`Open session ${session.title}`}
			>
				{safeHeroSvg ? (
					<div
						className={cx("session-card-hero-svg", css({ display: "flex", height: { base: "5rem", sm: "7rem" }, width: "100%", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "color-mix(in srgb, var(--muted) 40%, transparent)" }))}
						dangerouslySetInnerHTML={{ __html: safeHeroSvg }}
					/>
				) : (
					<div
						className={css({ display: "flex", height: { base: "3rem", sm: "5rem" }, width: "100%", alignItems: "center", justifyContent: "space-between", paddingInline: { base: "0.75rem", sm: "1rem" } })}
						style={{ background: categoryGradient(category.accent) }}
					>
						<Icon size={20} className={css({ sm: { width: "26px", height: "26px" } })} style={{ color: category.accent }} aria-hidden="true" />
						<span
							className={css({ borderRadius: "9999px", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.025em", textTransform: "uppercase" })}
							style={{ color: category.accent, background: `${category.accent}1f` }}
						>
							{category.label}
						</span>
					</div>
				)}
				{HeroBadgeIcon ? (
					<span className={css({ position: "absolute", left: "0.5rem", top: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "9999px", background: "color-mix(in srgb, var(--background) 85%, transparent)", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 500, color: "var(--foreground)", backdropFilter: "blur(8px)" })}>
						<HeroBadgeIcon size={11} />
						{hero?.type}
					</span>
				) : null}
			</button>

			<button
				type="button"
				className={css({ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", paddingInline: { base: "0.625rem", sm: "0.875rem" }, paddingBottom: { base: "0.625rem", sm: "0.75rem" }, paddingTop: { base: "0.5rem", sm: "0.625rem" }, textAlign: "left" })}
				onClick={() => void onLoad(session.id)}
			>
				<span className={css({ fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>{formatRelativeSessionDate(session.lastModified, { today: "time" })}</span>
				<h3 className={css({ marginTop: "0.125rem", display: "flex", minWidth: 0, alignItems: "center", gap: "0.375rem", fontSize: { base: "0.75rem", sm: "0.875rem" }, fontWeight: 600, lineHeight: 1.375, color: "var(--foreground)" })}>
					{session.parentSessionId ? (
						<GitBranch size={13} className={css({ marginTop: "0.125rem", flexShrink: 0, alignSelf: "flex-start", color: "var(--primary)" })} />
					) : null}
					<span className={css({ overflow: "hidden", lineClamp: { base: 2, sm: 3 }, overflowWrap: "break-word" })}>{session.title}</span>
				</h3>
				{session.preview ? (
					<p className={css({ marginTop: "0.25rem", lineClamp: { base: 2, sm: 3 }, overflowWrap: "break-word", fontSize: "0.75rem", lineHeight: { base: 1.375, sm: "1.25rem" }, color: "var(--muted-foreground)" })}>{session.preview}</p>
				) : null}
				<div className={css({ marginTop: { base: "0.375rem", sm: "0.5rem" }, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "0.5rem", rowGap: "0.25rem", fontSize: "0.625rem", color: "var(--muted-foreground)" })}>
					<span>{session.messageCount} messages</span>
					{childCount > 0 ? (
						<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.125rem", borderRadius: "0.25rem", background: "var(--muted)", padding: "0.125rem 0.375rem" })}>
							<GitBranch size={9} />
							{childCount}
						</span>
					) : null}
				</div>
			</button>

			{/* Overflow menu */}
			<div className={css({ position: "absolute", right: "0.375rem", top: "0.375rem", display: "flex", alignItems: "center", gap: "0.25rem" })}>
				{onSuggestTitle ? (
					<button
						type="button"
						className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: "color-mix(in srgb, var(--background) 80%, transparent)", color: "var(--muted-foreground)", backdropFilter: "blur(8px)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" }, _disabled: { opacity: 0.5 } })}
						aria-label="Suggest title with AI"
						disabled={busy || suggesting}
						onClick={() => void suggestTitle()}
					>
						<Spinner size={14} loading={suggesting}>
							<Sparkles size={14} />
						</Spinner>
					</button>
				) : null}
				<OverflowMenu
					offset={4}
					items={[
						{
							key: "fork",
							label: "Fork",
							icon: forking ? <Spinner size={13} /> : <GitBranch size={13} />,
							disabled: forking,
							onSelect: () => void onFork(session.id),
						},
						{
							key: "rename",
							label: "Rename",
							icon: <Pencil size={13} />,
							onSelect: () => {
								setConfirmingDelete(false);
								setDraft(session.title);
								setRenaming(true);
							},
						},
						{
							key: "delete",
							label: "Delete",
							icon: <Trash2 size={13} />,
							destructive: true,
							onSelect: () => {
								setRenaming(false);
								setConfirmingDelete(true);
							},
						},
					] satisfies OverflowMenuItem[]}
				>
					{({ open }) => (
						<button
							type="button"
							className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: "color-mix(in srgb, var(--background) 80%, transparent)", color: "var(--muted-foreground)", backdropFilter: "blur(8px)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
							aria-label="Session actions"
							aria-haspopup="menu"
							aria-expanded={open}
							disabled={suggesting}
						>
							<Spinner size={14} loading={busy}>
								<MoreVertical size={15} />
							</Spinner>
						</button>
					)}
				</OverflowMenu>
			</div>

			{renaming ? (
				<div className={css({ display: "flex", alignItems: "center", gap: "0.375rem", borderTop: "1px solid var(--border)", background: "color-mix(in srgb, var(--background) 60%, transparent)", padding: "0.5rem" })}>
					<input
						className={css({ minWidth: 0, flex: 1, borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontSize: "0.75rem", outline: "none", _focus: { borderColor: "var(--ring)" } })}
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
						className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", _hover: { background: "var(--accent)" } })}
						aria-label="Cancel rename"
						onClick={() => setRenaming(false)}
					>
						<X size={14} />
					</button>
					<button
						type="button"
						className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", background: "var(--primary)", color: "var(--primary-foreground)", _disabled: { opacity: 0.5 } })}
						aria-label="Save rename"
						disabled={busy}
						onClick={() => void saveRename()}
					>
						<Check size={14} />
					</button>
				</div>
			) : null}

			{confirmingDelete ? (
				<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderTop: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", background: "color-mix(in srgb, var(--destructive) 5%, transparent)", padding: "0.5rem" })}>
					<span className={css({ fontSize: "0.6875rem", color: "var(--foreground)" })}>Delete session?</span>
					<div className={css({ display: "flex", gap: "0.375rem" })}>
						<button
							type="button"
							className={css({ borderRadius: "0.375rem", padding: "0.25rem 0.5rem", fontSize: "0.6875rem", _hover: { background: "var(--accent)" } })}
							onClick={() => setConfirmingDelete(false)}
						>
							Cancel
						</button>
						<button
							type="button"
							className={css({ borderRadius: "0.375rem", background: "var(--destructive)", padding: "0.25rem 0.5rem", fontSize: "0.6875rem", color: "var(--destructive-foreground)", _disabled: { opacity: 0.5 } })}
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
