import { css } from "../../styled-system/css";

export interface SettingsSection {
	id: string;
	label: string;
}

const stickyNavClass = css({
	position: "sticky",
	top: "-1rem",
	zIndex: 10,
	marginInline: "-1rem",
	marginTop: "-1rem",
	paddingInline: "1rem",
	paddingTop: "0.75rem",
	paddingBottom: "0.5rem",
	backgroundColor: "color-mix(in srgb, var(--background) 95%, transparent)",
	backdropFilter: "blur(8px)",
	borderBottom: "1px solid var(--border)",
	sm: {
		top: "-1.25rem",
		marginInline: "-1.25rem",
		marginTop: "-1.25rem",
		paddingInline: "1.25rem",
	},
});
const chipsRowClass = css({
	display: "flex",
	flexWrap: "wrap",
	gap: "0.375rem",
});
const chipClass = css({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.625rem",
	paddingBlock: "0.25rem",
	fontSize: "0.75rem",
	color: "var(--muted-foreground)",
	transitionProperty: "color, background-color",
	transitionDuration: "150ms",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
});

/**
 * Sticky in-tab section jump nav shared by settings tabs (Speech, Providers, …).
 * Each button scrolls to the element with id `settings-section-{id}`.
 */
export function SettingsSectionNav({ sections }: { sections: SettingsSection[] }) {
	const scrollToSection = (id: string) => {
		const el = document.getElementById(`settings-section-${id}`);
		if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	return (
		<nav className={stickyNavClass}>
			<div className={chipsRowClass}>
				{sections.map((s) => (
					<button
						key={s.id}
						type="button"
						onClick={() => scrollToSection(s.id)}
						className={chipClass}
					>
						{s.label}
					</button>
				))}
			</div>
		</nav>
	);
}
