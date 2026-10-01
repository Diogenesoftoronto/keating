import { ArrowRight, BookOpen, Brain, Cpu, Settings2 } from "lucide-react";
import { css } from "../../../styled-system/css";
import { DOCUMENTATION_URL } from "../../lib/tutorial-links";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "1rem" });
const introClass = css({ fontSize: "0.875rem", lineHeight: "1.375rem", color: "var(--muted-foreground)", maxWidth: "40rem" });
const cardClass = css({
	display: "flex",
	alignItems: "center",
	gap: "0.875rem",
	width: "100%",
	textAlign: "left",
	padding: "1rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--card, transparent)",
	color: "var(--foreground)",
	textDecoration: "none",
	cursor: "pointer",
	transitionProperty: "background-color, border-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
});
const iconClass = css({ flexShrink: 0, color: "var(--primary)" });
const bodyClass = css({ display: "flex", flexDirection: "column", gap: "0.125rem", flex: 1, minWidth: 0 });
const titleClass = css({ fontSize: "0.875rem", fontWeight: 500 });
const descClass = css({ fontSize: "0.8125rem", color: "var(--muted-foreground)" });

const steps = [
	{ tab: "models", icon: Cpu, title: "1. Connect a model", desc: "Add an API key or pick a free/local model so Keating can answer." },
	{ tab: "learning", icon: Brain, title: "2. Tell Keating about you", desc: "Set your learning profile and choose the teacher's persona." },
	{ tab: "app", icon: Settings2, title: "3. Tune the interface", desc: "Control how much agent activity shows, plus sharing and privacy." },
] as const;

/** Landing tab: the short path from a fresh install to a working tutor. */
export function StartTab() {
	return (
		<div className={stackClass}>
			<p className={introClass}>
				New here? Three steps get you learning. Everything else in Settings is optional and can wait.
			</p>
			{steps.map(({ tab, icon: Icon, title, desc }) => (
				<button
					key={tab}
					type="button"
					className={cardClass}
					onClick={() => window.dispatchEvent(new CustomEvent("keating:settings-tab", { detail: tab }))}
				>
					<Icon size={18} className={iconClass} />
					<span className={bodyClass}>
						<span className={titleClass}>{title}</span>
						<span className={descClass}>{desc}</span>
					</span>
					<ArrowRight size={16} />
				</button>
			))}
			<a className={cardClass} href={DOCUMENTATION_URL} target="_blank" rel="noreferrer">
				<BookOpen size={18} className={iconClass} />
				<span className={bodyClass}>
					<span className={titleClass}>Read the documentation</span>
					<span className={descClass}>Guides for choosing a model, learning workflows and troubleshooting.</span>
				</span>
				<ArrowRight size={16} />
			</a>
		</div>
	);
}
