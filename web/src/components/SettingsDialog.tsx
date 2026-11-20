import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { Button, ConfirmDialog, IconButton } from "../design-system/kit";
import { motionAllowed } from "../design-system/motion";
import { DOCUMENTATION_URL } from "../lib/tutorial-links";
import { eventDestination } from "../hooks/agent/settings-deep-link";
import { useMediaQuery } from "../hooks/use-media-query";
import { groups, resolveDestination } from "./settings/groups";
import { LearningTab } from "./settings/LearningTab";
import {
	SettingsSearchField,
	SettingsSearchResults,
} from "./settings/search/Search";
import { searchSettings } from "./settings/search";
import {
	currentEntry,
	leaveSettings,
	pushEntry,
	replaceEntry,
	type SettingsEntry,
} from "./settings/settings-history";
import {
	SettingsStatusContext,
	useSectionStatus,
	type SectionStatus,
} from "./settings/ui";

export interface SettingsTabDef {
	id: string;
	label: string;
	group?: string;
	description?: string;
	docsPath?: string;
	component: ReactNode;
}
interface Props {
	open: boolean;
	onClose(): void;
	onTour?(): void;
	defaultTabId?: string;
	tabs?: SettingsTabDef[];
}
/** `group.section` for the URL, unless the name is an alias that also picks a sub-anchor. */
function canonical(raw: string) {
	const { group, section, anchor } = resolveDestination(raw);
	return anchor ? raw : group.id + "." + section.id;
}
export function SettingsDialog(props: Props) {
	return props.open ? <OpenSettings {...props} /> : null;
}

