/** Website pages belong in the system browser, never the desktop workspace. */
const WEBSITE_ORIGIN = "https://keating.help";
const WEBSITE_PATHS = new Set(["/", "/download", "/pricing", "/coming-up", "/blog", "/paper", "/terms", "/privacy"]);

export function desktopMarketingUrl(path: string): string | null {
	if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path)) return null;
	try {
		const url = new URL(path, WEBSITE_ORIGIN);
		if (url.origin !== WEBSITE_ORIGIN) return null;
		const pathname = url.pathname.replace(/\/$/, "") || "/";
		if (!WEBSITE_PATHS.has(pathname) && !pathname.startsWith("/blog/")) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export function desktopNavigationExternalUrl(url: string, appOrigin: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.origin !== appOrigin || parsed.username || parsed.password) return null;
		return desktopMarketingUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`);
	} catch {
		return null;
	}
}
