import { describe, expect, it } from "bun:test";
import { publicClientConfig } from "../notorganic-provider/public-client";

describe("chat sync consent rollout", () => {
	const env = { VITE_NOTORGANIC_PUBLIC_ISSUER: "https://provider.test", VITE_NOTORGANIC_AUTHORIZATION_URL: "https://portal.test/authorize", VITE_NOTORGANIC_SCOPE: "wallet:read infer:balanced" };
	it("requests account sync without any relay configuration", () => {
		expect(publicClientConfig(env, "https://keating.test", false)?.scope).toBe("wallet:read infer:balanced sync:key:read sync:read sync:write");
	});
	it("keeps sync permissions explicit even with custom inference scopes", () => {
		const config = publicClientConfig(env, "https://keating.test", false)!;
		expect(config.scope).toBe("wallet:read infer:balanced sync:key:read sync:read sync:write");
		expect(config.scope).not.toContain("sync:*");
	});
	it("does not duplicate existing sync consent", () => {
		const config = publicClientConfig({ ...env, VITE_NOTORGANIC_SCOPE: "wallet:read sync:key:read sync:read sync:write" }, "https://keating.test", false)!;
		expect(config.scope).toBe("wallet:read sync:key:read sync:read sync:write");
	});
});
