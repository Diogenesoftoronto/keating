import type { DetectedPlatform, DownloadArchitecture } from "./detect-platform";

export const RELEASES_URL = "https://github.com/Diogenesoftoronto/keating/releases";
export const RELEASE_API_URL = "https://api.github.com/repos/Diogenesoftoronto/keating/releases/latest";

export interface DownloadAsset {
	name: string;
	url: string;
	size: number;
	platform: Exclude<DetectedPlatform, "unknown">;
	architecture: Exclude<DownloadArchitecture, "unknown"> | "universal";
	kind: "terminal" | "desktop" | "android";
	format: string;
}

export interface DownloadRelease {
	tag: string;
	url: string;
	assets: DownloadAsset[];
}

// Verified against the published GitHub release on 2026-09-06. Kept separately
// from APP_VERSION: an unreleased source version must never produce dead links.
// The page refreshes public release metadata; this snapshot survives API outages.
export const VERIFIED_DOWNLOAD_RELEASE: DownloadRelease = {
	tag: "v3.11.0",
	url: `${RELEASES_URL}/tag/v3.11.0`,
	assets: [
		["darwin", "arm64", 894555661],
		["darwin", "x64", 918143702],
		["linux", "arm64", 746269733],
		["linux", "x64", 760974416],
	].map(([os, arch, size]) => {
		const name = `keating-3.11.0-${os}-${arch}.tar.gz`;
		return {
			name, url: `${RELEASES_URL}/download/v3.11.0/${name}`, size: Number(size),
			platform: os === "darwin" ? "macos" : "linux",
			architecture: arch as "arm64" | "x64", kind: "terminal", format: ".tar.gz",
		};
	}),
};

/** Only offer actual uploaded assets from this repository, never inferred URLs. */
export function parseDownloadRelease(value: unknown): DownloadRelease | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	if (raw.draft !== false || raw.prerelease !== false || typeof raw.tag_name !== "string"
		|| !/^v\d+\.\d+\.\d+$/.test(raw.tag_name) || !Array.isArray(raw.assets)) return null;
	const tag = raw.tag_name;
	const assets: DownloadAsset[] = [];
	for (const item of raw.assets) {
		if (!item || typeof item !== "object") continue;
		const asset = item as Record<string, unknown>;
		if (typeof asset.name !== "string" || typeof asset.browser_download_url !== "string"
			|| typeof asset.size !== "number" || !Number.isFinite(asset.size) || asset.size <= 0
			|| asset.state !== "uploaded") continue;
		const name = asset.name;
		const expectedUrl = `${RELEASES_URL}/download/${tag}/${encodeURIComponent(name)}`;
		if (asset.browser_download_url !== expectedUrl || /[/\\]/.test(name)) continue;
		const terminal = /^keating-(\d+\.\d+\.\d+)-(darwin|linux)-(arm64|x64)\.tar\.gz$/.exec(name);
		if (terminal && `v${terminal[1]}` === tag) {
			assets.push({ name, url: expectedUrl, size: asset.size, platform: terminal[2] === "darwin" ? "macos" : "linux", architecture: terminal[3] as "arm64" | "x64", kind: "terminal", format: ".tar.gz" });
			continue;
		}
		// Future installers become available only when uploaded. Require explicit
		// architecture in their names, rather than guessing from a .dmg or .exe.
		if (!/^keating[-_. ]/i.test(name)) continue;
		const arch = /(?:^|[-_. ])(arm64|aarch64|x64|x86_64|amd64|universal)(?=[-_. ]|$)/i.exec(name)?.[1]?.toLowerCase();
		const architecture = arch === "aarch64" ? "arm64" : arch === "amd64" || arch === "x86_64" ? "x64" : arch;
		if (architecture !== "arm64" && architecture !== "x64" && architecture !== "universal") continue;
		const format = /\.(dmg|exe|msi|AppImage|deb|rpm|apk)$/i.exec(name)?.[0];
		if (!format || /(?:debug|unsigned|blockmap)/i.test(name)) continue;
		const ext = format.toLowerCase();
		const platform = ext === ".dmg" ? "macos" : ext === ".exe" || ext === ".msi" ? "windows" : ext === ".apk" ? "android" : "linux";
		assets.push({ name, url: expectedUrl, size: asset.size, platform, architecture, kind: platform === "android" ? "android" : "desktop", format });
	}
	return { tag, url: `${RELEASES_URL}/tag/${tag}`, assets };
}

export async function fetchDownloadRelease(signal: AbortSignal): Promise<DownloadRelease | null> {
	const response = await fetch(RELEASE_API_URL, { signal, credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
	if (!response.ok) throw new Error("Release metadata unavailable");
	return parseDownloadRelease(await response.json());
}

/** Do not silently select the other CPU architecture or a different platform. */
export function recommendedDownload(release: DownloadRelease, platform: DetectedPlatform, architecture: DownloadArchitecture, format?: string): DownloadAsset | undefined {
	return release.assets.filter((asset) => asset.platform === platform
		&& (!format || asset.format.toLowerCase() === format.toLowerCase())
		&& (asset.architecture === architecture || asset.architecture === "universal"))
		.sort((a, b) => Number(a.kind === "terminal") - Number(b.kind === "terminal")
			|| Number(b.format.toLowerCase() === ".appimage") - Number(a.format.toLowerCase() === ".appimage")
			|| Number(a.architecture === "universal") - Number(b.architecture === "universal"))[0];
}

export function downloadFormatLabel(format: string): string {
	return ({ ".deb": "DEB · Ubuntu / Debian", ".rpm": "RPM · Fedora / openSUSE", ".appimage": "AppImage · Portable", ".tar.gz": "Terminal archive" } as Record<string, string>)[format.toLowerCase()] ?? format;
}

export function downloadArchitectureLabel(platform: DetectedPlatform, architecture: DownloadAsset["architecture"]): string {
	if (architecture === "universal") return "Universal";
	if (platform === "macos") return architecture === "arm64" ? "Apple Silicon" : "Intel";
	return architecture === "arm64" ? "ARM64" : "x64";
}

export function downloadSize(bytes: number): string {
	return `${Math.round(bytes / 1024 / 1024)} MB`;
}
