export interface SettingsSection {
	id: string;
	label: string;
}

/**
 * Sticky in-tab section jump nav shared by settings tabs (Speech, Providers, …).
 * Each button scrolls to the element with id `settings-section-{id}`.
 *
 * Buttons carry `dialog-compact-button` so the global mobile rule
 * (`[role=dialog] button { width: 100% }`) doesn't stretch them full-width.
 */
export function SettingsSectionNav({ sections }: { sections: SettingsSection[] }) {
	const scrollToSection = (id: string) => {
		const el = document.getElementById(`settings-section-${id}`);
		if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	return (
		<nav className="sticky -top-4 sm:-top-5 z-10 -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 px-4 sm:px-5 pt-3 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border">
			<div className="flex flex-wrap gap-1.5">
				{sections.map((s) => (
					<button
						key={s.id}
						type="button"
						onClick={() => scrollToSection(s.id)}
						className="dialog-compact-button rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
					>
						{s.label}
					</button>
				))}
			</div>
		</nav>
	);
}
