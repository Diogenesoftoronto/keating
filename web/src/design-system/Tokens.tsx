import { css } from "../../styled-system/css";

// Explicit name -> --css-var pairs, since the alias table in panda.config.ts's
// globalCss isn't a 1:1 kebab-case of the token name (e.g. `--accent` aliases
// `accentSurface`, not `accent`; `chart1` aliases `--chart-1`).
const COLOR_GROUPS: { title: string; entries: [string, string][] }[] = [
	{
		title: "Surfaces",
		entries: [
			["background", "--background"],
			["foreground", "--foreground"],
			["card", "--card"],
			["card-foreground", "--card-foreground"],
			["popover", "--popover"],
			["popover-foreground", "--popover-foreground"],
			["paper", "--paper"],
			["paper-deep", "--paper-deep"],
		],
	},
	{
		title: "Brand",
		entries: [
			["primary", "--primary"],
			["primary-foreground", "--primary-foreground"],
			["secondary", "--secondary"],
			["secondary-foreground", "--secondary-foreground"],
			["accent-green", "--accent-green"],
			["accent-dim", "--accent-dim"],
		],
	},
	{
		title: "Muted / surface accents",
		entries: [
			["muted", "--muted"],
			["muted-foreground", "--muted-foreground"],
			["accent", "--accent"],
			["accent-foreground", "--accent-foreground"],
		],
	},
	{
		title: "Status",
		entries: [
			["destructive", "--destructive"],
			["destructive-foreground", "--destructive-foreground"],
		],
	},
	{
		title: "Structure",
		entries: [
			["border", "--border"],
			["input", "--input"],
			["ring", "--ring"],
			["line", "--line"],
			["line-soft", "--line-soft"],
		],
	},
	{
		title: "Charts",
		entries: [
			["chart-1", "--chart-1"],
			["chart-2", "--chart-2"],
			["chart-3", "--chart-3"],
			["chart-4", "--chart-4"],
			["chart-5", "--chart-5"],
		],
	},
	{
		title: "Sidebar",
		entries: [
			["sidebar", "--sidebar"],
			["sidebar-foreground", "--sidebar-foreground"],
			["sidebar-primary", "--sidebar-primary"],
			["sidebar-primary-foreground", "--sidebar-primary-foreground"],
			["sidebar-accent", "--sidebar-accent"],
			["sidebar-accent-foreground", "--sidebar-accent-foreground"],
			["sidebar-border", "--sidebar-border"],
			["sidebar-ring", "--sidebar-ring"],
		],
	},
];

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

const swatchGridClass = css({
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
	gap: "0.75rem",
});

const swatchClass = css({
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	overflow: "hidden",
	fontSize: "0.75rem",
});

const swatchFillClass = css({
	height: "3.5rem",
});

const swatchLabelClass = css({
	padding: "0.5rem",
	background: "var(--card)",
	color: "var(--cardForeground)",
});

function ColorSwatch({ name, cssVar }: { name: string; cssVar: string }) {
	return (
		<div className={swatchClass}>
			<div className={swatchFillClass} style={{ background: `var(${cssVar})` }} />
			<div className={swatchLabelClass}>
				<div style={{ fontWeight: 600 }}>{name}</div>
				<div style={{ opacity: 0.6 }}>{cssVar}</div>
			</div>
		</div>
	);
}

const typeRowClass = css({
	display: "flex",
	alignItems: "baseline",
	gap: "1rem",
	paddingBlock: "0.5rem",
	borderBottom: "1px solid var(--lineSoft)",
});

const FONT_SAMPLES: [string, string][] = [
	["monoDisplay", "--mono-display"],
	["monoBody", "--mono-body"],
	["ui", "--font-ui"],
	["sans", "--font-sans"],
	["serif", "--font-serif"],
	["mono", "--font-mono"],
];

const DURATIONS: { name: string; value: string }[] = [
	{ name: "fast", value: "120ms" },
	{ name: "base", value: "180ms" },
	{ name: "slow", value: "300ms" },
];

const durationDemoClass = css({
	width: "2.5rem",
	height: "2.5rem",
	borderRadius: "0.5rem",
	background: "var(--primary)",
	transitionProperty: "transform",
	transitionTimingFunction: "{easings.standard}",
	cursor: "pointer",
	_hover: { transform: "translateX(2rem)" },
});

export function Tokens() {
	return (
		<div className={pageClass}>
			<h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>Design tokens</h1>
			<p style={{ opacity: 0.7 }}>
				Values are declared once in <code>panda.config.ts</code> (<code>tokens</code> / <code>semanticTokens</code>) and
				aliased to the app's existing bare <code>--name</code> custom properties via <code>globalCss</code>. Toggle
				Storybook's theme to see the dark-mode values.
			</p>

			{COLOR_GROUPS.map((group) => (
				<section key={group.title}>
					<h2 className={sectionTitleClass}>{group.title}</h2>
					<div className={swatchGridClass}>
						{group.entries.map(([name, cssVar]) => (
							<ColorSwatch key={name} name={name} cssVar={cssVar} />
						))}
					</div>
				</section>
			))}

			<h2 className={sectionTitleClass}>Typography</h2>
			{FONT_SAMPLES.map(([name, cssVar]) => (
				<div key={name} className={typeRowClass} style={{ fontFamily: `var(${cssVar}, inherit)` }}>
					<code style={{ minWidth: "8rem" }}>{name}</code>
					<span>The quick brown fox jumps over the lazy dog</span>
				</div>
			))}

			<h2 className={sectionTitleClass}>Transitions</h2>
			<p style={{ opacity: 0.7, marginBottom: "0.75rem" }}>Hover a square — each uses its named duration token with the standard easing.</p>
			<div style={{ display: "flex", gap: "2rem" }}>
				{DURATIONS.map((d) => (
					<div key={d.name}>
						<div className={durationDemoClass} style={{ transitionDuration: d.value }} />
						<div style={{ marginTop: "0.5rem", fontSize: "0.75rem", opacity: 0.7 }}>
							{d.name} ({d.value})
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
