import { useState } from "react";
import { css } from "../../styled-system/css";
import {
	describeDownload,
	describePhase,
	formatBytes,
	type DownloadProgress,
} from "../lib/model-download-progress";

interface ModelDownloadBarProps {
	progress: DownloadProgress;
	/** Named in the headline while downloading. */
	modelName?: string;
	/** Total advertised in the catalog, shown before the first byte lands. */
	sizeLabel?: string;
	/** Renders a cancel control when provided. */
	onCancel?: () => void;
}

const inlineButtonStyle = css({
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	background: "transparent",
	paddingInline: "0.5rem",
	paddingBlock: "0.125rem",
	fontSize: "0.6875rem",
	fontWeight: 600,
	color: "var(--muted-foreground)",
	cursor: "pointer",
	whiteSpace: "nowrap",
	_hover: { color: "var(--foreground)", borderColor: "var(--muted-foreground)" },
});

const trackStyle = css({
	position: "relative",
	height: "0.375rem",
	width: "100%",
	overflow: "hidden",
	borderRadius: "9999px",
	background: "color-mix(in srgb, var(--muted-foreground) 22%, transparent)",
});

const fillStyle = css({
	height: "100%",
	borderRadius: "9999px",
	background: "var(--primary)",
	backgroundImage:
		"repeating-linear-gradient(115deg, color-mix(in srgb, white 18%, transparent) 0 6px, transparent 6px 12px)",
	backgroundSize: "24px 100%",
	animation: "model-download-stripes 900ms linear infinite",
	transition: "width 220ms ease-out",
	_motionReduce: { animation: "none", transition: "none" },
});

const sweepStyle = css({
	position: "absolute",
	inset: 0,
	width: "35%",
	borderRadius: "9999px",
	background: "var(--primary)",
	opacity: 0.75,
	animation: "model-download-sweep 1.4s ease-in-out infinite",
	_motionReduce: { animation: "none", width: "100%", opacity: 0.35 },
});

const headlineStyle = css({
	display: "flex",
	alignItems: "baseline",
	justifyContent: "space-between",
	gap: "0.5rem",
	fontSize: "0.75rem",
	color: "var(--foreground)",
});

const detailStyle = css({
	fontSize: "0.6875rem",
	color: "var(--muted-foreground)",
	fontVariantNumeric: "tabular-nums",
});

/**
 * Download state for a browser model: how far along, how fast, how much is
 * left, and whether the wait is network or on-device compilation.
 */
export function ModelDownloadBar({
	progress,
	modelName,
	sizeLabel,
	onCancel,
}: ModelDownloadBarProps) {
	const determinate = progress.phase === "downloading" && progress.bytesTotal > 0;
	const percent = Math.max(0, Math.min(100, progress.percent));
	const detail = determinate
		? describeDownload(progress)
		: progress.phase === "preparing"
			? "Compiling for your GPU — no network needed"
			: sizeLabel
				? `About ${sizeLabel.replace(/^~\s*/, "")} to download, once`
				: "";

	return (
		<div className={css({ marginTop: "0.375rem", display: "grid", gap: "0.25rem" })}>
			<div className={headlineStyle}>
				<span>{describePhase(progress, modelName)}</span>
				<span className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					{determinate && (
						<span className={css({ fontVariantNumeric: "tabular-nums", fontWeight: 600 })}>
							{Math.floor(percent)}%
						</span>
					)}
					{onCancel && (
						<button
							type="button"
							className={inlineButtonStyle}
							// The row itself selects a model; cancelling must not do that too.
							onClick={(event) => {
								event.stopPropagation();
								event.preventDefault();
								onCancel();
							}}
						>
							Cancel
						</button>
					)}
				</span>
			</div>
			<div
				className={trackStyle}
				role="progressbar"
				aria-label={describePhase(progress, modelName)}
				aria-valuemin={0}
				aria-valuemax={100}
				// Omitted while indeterminate so assistive tech announces "busy"
				// rather than a percentage we cannot honestly report.
				aria-valuenow={determinate ? Math.floor(percent) : undefined}
				aria-valuetext={determinate ? `${Math.floor(percent)}% — ${detail}` : undefined}
			>
				{determinate ? (
					<div className={fillStyle} style={{ width: `${percent}%` }} />
				) : (
					<div className={sweepStyle} />
				)}
			</div>
			{detail && <div className={detailStyle}>{detail}</div>}
		</div>
	);
}

interface ModelCacheControlsProps {
	/** Bytes this model currently occupies in the browser cache. */
	cachedBytes: number;
	/** True while the model is the one loaded in memory. */
	loaded: boolean;
	onRemove: () => Promise<void> | void;
}

/**
 * Shows what a cached browser model costs on disk and offers to delete it.
 * Deleting is confirmed inline: these downloads take a long time to replace.
 */
export function ModelCacheControls({ cachedBytes, loaded, onRemove }: ModelCacheControlsProps) {
	const [confirming, setConfirming] = useState(false);
	const [removing, setRemoving] = useState(false);

	if (cachedBytes <= 0) return null;

	const stop = (event: { stopPropagation: () => void; preventDefault: () => void }) => {
		event.stopPropagation();
		event.preventDefault();
	};

	return (
		<div
			className={css({
				marginTop: "0.375rem",
				display: "flex",
				alignItems: "center",
				flexWrap: "wrap",
				gap: "0.5rem",
				fontSize: "0.6875rem",
				color: "var(--muted-foreground)",
			})}
		>
			<span className={css({ fontVariantNumeric: "tabular-nums" })}>
				{formatBytes(cachedBytes)} stored in this browser
			</span>
			{confirming ? (
				<>
					<span className={css({ color: "var(--destructive)" })}>
						{loaded ? "Unload and delete?" : "Delete these files?"}
					</span>
					<button
						type="button"
						disabled={removing}
						className={css({
							borderRadius: "0.375rem",
							border: "1px solid var(--destructive)",
							background: "transparent",
							paddingInline: "0.5rem",
							paddingBlock: "0.125rem",
							fontSize: "0.6875rem",
							fontWeight: 600,
							color: "var(--destructive)",
							cursor: "pointer",
							_disabled: { opacity: 0.6, cursor: "progress" },
						})}
						onClick={async (event) => {
							stop(event);
							setRemoving(true);
							try {
								await onRemove();
							} finally {
								setRemoving(false);
								setConfirming(false);
							}
						}}
					>
						{removing ? "Deleting…" : "Delete"}
					</button>
					<button
						type="button"
						className={inlineButtonStyle}
						onClick={(event) => {
							stop(event);
							setConfirming(false);
						}}
					>
						Keep
					</button>
				</>
			) : (
				<button
					type="button"
					className={inlineButtonStyle}
					onClick={(event) => {
						stop(event);
						setConfirming(true);
					}}
				>
					Delete download
				</button>
			)}
		</div>
	);
}
