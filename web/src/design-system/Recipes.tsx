import { Moon } from "lucide-react";
import { css } from "../../styled-system/css";
import {
	chip,
	dangerBanner,
	fieldInput,
	iconButton,
	outlineButton,
	primaryButton,
	settingsCard,
	textarea,
} from "../../styled-system/recipes";

const pageClass = css({
	padding: "2rem",
	fontFamily: "{fonts.ui}",
	background: "var(--background)",
	color: "var(--foreground)",
	minHeight: "100vh",
});

const sectionTitleClass = css({
	fontSize: "1.25rem",
	fontWeight: 600,
	marginTop: "2rem",
	marginBottom: "0.75rem",
});

const rowClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" });

export function Recipes() {
	return (
		<div className={pageClass}>
			<h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>Design system recipes</h1>
			<p style={{ opacity: 0.7 }}>
				Every recipe is defined once in <code>panda.config.ts</code> and imported from{" "}
				<code>styled-system/recipes</code>. This story exercises each variant so regressions are visible at a glance.
			</p>

			<h2 className={sectionTitleClass}>iconButton</h2>
			<div className={rowClass}>
				{(["sm", "md", "lg"] as const).map((size) =>
					(["ghost", "primary"] as const).map((tone) => (
						<button key={`${size}-${tone}`} type="button" className={iconButton({ size, tone })} title={`${size} / ${tone}`}>
							<Moon size={size === "sm" ? 12 : size === "md" ? 14 : 16} />
						</button>
					)),
				)}
			</div>

			<h2 className={sectionTitleClass}>chip</h2>
			<div className={rowClass}>
				{(["sm", "md"] as const).map((size) =>
					(["muted", "primary", "plain"] as const).map((intent) => (
						<span key={`${size}-${intent}`} className={chip({ size, intent })}>
							{size} / {intent}
						</span>
					)),
				)}
			</div>

			<h2 className={sectionTitleClass}>dangerBanner</h2>
			<div className={dangerBanner({ layout: "row" })}>
				<span>Delete this session?</span>
				<button type="button" className={outlineButton()}>
					Confirm
				</button>
			</div>
			<div style={{ marginTop: "0.75rem" }} className={dangerBanner({ layout: "block" })}>
				Something went wrong saving your changes.
			</div>

			<h2 className={sectionTitleClass}>primaryButton / outlineButton</h2>
			<div className={rowClass}>
				<button type="button" className={primaryButton()}>
					Save changes
				</button>
				<button type="button" className={outlineButton()}>
					Cancel
				</button>
				<button type="button" className={primaryButton()} disabled>
					Disabled
				</button>
			</div>

			<h2 className={sectionTitleClass}>fieldInput</h2>
			<div className={rowClass}>
				{(["auto", "wide", "tight"] as const).map((size) => (
					<input key={size} className={fieldInput({ size })} placeholder={size} defaultValue="" />
				))}
			</div>

			<h2 className={sectionTitleClass}>textarea</h2>
			<textarea className={textarea()} defaultValue="You are a demanding but caring teacher..." />

			<h2 className={sectionTitleClass}>settingsCard</h2>
			<div className={settingsCard({ tone: "default" })} style={{ maxWidth: "32rem" }}>
				<div>
					<div style={{ fontWeight: 600 }}>Persona</div>
					<div style={{ fontSize: "0.875rem", opacity: 0.7 }}>Controls how the teacher speaks to you.</div>
				</div>
				<button type="button" className={outlineButton()}>
					Edit
				</button>
			</div>
		</div>
	);
}
