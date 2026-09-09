import { expect, test } from "bun:test";
import { startOAuthCallbackReceiver } from "../src/oauth-callback.js";

for (const outcome of ["code=one-time-proof", "error=access_denied"]) {
	test(`Not Organic native receiver validates and delivers ${outcome.split("=")[0]} once`, async () => {
		const state = "a".repeat(43);
		const received: URL[] = [];
		const started = await startOAuthCallbackReceiver({ provider: "notorganic", port: 0, expectedState: state, onCallback: ({ url }) => { received.push(url); } });
		if (!started.available) throw new Error("Could not bind test receiver");
		try {
			const base = `${started.receiver.origin}/notorganic/callback`;
			expect((await fetch(`${base}?${outcome}&state=${"b".repeat(43)}`)).status).toBe(400);
			expect(received).toHaveLength(0);
			const response = await fetch(`${base}?${outcome}&state=${state}`);
			expect(response.status).toBe(200);
			expect(await response.text()).not.toContain(state);
			expect(received).toHaveLength(1);
			expect(received[0]!.searchParams.get("state")).toBe(state);
			expect((await fetch(`${base}?${outcome}&state=${state}`)).status).toBe(410);
		} finally { await started.receiver.stop(); }
	});
}
