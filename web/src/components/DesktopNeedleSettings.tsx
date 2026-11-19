import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	desktopNativeBridge,
	type DesktopNativeBridge,
} from "../lib/desktop-native";
import {
	desktopNeedleEnabled,
	desktopNeedleStatus,
	setDesktopNeedleEnabled,
	subscribeDesktopNeedle,
	type DesktopNeedleStatus,
} from "../keating/needle-retrieval";
import {
	browserNeedleAvailable,
	browserNeedleStatus,
	installBrowserNeedle,
	removeBrowserNeedle,
	subscribeBrowserNeedle,
	type BrowserNeedleProgress,
} from "../keating/browser-needle-runtime";
import {
	webMemoryAdmissionEnabled,
	setWebMemoryAdmissionEnabled,
	subscribeWebMemoryAdmission,
} from "../keating/judgement/memory-admission";
import { Button, ConfirmDialog, Loading, Switch } from "../design-system/kit";
import { Meter } from "../design-system/charts";
import { SettingRow } from "./settings/ui";

export type LocalRecallSettingsStatus = DesktopNeedleStatus;
/** Desktop weights belong to main-process app data, never the renderer's changing localhost origin. */
export function localRecallModelManager(bridge: DesktopNativeBridge | null) {
	return {
		async status(): Promise<LocalRecallSettingsStatus> {
			if (bridge)
				return desktopNeedleStatus((operation, payload) =>
					bridge.executeNative(operation, payload),
				);
			const state = await browserNeedleStatus();
			return { ...state, installed: state.downloaded, managed: true };
		},
		async install(
			progress: (value: BrowserNeedleProgress) => void,
			signal: AbortSignal,
		) {
			if (bridge) {
				await bridge.executeNative("needle.install", {});
				return;
			}
			await installBrowserNeedle(progress, signal);
		},
		async cancel(controller: AbortController | null) {
			controller?.abort();
			if (bridge) {
				await bridge.executeNative("needle.cancelDownload", {});
				return;
			}
		},
		async remove() {
			if (bridge) {
				await bridge.executeNative("needle.remove", {});
				return;
			}
			await removeBrowserNeedle();
		},
	};
}

export function LocalRecallModelControls({
	desktop,
	supported,
	status,
	progress,
	busy,
	onInstall,
	onRemove,
	onCancel,
}: {
	desktop: boolean;
	supported: boolean;
	status?: LocalRecallSettingsStatus;
	progress: number | null;
	busy: "install" | "remove" | "cancel" | null;
	onInstall(): void;
	onRemove(): void;
	onCancel(): void;
}) {
	const [confirm, setConfirm] = useState(false);
	if (!supported) return null;
	const downloading =
		status?.downloading === true || progress !== null || busy === "install";
	const measured =
		progress ??
		(typeof status?.downloadedBytes === "number" &&
		typeof status.totalBytes === "number" &&
		status.totalBytes > 0
			? Math.max(
					0,
					Math.min(
						100,
						Math.round((status.downloadedBytes / status.totalBytes) * 100),
					),
				)
			: null);
	return (
		<div>
			{downloading ? (
				<>
					<Meter
						progress
						label="Local recall model download"
						max={100}
						value={measured ?? 0}
						indeterminate={measured === null}
						valueText={measured === null ? "Downloading…" : measured + "%"}
					/>
					<Button disabled={busy === "cancel"} onClick={onCancel}>
						Cancel download
					</Button>
				</>
			) : status?.installed ? (
				<Button disabled={busy !== null} onClick={() => setConfirm(true)}>
					{busy === "remove" ? (
						<Loading size="inline" label="Removing local recall model…" />
					) : (
						"Remove local recall model"
					)}
				</Button>
			) : (
				<Button disabled={busy !== null || !status} onClick={onInstall}>
					Download local recall model (36 MB)
				</Button>
			)}
			{status?.installed && !downloading && (
				<ConfirmDialog
					open={confirm}
					title="Remove local recall model?"
					description="This turns off local recall and removes the downloaded model from this device."
					confirmLabel="Remove model"
					onCancel={() => setConfirm(false)}
					onConfirm={() => {
						setConfirm(false);
						onRemove();
					}}
				/>
			)}
			<p>
				{desktop
					? "The download is saved in Keating app data on this device for offline use across restarts."
					: "The download is saved in this browser for offline use. Clearing browser data removes it."}
			</p>
		</div>
	);
}

export function localRecallSettingsMessage(
	desktop: boolean,
	supported: boolean,
	status: LocalRecallSettingsStatus | undefined,
	enabled: boolean,
): string {
	if (!supported) return "Local recall is unavailable in this browser.";
	if (!status) return "Checking the local recall model…";
	if (status.downloading) return "Downloading the pinned local recall model…";
	if (status.available) {
		const location = desktop
			? status.installed && status.managed !== false
				? "Downloaded model in Keating app data."
				: "Using the model configured in this desktop workspace."
			: "Downloaded model in this browser.";
		return `${location} Local recall is ${enabled ? "enabled" : "off"}.`;
	}
	return status.installed
		? "The downloaded model is unavailable. Remove it and download it again."
		: "Download the model to enable local recall.";
}

// A browser download belongs to the open Settings dialog and can outlive a
// visit to the Recall section. Native downloads report status through the bridge.
const downloadEvents = new EventTarget();
let browserDownload: AbortController | null = null;
let browserPercent: number | null = null;
function publishPercent(value: number | null) {
	browserPercent = value;
	downloadEvents.dispatchEvent(new Event("progress"));
}
function subscribePercent(listener: () => void) {
	downloadEvents.addEventListener("progress", listener);
	return () => downloadEvents.removeEventListener("progress", listener);
}

