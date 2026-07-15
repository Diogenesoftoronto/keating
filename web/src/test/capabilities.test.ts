import { describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { DEFAULT_AGENT_RUNTIME_CONFIG } from "../keating/agent-runtime";
import {
	buildCapabilityCatalog,
	KeatingCapabilityController,
} from "../keating/capabilities";

const tool = (name: string) => ({ name } as AgentTool);

describe("capability registry", () => {
	it("does not expose optional schemas until a bundle is active", () => {
		const controller = new KeatingCapabilityController({ runtime: DEFAULT_AGENT_RUNTIME_CONFIG });
		controller.setAllTools([tool("quiz"), tool("ask_user_question"), tool("learner_state"), tool("inspect_learning_context"), tool("animate"), tool("generate_image"), tool("evaluate_teaching"), tool("request_teaching_improvement"), tool("workspace_exec")]);

		expect(controller.tools().map((item) => item.name)).toEqual(["activate_capabilities", "quiz"]);
		controller.activate(["learner-details", "media", "improvement"]);
		expect(controller.tools().map((item) => item.name)).toEqual([
			"activate_capabilities",
			"quiz",
			"inspect_learning_context",
			"animate",
			"generate_image",
			"evaluate_teaching",
			"request_teaching_improvement",
		]);
	});

	it("keeps runtime-impossible bundles discoverable without exposing their tools", () => {
		const controller = new KeatingCapabilityController({ runtime: DEFAULT_AGENT_RUNTIME_CONFIG });
		controller.setAllTools([tool("bash")]);
		const result = controller.activate(["workspace", "not-real"]);

		expect(result.activated).toEqual([]);
		expect(result.unavailable[0]?.id).toBe("workspace");
		expect(result.unknown).toEqual(["not-real"]);
		expect(controller.tools().map((item) => item.name)).toEqual(["activate_capabilities"]);
	});

	it("marks workspace and voice availability from the live environment", () => {
		const catalog = buildCapabilityCatalog({
			runtime: {
				...DEFAULT_AGENT_RUNTIME_CONFIG,
				projectFilesEndpoint: "/api/project-files",
				capabilities: { ...DEFAULT_AGENT_RUNTIME_CONFIG.capabilities, hostProjectAccess: true },
			},
			speechEnabled: true,
		});

		expect(catalog.find((bundle) => bundle.id === "workspace")?.availability).toBe("available");
		expect(catalog.find((bundle) => bundle.id === "workspace")?.tools).toEqual(["workspace_inspect"]);
		expect(catalog.find((bundle) => bundle.id === "voice")?.availability).toBe("available");
	});

	it("exposes only consolidated workspace schemas supported by the runtime", () => {
		const inspectOnly = buildCapabilityCatalog({
			runtime: {
				...DEFAULT_AGENT_RUNTIME_CONFIG,
				projectFilesEndpoint: "/api/project-files",
			},
		}).find((bundle) => bundle.id === "workspace");
		const attached = buildCapabilityCatalog({
			runtime: {
				...DEFAULT_AGENT_RUNTIME_CONFIG,
				projectFilesEndpoint: "/api/project-files",
				localExecEndpoint: "/api/local-exec",
			},
		}).find((bundle) => bundle.id === "workspace");

		expect(inspectOnly?.tools).toEqual(["workspace_inspect"]);
		expect(attached?.tools).toEqual(["workspace_inspect", "workspace_exec", "workspace_change"]);
	});

	it("updates the live tool set after activating multiple bundles", () => {
		const controller = new KeatingCapabilityController({ runtime: DEFAULT_AGENT_RUNTIME_CONFIG });
		const updates: string[][] = [];
		controller.setListener((tools) => updates.push(tools.map((item) => item.name)));
		controller.setAllTools([tool("quiz"), tool("animate"), tool("generate_image"), tool("evaluate_teaching"), tool("request_teaching_improvement")]);
		controller.activate(["media", "improvement"]);

		expect(updates.at(-1)).toEqual(["activate_capabilities", "quiz", "animate", "generate_image", "evaluate_teaching", "request_teaching_improvement"]);
	});

	it("refuses to claim activation when an advertised schema was not registered", () => {
		const controller = new KeatingCapabilityController({ runtime: DEFAULT_AGENT_RUNTIME_CONFIG });
		controller.setAllTools([tool("animate")]);

		const result = controller.activate(["media"]);

		expect(result.activated).toEqual([]);
		expect(result.unavailable).toEqual([{
			id: "media",
			reason: "Tool schemas are not registered: generate_image.",
		}]);
	});

	it("terminates a successful activation run so the host can continue with fresh schemas", async () => {
		const controller = new KeatingCapabilityController({ runtime: DEFAULT_AGENT_RUNTIME_CONFIG });
		controller.setAllTools([tool("animate"), tool("generate_image")]);
		let activation: ReturnType<KeatingCapabilityController["activate"]> | undefined;
		controller.setActivationListener((result) => { activation = result; });

		const activateTool = controller.tools().find((item) => item.name === "activate_capabilities")!;
		const output = await activateTool.execute("call-1", { ids: ["media"] }) as { terminate?: boolean };

		expect(output.terminate).toBe(true);
		expect(activation?.activated).toEqual(["media"]);
		expect(controller.tools().map((item) => item.name)).toEqual([
			"activate_capabilities",
			"animate",
			"generate_image",
		]);
	});
});
