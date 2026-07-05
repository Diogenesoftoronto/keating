import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Brain, Cpu, Settings2, X } from "lucide-react";
import { css, cx } from "../../styled-system/css";

export interface SettingsTabDef {
	id: string;
	label: string;
	component: React.ReactNode;
}

interface SettingsDialogProps {
	open: boolean;
	tabs: SettingsTabDef[];
	onClose: () => void;
	defaultTabId?: string;
}

const overlayClass = css({
	position: "fixed",
	inset: 0,
	zIndex: 1000,
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "center",
	backgroundColor: "rgba(0, 0, 0, 0.5)",
	backdropFilter: "blur(4px)",
	paddingInline: "1rem",
	paddingTop: "1.5rem",
	paddingBottom: "1.5rem",
});
const panelClass = css({
	display: "flex",
	width: "100%",
	maxWidth: "64rem",
	maxHeight: "90vh",
	overflow: "hidden",
	borderRadius: "0.5rem",
	border: "2px solid var(--border)",
	backgroundColor: "var(--background)",
	boxShadow: "var(--shadow-lg)",
});
const sidebarClass = css({
	display: "none",
	width: "14rem",
	flexDirection: "column",
	borderRight: "1px solid var(--border)",
	backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
	flexShrink: 0,
	lg: { display: "flex" },
});
const sidebarHeaderClass = css({
	paddingInline: "1rem",
	paddingBlock: "0.75rem",
	borderBottom: "1px solid var(--border)",
});
const sidebarTitleClass = css({
	fontSize: "0.875rem",
	fontWeight: 600,
	color: "var(--foreground)",
});
const sidebarListClass = css({
	display: "flex",
	flexDirection: "column",
	padding: "0.5rem",
	gap: "0.25rem",
	overflowY: "auto",
});
const sidebarTabBaseClass = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.5rem",
	textAlign: "left",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	borderRadius: "0.375rem",
	fontSize: "0.875rem",
	transitionProperty: "color, background-color",
	transitionDuration: "150ms",
});
const sidebarTabActiveClass = css({
	backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
	color: "var(--primary)",
	fontWeight: 500,
});
const sidebarTabIdleClass = css({
	color: "var(--muted-foreground)",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
});
const contentColumnClass = css({
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
});
const headerClass = css({
	display: "flex",
	minHeight: "3.5rem",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "0.75rem",
	paddingInline: "1rem",
	paddingBlock: "0.5rem",
	borderBottom: "1px solid var(--border)",
});
const mobileTablistClass = css({
	display: "flex",
	minWidth: 0,
	flex: 1,
	gap: "0.375rem",
	overflowX: "auto",
	lg: { display: "none" },
});
const mobileTabBaseClass = css({
	whiteSpace: "nowrap",
	borderRadius: "0.375rem",
	paddingInline: "0.75rem",
	paddingBlock: "0.375rem",
	fontSize: "0.875rem",
	minHeight: "2.25rem",
	transitionProperty: "color, background-color",
	transitionDuration: "150ms",
});
const mobileTabActiveClass = css({
	backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
	color: "var(--primary)",
	fontWeight: 500,
});
const mobileTabIdleClass = css({
	color: "var(--muted-foreground)",
	border: "1px solid var(--border)",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
});
const desktopTitleClass = css({
	fontSize: "0.875rem",
	fontWeight: 500,
	display: "none",
	lg: { display: "block" },
});
const closeButtonClass = css({
	display: "inline-flex",
	height: "2.25rem",
	width: "2.25rem",
	flexShrink: 0,
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	color: "var(--muted-foreground)",
	transitionProperty: "color, background-color",
	transitionDuration: "150ms",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
});
const tabpanelClass = css({
	flex: 1,
	overflowY: "auto",
	padding: "1rem",
	sm: { padding: "1.25rem" },
});

