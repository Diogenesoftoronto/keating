import { describe, expect, it } from "bun:test";
import { buildCapabilityCatalog } from "../keating/capabilities";
import {
	composeSessionStartSystemPrompt,
	runSessionStartHooks,
	type SessionStartHook,
} from "../keating/session-start-hooks";

describe("session-start hooks", () => {
	it("runs hooks in order and isolates individual failures", async () => {
		const calls: string[] = [];
		const hooks: SessionStartHook[] = [
			{ id: "profile", run: async () => { calls.push("profile"); return "Profile context"; } },
			{ id: "broken", run: async () => { calls.push("broken"); throw new Error("offline"); } },
			{ id: "goals", run: async () => { calls.push("goals"); return "Goal context"; } },
		];
		const context = await runSessionStartHooks({} as any, hooks);
		expect(calls).toEqual(["profile", "broken", "goals"]);
		expect(context).toContain("Profile context");
		expect(context).toContain("Goal context");
		expect(context).not.toContain("offline");
	});

	it("returns no appendix when hooks have no context", async () => {
		const context = await runSessionStartHooks({} as any, [
			{ id: "empty", run: async () => "" },
		]);
		expect(context).toBe("");
	});

	it("loads profile, review, goal, and discoverable capability context automatically", async () => {
		let sessionStarts = 0;
		const storage = {
			recordSessionStart: async () => { sessionStarts += 1; },
			getGoals: async () => [{
				id: "goal-1",
				title: "Ship a compiler",
				status: "active",
				steps: [{ id: "step-1", title: "Parse expressions", status: "in_progress" }],
			}],
			getLearnerState: async () => ({
				sessionsCount: 3,
				strengths: ["syntax"],
				weaknesses: ["precedence"],
				topicProfiles: [{
					topic: "operator precedence",
					status: "needs-review",
					mastery: 0.4,
					retention: 0.3,
					confidence: 0.7,
					evidenceCount: 2,
					lastEvidenceAt: Date.now(),
					reportedChallenges: [],
				}],
			}),
		};

		const context = await runSessionStartHooks(storage as any, undefined, {
			capabilityCatalog: buildCapabilityCatalog(),
		});
		expect(sessionStarts).toBe(1);
		expect(context).toContain("operator precedence");
		expect(context).toContain("Parse expressions");
		expect(context).toContain("Optional capability bundles");
		expect(context).toContain("workspace");
	});

	it("composes session context into rebuilt prompts without duplication", () => {
		const firstContext = "\n\n## Session-start context (loaded automatically)\n\nProfile one";
		const secondContext = "\n\n## Session-start context (loaded automatically)\n\nProfile two";
		const initial = composeSessionStartSystemPrompt("Persona one\n\nProtocol", firstContext);
		const rebuilt = composeSessionStartSystemPrompt(`${initial}\n\nSpeech guidance`, secondContext);

		expect(initial).toContain("Profile one");
		expect(rebuilt).toContain("Profile two");
		expect(rebuilt).not.toContain("Profile one");
		expect(rebuilt.match(/## Session-start context/g)?.length).toBe(1);
	});

	it("leaves a rebuilt prompt clean before session context is available", () => {
		expect(composeSessionStartSystemPrompt("Persona\n\nProtocol\n", "")).toBe("Persona\n\nProtocol");
	});

	it("does not erase an already composed appendix when context is temporarily unavailable", () => {
		const composed = "Persona\n\n## Session-start context (loaded automatically)\n\nProfile";
		expect(composeSessionStartSystemPrompt(composed, "")).toBe(composed);
	});
});
