import { Select } from "../Select";
import { useEffect, useId, useRef, useState } from "react";
import { css, cx } from "../../../styled-system/css";
import { eyebrow, reviewCard } from "../../../styled-system/recipes";
import type { ReviewPassKind } from "../../keating/trajectory-passes";
import type { ReviewModelPool } from "../../keating/trajectory-review";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";

export interface SocraticPassOption {
	kind: ReviewPassKind;
	label: string;
	blurb: string;
	icon: keyof typeof reviewIcon;
	disabled?: boolean;
	disabledReason?: string;
}

export interface SocraticPassProps {
	options: SocraticPassOption[];
	pools: ReviewModelPool[];
	poolId: string;
	onPoolChange: (poolId: string) => void;
	running: ReviewPassKind | null;
	onRun: (kind: ReviewPassKind) => void;
	onCancel: () => void;
	/** Model + latency of the most recent completed pass, already formatted. */
	footnote?: string;
	className?: string;
}

const shell = css({
	position: "relative",
	borderBottom: "1px solid var(--line)",
	background: "color-mix(in srgb, var(--accent) 5%, var(--paper))",
	overflow: "hidden",
});

/** The scan line that travels the panel while a pass is drafting. */
const sweep = css({
	position: "absolute",
	insetInline: 0,
	top: 0,
	height: "2px",
	background: "linear-gradient(90deg, transparent, var(--accent-dim), transparent)",
	animation: "socratic-sweep 1.6s {easings.standard} infinite",
	pointerEvents: "none",
});

const launcher = css({
	display: "flex",
	width: "100%",
	alignItems: "center",
	gap: "0.55rem",
	padding: "0.7rem 0.75rem",
	cursor: "pointer",
	textAlign: "left",
	color: "var(--ink)",
	transitionProperty: "background-color",
	transitionDuration: "{durations.base}",
	_hover: {
		background: "color-mix(in srgb, var(--accent) 10%, transparent)",
		"& .keating-duo-icon": { transform: "rotate(-10deg) scale(1.12)" },
	},
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-3px" },
});

const nibRunning = css({ animation: "socratic-nib 900ms ease-in-out infinite" });

const list = css({
	display: "grid",
	gap: "0.4rem",
	padding: "0 0.75rem 0.75rem",
});

const optionBlurb = css({
	marginTop: "0.15rem",
	fontSize: "0.7rem",
	lineHeight: 1.45,
	color: "var(--ink-soft)",
});

/**
 * The single door to every AI pass.
 *
 * The review desk gets four model-driven capabilities, and putting four
 * buttons in the margin would make the margin the loudest thing on screen.
 * Instead they collapse behind one line — a feather and a verb — that opens
 * into a short menu. At rest the desk shows one control; opened, it shows
 * everything Keating can do to help read the session.
 */
export function SocraticPass({
	options,
	pools,
	poolId,
	onPoolChange,
	running,
	onRun,
	onCancel,
	footnote,
	className,
}: SocraticPassProps) {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const firstOption = useRef<HTMLButtonElement>(null);

	// A pass that finishes while the menu is open has said what it has to say;
	// close it so the proposals below become the focus.
	useEffect(() => {
		if (!running) return;
		setOpen(false);
	}, [running]);

	useEffect(() => {
		if (open) firstOption.current?.focus();
	}, [open]);

	const busyOption = running ? options.find((option) => option.kind === running) : undefined;

	return (
		<section className={cx(shell, className)} aria-label="Socratic pass">
			{running ? <span className={sweep} aria-hidden="true" /> : null}

			<button
				type="button"
				className={launcher}
				aria-expanded={running ? undefined : open}
				aria-controls={running ? undefined : panelId}
				data-active={running ? "true" : undefined}
				onClick={() => (running ? onCancel() : setOpen((current) => !current))}
			>
				<KeatingIcon
					icon={reviewIcon[busyOption?.icon ?? "pass"]}
					size={17}
					active={Boolean(running)}
					className={running ? nibRunning : undefined}
				/>
				<span className={css({ minWidth: 0, flex: 1 })}>
					<span className={css({ display: "block", fontFamily: "var(--mono-display)", fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.01em" })}>
						{running ? `${busyOption?.label ?? "Pass"}…` : "Socratic pass"}
					</span>
					<span className={optionBlurb}>
						{running ? "Reading the session. Click to stop." : "Have Keating read this session with you."}
					</span>
				</span>
				<span className={cx(eyebrow(), css({ fontSize: "10px" }))} aria-hidden="true">
					{running ? "STOP" : open ? "CLOSE" : "OPEN"}
				</span>
			</button>

			{open && !running ? (
				<div id={panelId} className={list}>
					{pools.length > 1 ? (
						<label className={css({ display: "grid", gap: "0.25rem", marginBottom: "0.15rem" })}>
							<span className={cx(eyebrow(), css({ fontSize: "10px" }))}>Model pool</span>
							<Select aria-label="Socratic model pool"
								value={poolId}
								onValueChange={(value) => onPoolChange(value)}
								className={css({
									width: "100%",
									minHeight: "2rem",
									border: "1.5px solid var(--ink)",
									borderRadius: "{radii.keating}",
									background: "var(--card)",
									color: "var(--ink)",
									paddingInline: "0.5rem",
									fontSize: "0.75rem",
									_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
								})}
							>
								{pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}
							</Select>
						</label>
					) : null}

					{options.map((option, index) => (
						<button
							key={option.kind}
							ref={index === 0 ? firstOption : undefined}
							type="button"
							className={reviewCard()}
							disabled={option.disabled}
							title={option.disabled ? option.disabledReason : undefined}
							onClick={() => onRun(option.kind)}
						>
							<span className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" })}>
								<KeatingIcon icon={reviewIcon[option.icon]} size={16} className={css({ marginTop: "0.1rem", color: "var(--accent-dim)" })} />
								<span className={css({ minWidth: 0 })}>
									<span className={css({ display: "block", fontSize: "0.78rem", fontWeight: 650, color: "var(--ink)" })}>{option.label}</span>
									<span className={optionBlurb}>{option.disabled ? option.disabledReason ?? option.blurb : option.blurb}</span>
								</span>
							</span>
						</button>
					))}

					{footnote ? <p className={cx(optionBlurb, css({ paddingInline: "0.15rem" }))}>{footnote}</p> : null}
				</div>
			) : null}
		</section>
	);
}
