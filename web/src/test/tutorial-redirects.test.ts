import { describe, expect, it } from "bun:test";
import { H3 } from "h3";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import config from "../../nitro.config";
import tutorial from "../../server/routes/tutorial";
import missingAsset from "../../server/routes/assets/[...path]";
import { DOCUMENTATION_URL, tutorialAdvancedHref, tutorialApiKeyHref } from "../lib/tutorial-links";
import { tutorialRedirectBeforeLoad } from "../lib/tutorial-redirect";

const app = new H3();
for (const route of config.handlers ?? []) {
	if (!route.route) continue;
	if (route.handler === "server/routes/tutorial.ts") app.all(route.route, tutorial);
	if (route.handler === "server/routes/assets/[...path].ts") app.all(route.route, missingAsset);
}
app.all("/**", () => new Response("<!DOCTYPE html><title>Keating</title>"));

describe("legacy tutorial HTTP redirects", () => {
	it.each([
		["/tutorial", DOCUMENTATION_URL],
		["/tutorial/", DOCUMENTATION_URL],
		["/tutorial?tab=cloud", `${DOCUMENTATION_URL}choose-a-model/`],
		["/tutorial?tab=ollama", `${DOCUMENTATION_URL}connect-local-models/#section-ollama`],
		["/tutorial?tab=llamacpp", `${DOCUMENTATION_URL}connect-local-models/#section-llama-cpp`],
		["/tutorial?tab=litellm", `${DOCUMENTATION_URL}connect-local-models/#section-litellm`],
		["/tutorial/?tab=browser", `${DOCUMENTATION_URL}offline-tutor/`],
		["/tutorial?tab=advanced", tutorialAdvancedHref()],
	])("permanently redirects %s before the SPA and asset fallback", async (path, destination) => {
		const response = await app.request(`https://keating.test${path}`);
		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(destination);
	});
	it("supports HEAD bookmarks without rendering the old page", async () => {
		const response = await app.request("https://keating.test/tutorial", { method: "HEAD" });
		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(DOCUMENTATION_URL);
	});
	it("keeps missing screenshot requests as asset 404s", async () => {
		const response = await app.request("https://keating.test/tutorial/missing.png");
		expect(response.status).toBe(404);
		expect(response.headers.get("location")).toBeNull();
	});
	it("keeps regular app navigation intact", async () => {
		const response = await app.request("https://keating.test/chat");
		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
	});
});

describe("legacy tutorial SPA routing", () => {
	it.each([
		["/tutorial", DOCUMENTATION_URL],
		["/tutorial/", DOCUMENTATION_URL],
		["/tutorial?tab=cloud#anthropic-api-key", tutorialApiKeyHref("anthropic")],
		["/tutorial#review-sessions", `${DOCUMENTATION_URL}sessions-and-review/`],
		["/tutorial#tab-ollama", `${DOCUMENTATION_URL}connect-local-models/#section-ollama`],
		["/tutorial#tab-llamacpp", `${DOCUMENTATION_URL}connect-local-models/#section-llama-cpp`],
		["/tutorial#tab-litellm", `${DOCUMENTATION_URL}connect-local-models/#section-litellm`],
	])("redirects %s with a full document replacement", async (href, destination) => {
		const root = createRootRoute();
		const route = createRoute({ getParentRoute: () => root, path: "/tutorial", beforeLoad: tutorialRedirectBeforeLoad });
		const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [href] }), isServer: true });
		await router.load();
		// The server-mode harness canonicalizes a trailing slash first. The SPA
		// Transitioner performs the same canonical navigation before beforeLoad.
		if (router.state.redirect?.options.href === "/tutorial") {
			router.history.replace("/tutorial");
			await router.load();
		}
		expect(router.state.redirect?.options).toMatchObject({ href: destination, reloadDocument: true, replace: true });
	});
	it("does not navigate merely because a link is preloaded", () => {
		expect(() => tutorialRedirectBeforeLoad({ location: { href: "/tutorial" }, preload: true })).not.toThrow();
	});
});
