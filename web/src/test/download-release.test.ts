import { describe, expect, it } from "bun:test";
import { detectDownloadArchitecture, detectPlatform } from "../lib/detect-platform";
import { parseDownloadRelease, recommendedDownload, RELEASES_URL, VERIFIED_DOWNLOAD_RELEASE } from "../lib/download-release";

const nav = (userAgent: string, platform = "", maxTouchPoints = 0, userAgentData?: object) => ({ userAgent, platform, maxTouchPoints, userAgentData }) as unknown as Navigator;

describe("download platform selection", () => {
	it.each([
		["Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64", 0, "linux"],
		["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 0, "windows"],
		["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0, "macos"],
		["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5, "ios"],
		["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5, "ios"],
		["Mozilla/5.0 (Linux; Android 15) Mobile", "Linux armv8l", 5, "android"],
		["Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)", "Linux x86_64", 0, "unknown"],
		["Unrecognized Mobile", "", 1, "unknown"],
		["", "", 0, "unknown"],
	] as const)("detects %s", (ua, platform, touch, expected) => {
		expect(detectPlatform(nav(ua, platform, touch)).platform).toBe(expected);
	});
	it("prefers platform client hints over the fallback UA", () => {
		expect(detectPlatform(nav("X11 Linux", "Linux", 0, { platform: "Windows" })).platform).toBe("windows");
	});
	it("does not guess an Apple Silicon Mac is Intel", async () => {
		expect(await detectDownloadArchitecture(nav("Macintosh Intel Mac OS X", "MacIntel"))).toBe("unknown");
	});
	it("uses 64-bit architecture hints and handles refusal", async () => {
		expect(await detectDownloadArchitecture(nav("Macintosh Intel Mac OS X", "MacIntel", 0, {
			getHighEntropyValues: async () => ({ architecture: "arm", bitness: "64" }),
		}))).toBe("arm64");
		expect(await detectDownloadArchitecture(nav("Linux x86_64", "Linux", 0, {
			getHighEntropyValues: async () => { throw new Error("Denied"); },
		}))).toBe("x64");
	});
	it("does not turn 32-bit hardware into an x64 download", async () => {
		expect(await detectDownloadArchitecture(nav("Windows Win64", "Win32", 0, {
			getHighEntropyValues: async () => ({ architecture: "x86", bitness: "32" }),
		}))).toBe("unknown");
	});
	it("recognizes Linux ARM64 without client hints", async () => {
		expect(await detectDownloadArchitecture(nav("X11 Linux aarch64", "Linux aarch64"))).toBe("arm64");
	});
});

const uploaded = (name: string, overrides = {}) => ({ name, size: 123456, state: "uploaded", browser_download_url: `${RELEASES_URL}/download/v3.12.0/${encodeURIComponent(name)}`, ...overrides });
const release = (assets: unknown[]) => ({ tag_name: "v3.12.0", draft: false, prerelease: false, assets });

describe("published download assets", () => {
	it("links to the exact platform and CPU file", () => {
		for (const asset of VERIFIED_DOWNLOAD_RELEASE.assets) {
			expect(recommendedDownload(VERIFIED_DOWNLOAD_RELEASE, asset.platform, asset.architecture as "arm64" | "x64")?.url).toBe(asset.url);
		}
	});
	it.each(["ios", "android", "windows", "unknown"] as const)("does not send %s visitors a Mac archive", (platform) => {
		expect(recommendedDownload(VERIFIED_DOWNLOAD_RELEASE, platform, "arm64")).toBeUndefined();
	});
	it("requires a CPU choice when architecture is hidden", () => {
		expect(recommendedDownload(VERIFIED_DOWNLOAD_RELEASE, "macos", "unknown")).toBeUndefined();
	});
	it("accepts uploaded terminal bundles and prefers a matching installer when published", () => {
		const parsed = parseDownloadRelease(release([
			uploaded("keating-3.12.0-darwin-arm64.tar.gz"), uploaded("Keating-3.12.0-arm64.dmg"),
			uploaded("Keating-3.12.0-x64.exe"), uploaded("keating-3.12.0-universal.apk"),
		]))!;
		expect(parsed.assets).toHaveLength(4);
		expect(recommendedDownload(parsed, "macos", "arm64")?.kind).toBe("desktop");
		expect(recommendedDownload(parsed, "windows", "x64")?.format).toBe(".exe");
		expect(recommendedDownload(parsed, "android", "unknown")?.format).toBe(".apk");
	});
	it("offers published Linux packages for the selected CPU and format", () => {
		const packageArch = (arch: "x64" | "arm64", format: string) => arch === "x64" ? format === ".deb" ? "amd64" : "x86_64" : format === ".rpm" ? "aarch64" : "arm64";
		const parsed = parseDownloadRelease(release([
			uploaded("keating-3.12.0-linux-x64.tar.gz"),
			...(["x64", "arm64"] as const).flatMap((arch) => [".deb", ".rpm", ".AppImage"].map((format) => uploaded(`Keating-3.12.0-linux-${packageArch(arch, format)}${format}`))),
		]))!;
		expect(parsed.assets).toHaveLength(7);
		for (const arch of ["x64", "arm64"] as const) {
			expect(recommendedDownload(parsed, "linux", arch)?.format).toBe(".AppImage");
			for (const format of [".deb", ".rpm", ".AppImage"]) {
				const selected = recommendedDownload(parsed, "linux", arch, format);
				expect(selected?.name).toBe(`Keating-3.12.0-linux-${packageArch(arch, format)}${format}`);
				expect(selected?.kind).toBe("desktop");
			}
		}
		expect(recommendedDownload(parsed, "linux", "unknown", ".deb")).toBeUndefined();
		expect(recommendedDownload(parsed, "linux", "x64", ".dmg")).toBeUndefined();
		expect(recommendedDownload(VERIFIED_DOWNLOAD_RELEASE, "linux", "x64", ".deb")).toBeUndefined();
	});
	it("ignores foreign links, incomplete files, ambiguous CPU names, debug builds, and mismatched versions", () => {
		const parsed = parseDownloadRelease(release([
			uploaded("keating-3.12.0-linux-x64.tar.gz", { browser_download_url: "https://example.com/fake" }),
			uploaded("keating-3.12.0-linux-arm64.tar.gz", { state: "new" }),
			uploaded("Keating-3.12.0.dmg"), uploaded("keating-3.12.0-arm64-debug.apk"),
			uploaded("keating-3.11.0-linux-x64.tar.gz"), uploaded("../keating-x64.exe"),
			uploaded("Keating-x64.exe", { size: 0 }), uploaded("unrelated-x64.exe"),
		]))!;
		expect(parsed.assets).toEqual([]);
	});
	it("rejects drafts, prereleases, and malformed responses", () => {
		for (const value of [null, {}, [], { ...release([]), draft: true }, { ...release([]), prerelease: true }, { ...release([]), tag_name: "latest" }]) {
			expect(parseDownloadRelease(value)).toBeNull();
		}
	});
});
