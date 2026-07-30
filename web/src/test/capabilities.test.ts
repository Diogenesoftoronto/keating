import { describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { DEFAULT_AGENT_RUNTIME_CONFIG } from "../keating/agent-runtime";
import {
	buildCapabilityCatalog,
	filterAvailableKeatingTools,
} from "../keating/capabilities";

const tool = (name: string) => ({ name } as AgentTool);
const allTools = [
	"quiz",
	"animate",
	"generate_image",
	"workspace_inspect",
	"workspace_exec",
	"workspace_change",
	"evaluate_teaching",
	"request_teaching_improvement",
	"keating_voice",
	"remote_execute",
].map(tool);

describe("capability availability", () => {
	it("exposes every runtime-supported schema from the first turn", () => {
		const visible = filterAvailableKeatingTools(allTools, {
			runtime: DEFAULT_AGENT_RUNTIME_CONFIG,
		}).map((item) => item.name);

		expect(visible).toEqual([
			"quiz",
			"animate",
			"generate_image",
			"evaluate_teaching",
			"request_teaching_improvement",
		]);
		expect(visible).not.toContain("remote_execute");
	});

	it("exposes only workspace schemas backed by the live runtime", () => {
		const inspectOnly = filterAvailableKeatingTools(allTools, {
			runtime: {
				...DEFAULT_AGENT_RUNTIME_CONFIG,
				projectFilesEndpoint: "/api/project-files",
			},
		}).map((item) => item.name);
		const attached = filterAvailableKeatingTools(allTools, {
			runtime: {
				...DEFAULT_AGENT_RUNTIME_CONFIG,
				projectFilesEndpoint: "/api/project-files",
				localExecEndpoint: "/api/local-exec",
			},
		}).map((item) => item.name);

		expect(inspectOnly).toContain("workspace_inspect");
		expect(inspectOnly).not.toContain("workspace_exec");
		expect(inspectOnly).not.toContain("workspace_change");
		expect(attached).toEqual(expect.arrayContaining([
			"workspace_inspect",
			"workspace_exec",
			"workspace_change",
		]));
	});

	it("exposes the complete workspace bundle for remote and NodePod runtimes", () => {
		for (const runtime of [
			{
				...DEFAULT_AGENT_RUNTIME_CONFIG,
				mode: "remote" as const,
				capabilities: {
					...DEFAULT_AGENT_RUNTIME_CONFIG.capabilities,
					remoteSandbox: true,
				},
			},
			{
				...DEFAULT_AGENT_RUNTIME_CONFIG,
				mode: "browser-nodepod" as const,
			},
		]) {
			const visible = filterAvailableKeatingTools(allTools, { runtime }).map((item) => item.name);
			expect(visible).toEqual(expect.arrayContaining([
				"workspace_inspect",
				"workspace_exec",
				"workspace_change",
			]));
		}
	});

	it("exposes voice only while speech is enabled", () => {
		expect(filterAvailableKeatingTools(allTools, {
			runtime: DEFAULT_AGENT_RUNTIME_CONFIG,
			speechEnabled: false,
		}).map((item) => item.name)).not.toContain("keating_voice");
		expect(filterAvailableKeatingTools(allTools, {
			runtime: DEFAULT_AGENT_RUNTIME_CONFIG,
			speechEnabled: true,
		}).map((item) => item.name)).toContain("keating_voice");
	});

	it("keeps unavailable environments visible to diagnostics without exposing schemas", () => {
		const catalog = buildCapabilityCatalog({
			runtime: DEFAULT_AGENT_RUNTIME_CONFIG,
			speechEnabled: false,
		});
		expect(catalog.find((bundle) => bundle.id === "workspace")?.availability).toBe("unavailable");
		expect(catalog.find((bundle) => bundle.id === "voice")?.availability).toBe("unavailable");
	});
});
