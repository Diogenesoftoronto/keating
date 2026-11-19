import { expect, test } from "bun:test";
import { liveReadiness, startOptions } from "../components/live/preflight";

const base = {hasKey: true, accountLiveSelected: false, accountLiveConfigured: false, accountLiveName: "GPT Live",
	providerName: "Google", credentialProvider: true, needsConsent: false, microphone: null};

test("live access, credentials, consent and browser permission determine readiness", () => {
	expect(liveReadiness(base).ready).toBe(true);
	expect(liveReadiness({...base, microphone: "granted"}).label).toContain("microphone allowed");
	expect(liveReadiness({...base, hasKey: null}).label).toContain("Checking");
	expect(liveReadiness({...base, microphone: "denied"}).label).toBe("Microphone blocked");
	expect(liveReadiness({...base, needsConsent: true}).ready).toBeFalsy();
	expect(liveReadiness({...base, hasKey: false}).action).toBe("Add a key");
	expect(liveReadiness({...base, hasKey: false, credentialProvider: false}).action).toBe("Choose a live model");
	expect(liveReadiness({...base, hasKey: false, accountLiveSelected: true}).label).toContain("unavailable");
	expect(liveReadiness({...base, hasKey: false, accountLiveSelected: true, accountLiveConfigured: true}).action).toBe("Connect Not Organic");
});
test("only native video models can start with camera or screen", () => {
	expect(startOptions(false).map(o=>o.value)).toEqual(["voice"]);
	expect(startOptions(true).map(o=>o.value)).toEqual(["voice","camera","screen"]);
});