export function DesktopNeedleSettings() {
	const enabled = useSyncExternalStore(
		subscribeDesktopNeedle,
		desktopNeedleEnabled,
		() => false,
	);
	const memoryEnabled = useSyncExternalStore(
		subscribeWebMemoryAdmission,
		webMemoryAdmissionEnabled,
		() => false,
	);
	const bridge = desktopNativeBridge();
	const manager = useMemo(() => localRecallModelManager(bridge), [bridge]);
	const [status, setStatus] = useState<LocalRecallSettingsStatus>();
	const progress = useSyncExternalStore(
		subscribePercent,
		() => browserPercent,
		() => null,
	);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState<"install" | "remove" | "cancel" | null>(
		null,
	);
	const download = useRef<AbortController | null>(null);
	const mounted = useRef(true),
		revision = useRef(0);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			revision.current++;
		};
	}, []);
	const refresh = useCallback(async () => {
		const generation = ++revision.current;
		try {
			const result = await manager.status();
			if (mounted.current && generation === revision.current) setStatus(result);
		} catch {
			if (mounted.current && generation === revision.current)
				setError("The local recall model status could not be checked.");
		}
	}, [manager]);
	useEffect(() => {
		const update = () => {
			void refresh();
		};
		update();
		window.addEventListener("focus", update);
		const unsubscribe = bridge ? () => {} : subscribeBrowserNeedle(update);
		return () => {
			unsubscribe();
			window.removeEventListener("focus", update);
		};
	}, [bridge, refresh]);
	useEffect(() => {
		if (!bridge || (busy !== "install" && !status?.downloading)) return;
		const timer = window.setInterval(() => {
			void refresh();
		}, 500);
		return () => window.clearInterval(timer);
	}, [bridge, busy, status?.downloading, refresh]);
	const supported = !!bridge || browserNeedleAvailable();
	const install = async () => {
		if (download.current || browserDownload || busy) return;
		const controller = new AbortController();
		download.current = controller;
		const dialog = document
			.getElementById("settings-section-local-recall")
			?.closest("dialog");
		const abort = () => controller.abort();
		if (!bridge) {
			browserDownload = controller;
			publishPercent(0);
			dialog?.addEventListener("close", abort, { once: true });
		}
		setBusy("install");
		setError("");
		try {
			await manager.install(({ loaded, total }) => {
				if (!bridge && !controller.signal.aborted && total > 0)
					publishPercent(Math.round((loaded / total) * 100));
			}, controller.signal);
			if (!controller.signal.aborted) await refresh();
		} catch (failure) {
			if (mounted.current && !controller.signal.aborted)
				setError(
					failure instanceof Error ? failure.message : "Download failed.",
				);
		} finally {
			dialog?.removeEventListener("close", abort);
			if (browserDownload === controller) {
				browserDownload = null;
				publishPercent(null);
			}
			if (download.current === controller) download.current = null;
			if (mounted.current) {
				setBusy((current) => (current === "install" ? null : current));
			}
		}
	};
	const cancel = async () => {
		setBusy("cancel");
		setError("");
		try {
			await manager.cancel(download.current ?? browserDownload);
			await refresh();
		} catch {
			if (mounted.current)
				setError("The download could not be cancelled. Please try again.");
		} finally {
			if (mounted.current) {
				setBusy(null);
			}
		}
	};
	const remove = async () => {
		if (busy) return;
		setDesktopNeedleEnabled(false);
		setError("");
		setBusy("remove");
		try {
			await manager.remove();
			await refresh();
		} catch {
			if (mounted.current)
				setError("The local model could not be removed. Please try again.");
		} finally {
			if (mounted.current) setBusy(null);
		}
	};
	return (
		<section
			id="settings-section-local-recall"
			className="pf-fields"
			aria-labelledby="desktop-local-recall-title"
		>
			<h3 id="desktop-local-recall-title">Local recall</h3>
			<p>
				Needle finds relevant excerpts from earlier learner messages. Embeddings
				run on this device; its search index stays in memory.
			</p>
			<p>
				Exact excerpts may be included in tutor requests, including requests to
				your chosen hosted model. Recall does not automatically save facts to
				your learner profile.
			</p>
			<LocalRecallModelControls
				desktop={!!bridge}
				supported={supported}
				status={status}
				progress={progress}
				busy={busy}
				onInstall={() => void install()}
				onRemove={() => void remove()}
				onCancel={() => void cancel()}
			/>
			{(error || status?.error) && <p role="alert">{error || status?.error}</p>}
			<SettingRow
				id="recall-excerpts"
				label="Use earlier learner excerpts in replies"
				help="Exact excerpts may be included in requests to your chosen tutor model."
				scope="this device"
			>
				<Switch
					labelledBy="recall-excerpts-label"
					checked={enabled}
					disabled={!enabled && !status?.available}
					onChange={setDesktopNeedleEnabled}
				/>
			</SettingRow>
			<SettingRow
				id="recall-memory"
				label="Save reviewed learner memories from recalled excerpts"
				help="Memory reviews use your judgement settings. Only excerpts that pass a matching calibrated review can be saved. Saved memories stay separate from your declared profile; turn this off to stop saving and using them."
				scope="this device"
			>
				<Switch
					labelledBy="recall-memory-label"
					checked={memoryEnabled}
					onChange={setWebMemoryAdmissionEnabled}
				/>
			</SettingRow>
			{!status && supported && !error ? (
				<Loading size="inline" label="Checking the local recall model…" />
			) : (
				<p role="status">
					{localRecallSettingsMessage(!!bridge, supported, status, enabled)}
				</p>
			)}
		</section>
	);
}
