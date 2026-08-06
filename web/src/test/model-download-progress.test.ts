import { describe, expect, it } from "bun:test";
import {
	DownloadTracker,
	describeDownload,
	formatBytes,
	formatEta,
	parseSizeLabel,
} from "../lib/model-download-progress";

function clock(start = 0) {
	let now = start;
	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("parseSizeLabel", () => {
	it("reads the catalog labels", () => {
		expect(parseSizeLabel("~4.5 GB")).toBe(4_500_000_000);
		expect(parseSizeLabel("~760 MB")).toBe(760_000_000);
		expect(parseSizeLabel("270MB")).toBe(270_000_000);
	});

	it("returns 0 when there is no size to read", () => {
		expect(parseSizeLabel("size unknown")).toBe(0);
		expect(parseSizeLabel(undefined)).toBe(0);
	});
});

describe("formatBytes / formatEta", () => {
	it("formats sizes in decimal units", () => {
		expect(formatBytes(4_500_000_000)).toBe("4.5 GB");
		expect(formatBytes(760_000_000)).toBe("760 MB");
		expect(formatBytes(0)).toBe("0 MB");
	});

	it("keeps the ETA coarse", () => {
		expect(formatEta(20)).toBe("less than a minute left");
		expect(formatEta(180)).toBe("about 3 min left");
		expect(formatEta(7200)).toBe("about 2 hours left");
		expect(formatEta(null)).toBe("");
	});
});

describe("DownloadTracker", () => {
	it("sums bytes across files instead of following the newest one", () => {
		const tracker = new DownloadTracker(0, clock().now);
		tracker.update({ status: "initiate", name: "repo", file: "a.onnx" });
		tracker.update({ status: "initiate", name: "repo", file: "b.onnx" });
		tracker.update({ status: "progress", name: "repo", file: "a.onnx", loaded: 100, total: 100 });
		tracker.update({ status: "done", name: "repo", file: "a.onnx" });
		// A fresh file starting at 0% used to reset the whole bar.
		const progress = tracker.update({
			status: "progress",
			name: "repo",
			file: "b.onnx",
			loaded: 0,
			total: 300,
		});

		expect(progress.bytesLoaded).toBe(100);
		expect(progress.bytesTotal).toBe(400);
		expect(progress.percent).toBeCloseTo(25, 5);
		expect(progress.filesDone).toBe(1);
		expect(progress.filesTotal).toBe(2);
	});

	it("never moves backwards while the total holds steady", () => {
		const tracker = new DownloadTracker(0, clock().now);
		tracker.update({ status: "progress", name: "r", file: "a", loaded: 90, total: 100 });
		const before = tracker.snapshot().percent;
		// A retried range request can report fewer bytes than last time.
		const after = tracker.update({
			status: "progress",
			name: "r",
			file: "a",
			loaded: 40,
			total: 100,
		}).percent;

		expect(before).toBeCloseTo(90, 5);
		expect(after).toBe(before);
	});

	it("uses the advertised size as a floor so early progress is not inflated", () => {
		const tracker = new DownloadTracker(1_000_000, clock().now);
		const progress = tracker.update({
			status: "progress",
			name: "r",
			file: "config.json",
			loaded: 1000,
			total: 1000,
		});

		expect(progress.percent).toBeCloseTo(0.1, 5);
	});

	it("rescales instead of pinning at 99% when a late file announces its size", () => {
		const tracker = new DownloadTracker(0, clock().now);
		tracker.update({ status: "progress", name: "r", file: "a", loaded: 100, total: 100 });
		expect(tracker.snapshot().percent).toBe(99);
		const rescaled = tracker.update({
			status: "progress",
			name: "r",
			file: "b",
			loaded: 0,
			total: 900,
		});

		expect(rescaled.percent).toBeCloseTo(10, 5);
	});

	it("caps the download at 99% and only reports 100 when ready", () => {
		const tracker = new DownloadTracker(0, clock().now);
		tracker.update({ status: "progress", name: "r", file: "a", loaded: 100, total: 100 });
		expect(tracker.snapshot().percent).toBe(99);
		expect(tracker.setPhase("ready").percent).toBe(100);
	});

	it("derives rate and ETA from a moving window", () => {
		const time = clock();
		const tracker = new DownloadTracker(0, time.now);
		tracker.update({ status: "progress", name: "r", file: "a", loaded: 0, total: 10_000_000 });
		time.advance(2000);
		const progress = tracker.update({
			status: "progress",
			name: "r",
			file: "a",
			loaded: 2_000_000,
			total: 10_000_000,
		});

		expect(progress.bytesPerSecond).toBeCloseTo(1_000_000, 0);
		expect(progress.etaSeconds).toBe(8);
		expect(describeDownload(progress)).toBe("2 MB of 10 MB · 1 MB/s · less than a minute left");
	});

	it("decays the rate while a transfer is stalled", () => {
		const time = clock();
		const tracker = new DownloadTracker(0, time.now);
		tracker.update({ status: "progress", name: "r", file: "a", loaded: 0, total: 10_000_000 });
		time.advance(1000);
		tracker.update({ status: "progress", name: "r", file: "a", loaded: 1_000_000, total: 10_000_000 });
		const moving = tracker.snapshot().bytesPerSecond;
		time.advance(4000);
		const stalled = tracker.snapshot().bytesPerSecond;

		expect(moving).toBeGreaterThan(stalled);
		expect(stalled).toBeLessThan(300_000);
	});

	it("flags when every started file has finished", () => {
		const tracker = new DownloadTracker(0, clock().now);
		tracker.update({ status: "initiate", name: "r", file: "a" });
		expect(tracker.snapshot().allFilesDone).toBe(false);
		const done = tracker.update({ status: "done", name: "r", file: "a" });
		expect(done.allFilesDone).toBe(true);
	});

	it("switches to the downloading phase on the first progress event", () => {
		const tracker = new DownloadTracker(0, clock().now);
		tracker.setPhase("preparing");
		expect(tracker.getPhase()).toBe("preparing");
		tracker.update({ status: "progress", name: "r", file: "a", loaded: 1, total: 10 });
		expect(tracker.getPhase()).toBe("downloading");
	});
});
