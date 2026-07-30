import { describe, expect, test } from "bun:test";
import {
	classifyTool,
	evaluateToolPermission,
	provenanceFromWeb,
} from "../../keating/security";
import { TOOL_REGISTRATION_ORDER } from "../../keating/browser-tools";

const trusted = { trust: "trusted" as const, userAuthorized: true };

describe("tool permission policy", () => {
	test("classifies every registered Keating tool", () => {
		for (const name of TOOL_REGISTRATION_ORDER) expect(classifyTool(name).known, name).toBe(true);
	});
	test("allows trusted tools without confirmation", () => {
		expect(evaluateToolPermission({
			tool: classifyTool("timeline"), surface: "text", provenance: trusted,
		}).outcome).toBe("allow");
		expect(evaluateToolPermission({
			tool: classifyTool("generate_image"), surface: "text", provenance: trusted,
		}).outcome).toBe("allow");
		expect(evaluateToolPermission({
			tool: classifyTool("workspace_exec"), surface: "text", provenance: trusted,
		}).outcome).toBe("allow");
	});

	test("denies voice-triggered code execution", () => {
		expect(evaluateToolPermission({
			tool: classifyTool("bash"), surface: "voice", provenance: trusted,
		}).outcome).toBe("deny");
	});

	test("denies voice requests containing secrets", () => {
		expect(evaluateToolPermission({
			tool: { name: "feedback", risk: "state-change" },
			surface: "voice",
			provenance: trusted,
			arguments: { apiKey: "hidden" },
		}).outcome).toBe("deny");
	});

	test("untrusted web content cannot authorize execution", () => {
		expect(evaluateToolPermission({
			tool: classifyTool("remote_execute"),
			surface: "automation",
			provenance: provenanceFromWeb(["search-result-1"]),
		}).outcome).toBe("deny");
	});

	test("untrusted web content can still use non-executing tools without a prompt", () => {
		expect(evaluateToolPermission({
			tool: classifyTool("read_project_file"),
			surface: "text",
			provenance: provenanceFromWeb(),
		}).outcome).toBe("allow");
	});

	test("denies unknown tools instead of asking the learner", () => {
		expect(evaluateToolPermission({
			tool: classifyTool("future_tool"),
			surface: "text",
			provenance: trusted,
		}).outcome).toBe("deny");
	});
});