// Temporary adapter until the Learning lane adopts useSectionStatus. The two
// editors already expose their authoritative save eligibility and actions.
function legacyDrafts(root: HTMLElement | null) {
	if (!root) return [];
	const persona =
		root.querySelector("#teacher-persona")?.parentElement?.parentElement;
	const profile = root.querySelector(".pf-savebar");
	const saves = [
		profile?.querySelector<HTMLButtonElement>("button:last-of-type"),
		persona?.querySelector<HTMLButtonElement>("button"),
	];
	return saves.flatMap((button, index) =>
		button && !button.disabled
			? [
					{
						save: () => button.click(),
						count:
							index === 0
								? Number(
										profile
											?.querySelector("span")
											?.textContent?.match(/^\d+/)?.[0] ?? 1,
									)
								: 1,
					},
				]
			: [],
	);
}
function RegistryStatus({
	id,
	useStatus,
}: {
	id: string;
	useStatus: () => string;
}) {
	useSectionStatus(id, { text: useStatus() });
	return null;
}
function OpenSettings({ onClose, onTour, defaultTabId, tabs }: Props) {
	// Where Settings opened: an entry the URL already describes (deep link,
	// reload, Forward) is adopted; otherwise Settings pushes its first entry.
	const [opening] = useState(() => {
		const here =
			typeof window === "undefined"
				? null
				: currentEntry(window.location, window.history.state);
		return here
			? { entry: here, adopt: true }
			: {
					entry: {
						raw: defaultTabId ?? "interface",
						list: !defaultTabId,
						depth: 1,
					},
					adopt: false,
				};
	});
	const [location, setLocation] = useState({
		raw: opening.entry.raw,
		row: "",
		list: opening.entry.list,
	});
	/** Entries Settings pushed since it opened; 0 is the entry it opened on. */
	const depth = useRef(opening.entry.depth);
	/** The section the phone outline should focus when Back returns to it. */
	const cameFrom = useRef("");
	const { group, section, anchor } = resolveDestination(location.raw);
	const [visitedLearning, setVisitedLearning] = useState(
		group.id === "learning",
	);
	const phoneList = location.list;
	const phone = useMediaQuery("(max-width: 700px)");
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const [confirm, setConfirm] = useState(false);
	const tour = useRef(false);
	const dialog = useRef<HTMLDialogElement>(null);
	const main = useRef<HTMLElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const [statuses, setStatuses] = useState<Record<string, SectionStatus>>({});
	const [legacyCount, setLegacyCount] = useState(0);
	const report = useCallback(
		(id: string, status?: SectionStatus) =>
			setStatuses((old) => {
				const next = { ...old };
				if (status) next[id] = status;
				else delete next[id];
				return next;
			}),
		[],
	);
	const here = useRef(location);
	here.current = location;
	const show = useCallback((entry: Pick<SettingsEntry, "raw" | "list">, row = "") => {
		if (resolveDestination(entry.raw).group.id === "learning")
			setVisitedLearning(true);
		if (entry.list) cameFrom.current = resolveDestination(here.current.raw).section.id;
		setLocation({ raw: entry.raw, row, list: entry.list });
		setQuery("");
	}, []);
	/** Go somewhere inside Settings, as a new history entry Back can return from. */
	const go = useCallback(
		(entry: Pick<SettingsEntry, "raw" | "list">, row = "") => {
			const now = here.current;
			const same =
				now.list === entry.list &&
				(entry.list ||
					resolveDestination(now.raw).section ===
						resolveDestination(entry.raw).section);
			if (!same && typeof window !== "undefined") {
				depth.current += 1;
				pushEntry(window.history, window.location, {
					raw: canonical(entry.raw),
					list: entry.list,
					depth: depth.current,
				});
			}
			show(entry, row);
		},
		[show],
	);
	const navigate = useCallback(
		(raw: string, row = "") => go({ raw, list: false }, row),
		[go],
	);
	const count = Object.values(statuses).reduce(
		(n, s) => n + (s.count ?? 0),
		legacyCount,
	);
	const dirty = () => !!(count || legacyDrafts(main.current).length);
	/** Close Settings. `left` means history already moved off Settings (browser Back). */
	function finish(left = false) {
		if (!left && typeof window !== "undefined")
			leaveSettings(window.history, window.location, depth.current);
		depth.current = 0;
		onClose();
		if (tour.current) onTour?.();
	}
	function close() {
		if (dirty()) setConfirm(true);
		else finish();
	}
	/** In-panel Back: the previous Settings entry, or close at the one Settings opened on. */
	function back() {
		if (depth.current > 0 && typeof window !== "undefined") window.history.back();
		else close();
	}
	// Register the entry Settings opened on (once, StrictMode re-runs effects).
	const registered = useRef(false);
	useLayoutEffect(() => {
		if (registered.current || typeof window === "undefined") return;
		registered.current = true;
		(opening.adopt ? replaceEntry : pushEntry)(
			window.history,
			window.location,
			opening.adopt
				? opening.entry
				: { ...opening.entry, raw: canonical(opening.entry.raw) },
		);
	}, [opening]);
	// Browser Back and Forward between Settings entries.
	const latest = useRef({ dirty, finish });
	latest.current = { dirty, finish };
	useEffect(() => {
		function onPopState() {
			const entry = currentEntry(window.location, window.history.state);
			if (entry) {
				depth.current = entry.depth;
				show(entry);
				return;
			}
			// Back past the entry Settings opened on.
			if (latest.current.dirty()) {
				const { raw, list } = here.current;
				pushEntry(window.history, window.location, {
					raw,
					list,
					depth: depth.current,
				});
				setConfirm(true);
			} else latest.current.finish(true);
		}
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [show]);
	useLayoutEffect(() => {
		const node = dialog.current!;
		const previous = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		node.showModal();
		document.body.style.overflow = "hidden";
		return () => {
			node.close();
			document.body.style.overflow = overflow;
			requestAnimationFrame(() => {
				if (document.querySelector("dialog:modal")) return;
				const launcher =
					previous?.isConnected &&
					previous !== document.body &&
					previous.getClientRects().length
						? previous
						: document.querySelector<HTMLElement>('[aria-label="More menu"]');
				launcher?.focus({ preventScroll: true });
			});
		};
	}, []);
	useEffect(() => {
		const node = main.current;
		if (!node || !visitedLearning) return;
		const sync = () =>
			setLegacyCount(legacyDrafts(node).reduce((n, d) => n + d.count, 0));
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(node, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["disabled"],
		});
		return () => observer.disconnect();
	}, [visitedLearning]);
	useEffect(() => {
		function route(e: Event) {
			const detail = (e as CustomEvent).detail;
			// ModelRolesPanel's legacy Voice settings link requests the Learning tab.
			navigate(
				detail === "learning" &&
					(document.activeElement?.textContent?.trim() === "Voice settings" ||
						(group.id === "models" &&
							document.activeElement?.closest("#settings-section-model-roles")))
					? "voice"
					: eventDestination(detail),
			);
		}
		window.addEventListener("keating:settings-tab", route);
		return () => window.removeEventListener("keating:settings-tab", route);
	}, [navigate, group.id]);
	useEffect(() => {
		function replay() {
			tour.current = true;
			close();
		}
		window.addEventListener("keating:settings-tour", replay);
		return () => window.removeEventListener("keating:settings-tour", replay);
	});
	useLayoutEffect(() => {
		if (phoneList && window.matchMedia("(max-width: 700px)").matches) {
			const outline = dialog.current?.querySelector(".st-outline");
			(
				outline?.querySelector<HTMLElement>(
					`.st-sub[data-section="${cameFrom.current}"]`,
				) ?? outline?.querySelector<HTMLElement>(".st-sub")
			)?.focus();
			return;
		}
		const heading = main.current?.querySelector<HTMLElement>("#st-heading");
		const target =
			document.getElementById(location.row) ||
			document.getElementById(anchor ?? "") ||
			document.getElementById(section.anchor ?? "");
		if (target && main.current?.contains(target)) {
			const focus = location.row
				? target
				: target.matches("h2,h3,h4")
					? target
					: (target.querySelector<HTMLElement>("h2,h3,h4") ?? target);
			focus.tabIndex = -1;
			focus.focus({ preventScroll: true });
			const container = main.current;
			// Desktop Settings is CSS-zoomed: client rects are in viewport pixels, scrollTop is not.
			const zoom =
				(container as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
			container.scrollTo({
				top:
					container.scrollTop +
					(target.getBoundingClientRect().top -
						container.getBoundingClientRect().top) /
						zoom -
					8,
				behavior: motionAllowed() ? "smooth" : "instant",
			});
		} else {
			main.current?.scrollTo(0, 0);
			heading?.focus({ preventScroll: true });
		}
	}, [location, phoneList, anchor, section]);
	const results = query.trim() ? searchSettings(query) : [];
	function selectResult(i: number) {
		const e = results[i];
		if (e) navigate(e.section, e.id === "st-heading" ? "" : e.id);
	}
	const searchProps = { query, index, results, selectResult };
	const Pane = section.component,
		Aside = section.aside,
		Supplement = section.supplement;
	const custom = tabs?.find((t) => t.id === location.raw);
	const sectionStatus = (id: string) => {
		const s = statuses[id];
		if (!s) return undefined;
		return s.count ? s.count + " unsaved" : s.text;
	};
	const statusFor = (id: string) => {
		const entries = groups
			.find((g) => g.id === id)!
			.sections.map((s) => statuses[s.id])
			.filter(Boolean);
		const n = entries.reduce(
			(total, s) => total + (s.count ?? 0),
			id === "learning" ? legacyCount : 0,
		);
		return n ? n + " unsaved" : entries.find((s) => s.text)?.text;
	};
	// Phone: Back leads the top bar (it closes from the first page) and search sits at the bottom, in DOM order too.
	const top = (<header className="st-top">
			<h2 id="st-title">Settings</h2>
			<SettingsSearchField
				{...searchProps}
				ref={input}
				setQuery={setQuery}
				setIndex={setIndex}
			/>
			<a
				className="st-docs"
				href={DOCUMENTATION_URL + group.docsPath}
				target="_blank"
				rel="noreferrer"
			>
				<KeatingGlyph name="book" /> Documentation
			</a>
			{!phone && <IconButton label="Close settings" glyph="x" onClick={close} />}
		</header>);
	const bar = (
		<div className="st-mobilebar">
			<button type="button" className="st-back" onClick={back}>
				<KeatingGlyph name="chevl" />
				<span>Back</span>
			</button>
			<span className="st-crumb">{phoneList ? "Settings" : group.title}</span>
			{phoneList ? (
				<span className="st-bar-spacer" aria-hidden="true" />
			) : (
				<button
					type="button"
					className="st-all"
					aria-label="All settings"
					onClick={() => go({ raw: location.raw, list: true })}
				>
					<KeatingGlyph name="menu" />
					<span>All settings</span>
				</button>
			)}
		</div>
	);
	return (
		<SettingsStatusContext.Provider value={report}>
			<dialog
				className="st-dialog"
				ref={dialog}
				role="dialog"
				aria-modal="true"
				aria-labelledby="st-title"
				onCancel={(e) => {
					// A picker or confirmation opened inside Settings handles its own Escape.
					if (e.target !== e.currentTarget) return;
					e.preventDefault();
					close();
				}}
				onClick={(e) => {
					if (e.target === dialog.current) {
						const r = dialog.current.getBoundingClientRect();
						if (
							e.clientX < r.left ||
							e.clientX > r.right ||
							e.clientY < r.top ||
							e.clientY > r.bottom
						)
							close();
					}
				}}
				onKeyDown={(e) => {
					if (
						e.target instanceof HTMLElement &&
						e.target.closest("dialog") !== dialog.current
					)
						return;
					if (
						e.key === "/" &&
						!(e.target as HTMLElement).closest(
							"input,textarea,[contenteditable=true]",
						)
					) {
						e.preventDefault();
						input.current?.focus();
					}
					if (e.key === "Tab") {
						const nodes = Array.from(
							dialog.current!.querySelectorAll<HTMLElement>(
								'button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]',
							),
						).filter(
							(n) =>
								n.tabIndex >= 0 &&
								n.getClientRects().length &&
								n.closest("dialog") === dialog.current,
						);
						if (e.shiftKey && e.target === nodes[0]) {
							e.preventDefault();
							nodes.at(-1)?.focus();
						} else if (!e.shiftKey && e.target === nodes.at(-1)) {
							e.preventDefault();
							nodes[0]?.focus();
						}
					}
				}}
			>
				{groups.flatMap((g) =>
					g.sections.map((s) =>
						s.useStatus ? (
							<RegistryStatus key={s.id} id={s.id} useStatus={s.useStatus} />
						) : null,
					),
				)}
				{!phone && top}
				{bar}
				<div className="st-body" data-list={phoneList} hidden={!!query.trim()}>
					<nav className="st-outline" aria-label="Settings outline">
						{groups.map((g) => (
							<Fragment key={g.id}>
								<button
									className="st-group"
									data-group={g.id}
									aria-expanded={g === group}
									onClick={() => navigate(g.id)}
								>
									<KeatingGlyph name={g.glyph} />
									<span>
										{g.title}
										<small className="st-summary">
											{statusFor(g.id) ?? g.currentSummary()}
										</small>
									</span>
									<small className="st-badge">{statusFor(g.id)}</small>
								</button>
								{/* The phone outline lists every section under a plain heading. */}
								<h3 className="st-grouphead" id={"st-grouphead-" + g.id}>
									<KeatingGlyph name={g.glyph} />
									<span>
										{g.title}
										<small>{statusFor(g.id) ?? g.currentSummary()}</small>
									</span>
								</h3>
								<ul
									className="st-subs"
									data-open={g === group}
									aria-labelledby={"st-grouphead-" + g.id}
								>
									{g.sections
										.filter((s) => !s.available || s.available())
										.map((s) => (
											<li key={s.id}>
												<button
													className="st-sub"
													data-section={s.id}
													aria-current={
														s === section && !phoneList ? "page" : undefined
													}
													onClick={() => navigate(s.id)}
												>
													<span>{s.title}</span>
													{sectionStatus(s.id) && (
														<small>{sectionStatus(s.id)}</small>
													)}
													<KeatingGlyph name="chevr" />
												</button>
											</li>
										))}
								</ul>
							</Fragment>
						))}
					</nav>
					<div className="st-page">
						<div className="st-columns">
							<main ref={main} className="st-main" data-section={section.id}>
								<h3 id="st-heading" tabIndex={-1}>
									{section.title}
								</h3>
								{Supplement && <Supplement />}
								{visitedLearning && (
									<div hidden={Pane !== LearningTab || !!custom}>
										<LearningTab />
									</div>
								)}
								{custom ? (
									custom.component
								) : Pane !== LearningTab ? (
									<Pane />
								) : null}
							</main>
							{Aside && (
								<aside className="st-aside">
									<Aside />
								</aside>
							)}
						</div>
					</div>
				</div>
				<SettingsSearchResults {...searchProps} />
				{phone && top}
				<ConfirmDialog
					open={confirm}
					title="Unsaved changes"
					description="Discarding loses the changes you made to these settings."
					cancelLabel="Keep editing"
					onCancel={() => {
						setConfirm(false);
						tour.current = false;
					}}
					confirmLabel="Discard"
					onConfirm={() => finish()}
				>
					<Button
						onClick={() => {
							legacyDrafts(main.current).forEach((d) => d.save());
							Object.values(statuses).forEach((s) => {
								if (s.count) s.save?.();
							});
							finish();
						}}
					>
						Save
					</Button>
				</ConfirmDialog>
			</dialog>
		</SettingsStatusContext.Provider>
	);
}
