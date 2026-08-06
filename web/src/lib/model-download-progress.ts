/**
 * Aggregation for browser-model downloads.
 *
 * transformers.js reports progress per file, so reading `progress.progress`
 * straight off the newest event makes a bar jump backwards every time a shard
 * finishes and the next one starts at 0. Summing bytes across every file we
 * have seen keeps the number monotonic and gives us a real size, rate and ETA
 * to show instead of a bare percentage.
 */

export type DownloadPhase = "idle" | "checking" | "preparing" | "downloading" | "ready";

export interface DownloadProgress {
	phase: DownloadPhase;
	/** 0-100 across every file, never decreasing within a single load. */
	percent: number;
	bytesLoaded: number;
	/** 0 until a file reports its size; cached loads never report one. */
	bytesTotal: number;
	bytesPerSecond: number;
	/** null until there is enough history to estimate. */
	etaSeconds: number | null;
	filesDone: number;
	filesTotal: number;
	/** True once every file that started has finished, so nothing is in flight. */
	allFilesDone: boolean;
}

export const IDLE_DOWNLOAD_PROGRESS: DownloadProgress = {
	phase: "idle",
	percent: 0,
	bytesLoaded: 0,
	bytesTotal: 0,
	bytesPerSecond: 0,
	etaSeconds: null,
	filesDone: 0,
	filesTotal: 0,
	allFilesDone: false,
};

/** The fields we rely on from a transformers.js progress event. */
export interface TransformersProgressEvent {
	status?: string;
	name?: string;
	file?: string;
	loaded?: number;
	total?: number;
	progress?: number;
}

const SIZE_UNITS: Record<string, number> = {
	b: 1,
	kb: 1e3,
	mb: 1e6,
	gb: 1e9,
	tb: 1e12,
};

/** `"~4.5 GB"` → bytes. Returns 0 when the label carries no parsable size. */
export function parseSizeLabel(label: string | undefined | null): number {
	if (!label) return 0;
	const match = /(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb|b)\b/i.exec(label);
	if (!match) return 0;
	const unit = SIZE_UNITS[match[2].toLowerCase()];
	return unit ? Math.round(Number(match[1]) * unit) : 0;
}

/** Decimal units, matching how Hugging Face reports repo sizes. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
	if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
	if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
	if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
	return `${Math.round(bytes)} B`;
}

export function formatRate(bytesPerSecond: number): string {
	if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
	return `${formatBytes(bytesPerSecond)}/s`;
}

/** Deliberately coarse: a to-the-second ETA on a multi-GB download is noise. */
export function formatEta(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "";
	if (seconds < 45) return "less than a minute left";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `about ${minutes} min left`;
	const hours = Math.round(seconds / 3600);
	return hours <= 1 ? "about an hour left" : `about ${hours} hours left`;
}

/** The line under the bar: how much, how fast, how much longer. */
export function describeDownload(progress: DownloadProgress): string {
	const parts: string[] = [];
	if (progress.bytesTotal > 0) {
		parts.push(`${formatBytes(progress.bytesLoaded)} of ${formatBytes(progress.bytesTotal)}`);
	} else if (progress.bytesLoaded > 0) {
		parts.push(formatBytes(progress.bytesLoaded));
	}
	const rate = formatRate(progress.bytesPerSecond);
	if (rate) parts.push(rate);
	const eta = formatEta(progress.etaSeconds);
	if (eta) parts.push(eta);
	return parts.join(" · ");
}

/** Short headline for the current phase. */
export function describePhase(progress: DownloadProgress, modelName?: string): string {
	switch (progress.phase) {
		case "checking":
			return "Checking GPU support…";
		case "downloading":
			return modelName ? `Downloading ${modelName}` : "Downloading model";
		case "preparing":
			return "Preparing model…";
		case "ready":
			return "Model ready";
		default:
			return "";
	}
}

/** Samples older than this stop counting toward the rate, so it tracks reality. */
const RATE_WINDOW_MS = 8000;
const MIN_RATE_SPAN_MS = 750;
/** Downloading never displays a full bar; only the finished load does. */
const MAX_DOWNLOADING_PERCENT = 99;

interface FileProgress {
	loaded: number;
	total: number;
	done: boolean;
}

export class DownloadTracker {
	private files = new Map<string, FileProgress>();
	private samples: { at: number; bytes: number }[] = [];
	private percent = 0;
	private denominator = 0;
	private phase: DownloadPhase = "checking";

