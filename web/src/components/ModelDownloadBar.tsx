import { Button, ConfirmDialog, Loading } from "../design-system/kit";
import { Meter } from "../design-system/charts";
import { useEffect, useState } from "react";
import { css } from "../../styled-system/css";
import { getBrowserModel, localModel } from "../stores/local-model";
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
			? "Compiling for your GPU, no network needed"
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
							aria-label={`Cancel download of ${modelName ?? "model"}`}
						>
							Cancel download
						</button>
					)}
				</span>
			</div>
			<Meter progress max={100} value={Math.floor(percent)} indeterminate={!determinate} label={describePhase(progress, modelName)}
				aria-valuetext={determinate ? `${Math.floor(percent)}%, ${detail}` : undefined}/>
			{detail && <div className={detailStyle}>{detail}</div>}
		</div>
	);
}

const activityStyle = css({
	position: "fixed",
	zIndex: 40,
	insetInline: "1rem",
	bottom: "max(1rem, env(safe-area-inset-bottom))",
	marginInline: "auto",
	width: "min(100%, 32rem)",
	border: "1px solid var(--border)",
	borderRadius: "0.5rem",
	backgroundColor: "var(--background)",
	padding: "0.75rem",
	color: "var(--foreground)",
	fontSize: "0.75rem",
	lineHeight: 1.4,
});

/**
 * Keeps an active browser-model load visible after the picker closes or the
 * user moves to another route. The store owns the work; this is only a view
 * of that work, so unmounting the picker cannot cancel it.
 */
export function BrowserModelDownloadStatus() {
	const [local, setLocal] = useState(localModel.getState());

	useEffect(() => localModel.subscribe(setLocal), []);

	if (!local.loading || !local.modelId) return null;
	const spec = getBrowserModel(local.modelId);
	const modelName = spec?.name ?? local.modelId;

	return (
		<aside className={activityStyle} aria-label="Browser model activity" aria-live="polite">
			<div className={css({ marginBottom: "0.25rem", color: "var(--muted-foreground)" })}>
				{modelName} continues in the background. You can keep using Keating while it loads.
			</div>
			<ModelDownloadBar
				progress={local.download}
				modelName={modelName}
				sizeLabel={spec?.downloadLabel}
				onCancel={() => localModel.cancel()}
			/>
		</aside>
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
 * Deletion requires confirmation: these downloads take a long time to replace.
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
			<Button variant="ghost" disabled={removing} onClick={event => {stop(event);setConfirming(true);}}>Delete download</Button>
			{removing && <Loading size="inline" label="Deleting…"/>}
			{confirming && <ConfirmDialog open title={loaded ? "Unload and delete?" : "Delete these files?"} description="Removes this model’s downloaded files from this browser. Using it again requires another download." cancelLabel="Keep" confirmLabel="Delete" onCancel={()=>setConfirming(false)} onConfirm={async ()=>{
				setConfirming(false);setRemoving(true);
				try {await onRemove();} finally {setRemoving(false);}
			}}/>}
		</div>
	);
}
