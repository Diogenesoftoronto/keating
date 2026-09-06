/** Desktop platforms Keating ships (or plans) an Electron build for. */
export type DesktopPlatform = "macos" | "windows" | "linux";

/** Mobile platforms recognized by the download picker. */
export type MobilePlatform = "ios" | "android";

export type DetectedPlatform = DesktopPlatform | MobilePlatform | "unknown";

export interface PlatformDetection {
	/** Best-guess platform for the current visitor. */
	platform: DetectedPlatform;
	/** True when the visitor is on a phone or tablet. */
	isMobile: boolean;
	/** The desktop build to highlight, even for mobile/unknown visitors. */
	recommendedDesktop: DesktopPlatform;
}

/**
 * Detect the visitor's OS from `navigator`, defensively (SSR-safe, tolerant of
 * missing `userAgentData`). We only need a coarse guess to highlight the most
 * likely download; the full platform list stays visible regardless.
 */
export function detectPlatform(nav?: Navigator): PlatformDetection {
	const navigator = nav ?? (typeof globalThis !== "undefined" ? globalThis.navigator : undefined);

	if (!navigator) {
		return { platform: "unknown", isMobile: false, recommendedDesktop: "macos" };
	}

	// Client hints are useful when present, but still only a best guess.
	const uaData = (navigator as Navigator & {
		userAgentData?: { platform?: string; mobile?: boolean };
	}).userAgentData;
	const uaDataPlatform = uaData?.platform?.toLowerCase() ?? "";

	const ua = (navigator.userAgent || "").toLowerCase();
	const platformStr = (navigator.platform || "").toLowerCase();
	const maxTouch = typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;

	const haystack = `${uaDataPlatform} ${ua} ${platformStr}`;

	// iPadOS 13+ reports as a Mac; disambiguate with touch points.
	const isIpadOsMasqueradingAsMac =
		(platformStr === "macintel" || uaDataPlatform === "macos" || ua.includes("macintosh")) && maxTouch > 1;

	const isAndroid = haystack.includes("android");
	const isIos =
		/iphone|ipad|ipod/.test(haystack) || isIpadOsMasqueradingAsMac;
	const isMobile =
		uaData?.mobile === true || isAndroid || isIos || /mobi/.test(ua);

	if (isAndroid) {
		return { platform: "android", isMobile: true, recommendedDesktop: "linux" };
	}
	if (isIos) {
		return { platform: "ios", isMobile: true, recommendedDesktop: "macos" };
	}
	// ChromeOS can include Linux/X11 in its UA but cannot install these bundles
	// directly. An unidentified mobile device must not get a desktop download.
	if (haystack.includes("cros") || uaDataPlatform === "chrome os" || isMobile) {
		return { platform: "unknown", isMobile, recommendedDesktop: "macos" };
	}
	const hintedDesktop = ({ macos: "macos", windows: "windows", linux: "linux" } as const)[uaDataPlatform as "macos" | "windows" | "linux"];
	if (hintedDesktop) {
		return { platform: hintedDesktop, isMobile: false, recommendedDesktop: hintedDesktop };
	}

	const isWindows = haystack.includes("win");
	const isMac = haystack.includes("mac");
	const isLinux = haystack.includes("linux") || haystack.includes("x11");

	if (isWindows) {
		return { platform: "windows", isMobile, recommendedDesktop: "windows" };
	}
	if (isMac) {
		return { platform: "macos", isMobile, recommendedDesktop: "macos" };
	}
	if (isLinux) {
		return { platform: "linux", isMobile, recommendedDesktop: "linux" };
	}

	return { platform: "unknown", isMobile, recommendedDesktop: "macos" };
}

export const DESKTOP_LABELS: Record<DesktopPlatform, string> = {
	macos: "macOS",
	windows: "Windows",
	linux: "Linux",
};

export const MOBILE_LABELS: Record<MobilePlatform, string> = {
	ios: "iOS",
	android: "Android",
};

export type DownloadArchitecture = "arm64" | "x64" | "unknown";

type ArchitectureNavigator = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> & {
	userAgentData?: {
		platform?: string;
		mobile?: boolean;
		getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
	};
};

/** Safari masks Apple Silicon as Intel, so never infer a Mac's CPU from its UA. */
export async function detectDownloadArchitecture(nav?: ArchitectureNavigator): Promise<DownloadArchitecture> {
	const browser = nav ?? globalThis.navigator as ArchitectureNavigator | undefined;
	if (!browser) return "unknown";
	if (browser.userAgentData?.getHighEntropyValues) {
		try {
			const hints = await browser.userAgentData.getHighEntropyValues(["architecture", "bitness"]);
			if (hints.bitness === "64") {
				if (hints.architecture === "arm") return "arm64";
				if (hints.architecture === "x86") return "x64";
			}
			// Explicitly reported 32-bit/other hardware should not receive a 64-bit bundle.
			if (hints.architecture || hints.bitness) return "unknown";
		} catch {
			// Browsers may reject high-entropy hints; visible choices remain usable.
		}
	}
	const platform = detectPlatform(browser as Navigator).platform;
	if (platform !== "linux" && platform !== "windows") return "unknown";
	const ua = `${browser.userAgent} ${browser.platform}`;
	if (/aarch64|arm64/i.test(ua)) return "arm64";
	if (/x86_64|amd64|x64|win64|wow64/i.test(ua)) return "x64";
	return "unknown";
}