	/**
	 * @param estimatedTotalBytes Size advertised in the model catalog. Used as a
	 *   floor for the denominator so the bar does not read 90% while only the
	 *   config files have announced their size.
	 * @param now Injectable clock, for tests.
	 */
	constructor(
		private readonly estimatedTotalBytes = 0,
		private readonly now: () => number = () => Date.now(),
	) {}

	setPhase(phase: DownloadPhase): DownloadProgress {
		this.phase = phase;
		if (phase === "ready") this.percent = 100;
		return this.snapshot();
	}

	getPhase(): DownloadPhase {
		return this.phase;
	}

	/** Fold one transformers.js event in and return the updated snapshot. */
	update(event: TransformersProgressEvent): DownloadProgress {
		const key = `${event.name ?? ""}/${event.file ?? ""}`;
		const status = event.status;

		if (status === "initiate" || status === "download") {
			if (!this.files.has(key)) this.files.set(key, { loaded: 0, total: 0, done: false });
		} else if (status === "progress") {
			const entry = this.files.get(key) ?? { loaded: 0, total: 0, done: false };
			// `loaded`/`total` are absent on some events; fall back to the percentage.
			const total = Number(event.total) > 0 ? Number(event.total) : entry.total;
			const loaded =
				Number.isFinite(event.loaded) && Number(event.loaded) >= 0
					? Number(event.loaded)
					: total > 0
						? (total * (Number(event.progress) || 0)) / 100
						: entry.loaded;
			// Per-file bytes only ever grow; a retried range request must not
			// subtract from the total.
			this.files.set(key, {
				loaded: Math.max(entry.loaded, loaded),
				total: Math.max(entry.total, total),
				done: entry.done,
			});
			if (this.phase !== "downloading") this.phase = "downloading";
		} else if (status === "done") {
			const entry = this.files.get(key) ?? { loaded: 0, total: 0, done: false };
			this.files.set(key, { ...entry, loaded: Math.max(entry.loaded, entry.total), done: true });
		}

		return this.snapshot();
	}

	snapshot(): DownloadProgress {
		let bytesLoaded = 0;
		let knownTotal = 0;
		let filesDone = 0;
		for (const file of this.files.values()) {
			bytesLoaded += file.loaded;
			knownTotal += file.total;
			if (file.done) filesDone += 1;
		}

		const bytesTotal = Math.max(knownTotal, this.estimatedTotalBytes);
		if (bytesTotal > 0) {
			const raw = Math.min((bytesLoaded / bytesTotal) * 100, MAX_DOWNLOADING_PERCENT);
			// Against a fixed denominator the bar only grows, so a retried range
			// request cannot rewind it. When a new file announces its size the
			// denominator jumps, and rescaling honestly beats pinning at 99% for
			// the rest of a multi-gigabyte download.
			this.percent = bytesTotal === this.denominator ? Math.max(this.percent, raw) : raw;
			this.denominator = bytesTotal;
		}
		if (this.phase === "ready") this.percent = 100;

		const bytesPerSecond = this.sampleRate(bytesLoaded);
		const remaining = bytesTotal > 0 ? Math.max(bytesTotal - bytesLoaded, 0) : 0;
		const etaSeconds =
			bytesPerSecond > 0 && remaining > 0 ? Math.round(remaining / bytesPerSecond) : null;

		return {
			phase: this.phase,
			percent: this.percent,
			bytesLoaded,
			bytesTotal: knownTotal > 0 ? bytesTotal : 0,
			bytesPerSecond,
			etaSeconds,
			filesDone,
			filesTotal: this.files.size,
			allFilesDone: this.files.size > 0 && filesDone === this.files.size,
		};
	}

	private sampleRate(bytesLoaded: number): number {
		const at = this.now();
		const last = this.samples[this.samples.length - 1];
		if (!last || last.bytes !== bytesLoaded) this.samples.push({ at, bytes: bytesLoaded });
		while (this.samples.length > 2 && at - this.samples[0].at > RATE_WINDOW_MS) {
			this.samples.shift();
		}
		const first = this.samples[0];
		const newest = this.samples[this.samples.length - 1];
		const span = newest.at - first.at;
		if (span < MIN_RATE_SPAN_MS) return 0;
		// A stalled connection should decay toward zero rather than report the
		// rate from before the stall, so measure against now, not the last sample.
		const elapsed = Math.max(span, at - first.at);
		return Math.max((newest.bytes - first.bytes) / (elapsed / 1000), 0);
	}
}
