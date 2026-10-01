import { describe, expect, it } from "bun:test";
import { extractNotOrganicProfile, notOrganicAccountUrl } from "./profile";

describe("not organic profile", () => {
	it("reads common name and avatar spellings, including nested profile", () => {
		expect(extractNotOrganicProfile({ id: "1", display_name: " Ada ", picture: "https://x.test/a.png" }))
			.toEqual({ name: "Ada", imageUrl: "https://x.test/a.png" });
		expect(extractNotOrganicProfile({ id: "1", profile: { displayName: "Bo", avatar: "https://x.test/b.png" } }).name).toBe("Bo");
	});
	it("drops non-https images and returns nothing for bare accounts", () => {
		expect(extractNotOrganicProfile({ id: "1", avatar: "http://x.test/a.png" })).toEqual({});
		expect(extractNotOrganicProfile({ id: "1" })).toEqual({});
	});
	it("derives the account page from config", () => {
		expect(notOrganicAccountUrl({ VITE_NOTORGANIC_AUTHORIZATION_URL: "https://id.notorganic.info/authorize" })).toBe("https://id.notorganic.info/account");
		expect(notOrganicAccountUrl({ VITE_NOTORGANIC_ACCOUNT_URL: "https://notorganic.info/me" })).toBe("https://notorganic.info/me");
		expect(notOrganicAccountUrl({ VITE_NOTORGANIC_ACCOUNT_URL: "http://insecure" })).toBeNull();
		expect(notOrganicAccountUrl({})).toBeNull();
	});
});
