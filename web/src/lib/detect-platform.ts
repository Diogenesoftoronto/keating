/** Desktop platforms Keating ships (or plans) an Electron build for. */
export type DesktopPlatform = "macos" | "windows" | "linux";

/** Native mobile platforms on the roadmap. */
export type MobilePlatform = "ios" | "android";

export type DetectedPlatform = DesktopPlatform | MobilePlatform | "unknown";

export interface PlatformDetection {
	/** Best-guess platform for the current visitor. */
	platform: DetectedPlatform;
	/** True when the visitor is on a phone/tablet (native app is not out yet). */
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

	// `userAgentData` is the modern, spoof-resistant source when present.
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
		(platformStr === "macintel" || uaDataPlatform === "macos") && maxTouch > 1;

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
