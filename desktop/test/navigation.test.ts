import { describe, expect, it } from "bun:test";
import { desktopMarketingUrl, desktopNavigationExternalUrl } from "../src/navigation.js";

describe("desktop website navigation", () => {
	it.each(["/", "/download", "/download/", "/pricing?pack=plus", "/coming-up", "/blog", "/blog/a-lesson#practice", "/paper", "/terms", "/privacy"])("opens %s on the public website", (path) => {
		expect(desktopMarketingUrl(path)).toBe(`https://keating.help${path}`);
		expect(desktopNavigationExternalUrl(`http://127.0.0.1:39123${path}`, "http://127.0.0.1:39123")).toBe(`https://keating.help${path}`);
	});
	it.each(["/chat", "/live", "/courses", "/courses/math", "/training-data", "/review/sessions/123", "/usage", "/tutorial", "/notorganic/callback?code=123", "/api/health"])("keeps %s in the workspace", (path) => {
		expect(desktopMarketingUrl(path)).toBeNull();
	});
	it.each(["//evil.example/download", "https://evil.example/download", "javascript:alert(1)", "file:///download", "/\\evil.example/download", "/download\r\n", "/downloads", "/blogger"])("rejects unrelated or unsafe destinations: %s", (path) => {
		expect(desktopMarketingUrl(path)).toBeNull();
	});
	it("does not rewrite untrusted origins or embedded credentials", () => {
		expect(desktopNavigationExternalUrl("https://evil.example/download", "http://127.0.0.1:39123")).toBeNull();
		expect(desktopNavigationExternalUrl("http://user:password@127.0.0.1:39123/download", "http://127.0.0.1:39123")).toBeNull();
	});
});
