import { DOCUMENTATION_URL } from "../../lib/tutorial-links";
export function StartTab() {
	return (
		<nav className="st-links" aria-label="Getting around">
			{(
				[
					["connect-link", "providers", "Connect a model"],
					["profile-link", "profile", "Tell Keating about you"],
					["display-link", "display", "Tune the interface"],
				] as const
			).map(([id, section, label]) => (
				<a
					key={id}
					id={id}
					href={"?settings=" + section}
					onClick={(e) => {
						if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
						e.preventDefault();
						window.dispatchEvent(
							new CustomEvent("keating:settings-tab", { detail: { section } }),
						);
					}}
				>
					{label}
				</a>
			))}
			<a
				id="docs-link"
				href={DOCUMENTATION_URL}
				target="_blank"
				rel="noreferrer"
			>
				Documentation
			</a>
			<button
				id="tour-link"
				onClick={() => window.dispatchEvent(new Event("keating:settings-tour"))}
			>
				Replay the tour
			</button>
		</nav>
	);
}