export function SettingsDialog({ open, tabs, onClose, defaultTabId }: SettingsDialogProps) {
	const [activeTab, setActiveTab] = useState(0);
	const dialogRef = useRef<HTMLDivElement>(null);
	const mobileTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

	useEffect(() => {
		if (!open) return;
		const idx = defaultTabId
			? tabs.findIndex((t) => t.id === defaultTabId)
			: activeTab < tabs.length
				? activeTab
				: 0;
		setActiveTab(idx >= 0 ? idx : 0);
	}, [open, defaultTabId, tabs]);

	useEffect(() => {
		if (!open) return;
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleEscape);
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", handleEscape);
			document.body.style.overflow = "";
		};
	}, [open, onClose]);

	const handleBackdropClick = useCallback((e: React.MouseEvent) => {
		if (e.target === dialogRef.current) onClose();
	}, [onClose]);

	const focusMobileTab = useCallback((idx: number) => {
		requestAnimationFrame(() => mobileTabRefs.current[idx]?.focus());
	}, []);

	const moveMobileTab = useCallback((idx: number) => {
		if (tabs.length === 0) return;
		const next = (idx + tabs.length) % tabs.length;
		setActiveTab(next);
		focusMobileTab(next);
	}, [focusMobileTab, tabs.length]);

	if (!open) return null;

	const iconForTab = (id: string) => {
		if (id === "models") return <Cpu size={15} />;
		if (id === "learning") return <Brain size={15} />;
		if (id === "app") return <Settings2 size={15} />;
		return <BookOpen size={15} />;
	};

	return (
		<div
			ref={dialogRef}
			className={overlayClass}
			onClick={handleBackdropClick}
		>
			<div
				role="dialog"
				aria-modal="true"
				className={panelClass}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Sidebar */}
				<aside className={sidebarClass}>
					<div className={sidebarHeaderClass}>
						<span className={sidebarTitleClass}>Settings</span>
					</div>
					<div className={sidebarListClass}>
						{tabs.map((tab, i) => (
							<button
								key={tab.id}
								onClick={() => setActiveTab(i)}
								className={cx(sidebarTabBaseClass, i === activeTab ? sidebarTabActiveClass : sidebarTabIdleClass)}
							>
								{iconForTab(tab.id)}
								<span>{tab.label}</span>
							</button>
						))}
					</div>
				</aside>

				{/* Content */}
				<div className={contentColumnClass}>
					<div className={headerClass}>
						<div
							className={mobileTablistClass}
							role="tablist"
							aria-label="Settings tab"
						>
							{tabs.map((tab, i) => (
								<button
									key={tab.id}
									ref={(node) => {
										mobileTabRefs.current[i] = node;
									}}
									type="button"
									role="tab"
									aria-selected={i === activeTab}
									aria-controls="settings-tabpanel"
									tabIndex={i === activeTab ? 0 : -1}
									onClick={() => setActiveTab(i)}
									onKeyDown={(event) => {
										if (event.key === "ArrowRight" || event.key === "ArrowDown") {
											event.preventDefault();
											moveMobileTab(i + 1);
										} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
											event.preventDefault();
											moveMobileTab(i - 1);
										} else if (event.key === "Home") {
											event.preventDefault();
											setActiveTab(0);
											focusMobileTab(0);
										} else if (event.key === "End") {
											event.preventDefault();
											const last = tabs.length - 1;
											setActiveTab(last);
											focusMobileTab(last);
										}
									}}
									className={cx(mobileTabBaseClass, i === activeTab ? mobileTabActiveClass : mobileTabIdleClass)}
								>
									<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.375rem" })}>
										{iconForTab(tab.id)}
										{tab.label}
									</span>
								</button>
							))}
						</div>
						<span className={desktopTitleClass}>{tabs[activeTab]?.label}</span>
						<button
							onClick={onClose}
							className={closeButtonClass}
							aria-label="Close"
						>
							<X size={16} />
						</button>
					</div>
					<div
						id="settings-tabpanel"
						role="tabpanel"
						aria-label={tabs[activeTab]?.label ?? "Settings"}
						className={tabpanelClass}
					>
						{tabs[activeTab]?.component}
					</div>
				</div>
			</div>
		</div>
	);
}
