import { describe, expect, test } from "bun:test";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
	(globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}

const baseRuntime = {
	mode: "browser-only",
	label: "Browser-only agent",
	executionEndpoint: null,
	cloudEndpoint: null,
	projectRoot: "/repo",
	projectFilesEndpoint: null,
	localExecEndpoint: null,
	remote: null,
	capabilities: {
		browserLocal: true,
		remoteSandbox: false,
		secureIsolation: false,
		nativeBinaries: false,
		serverBrokeredSecrets: false,
		durableCompute: false,
		hostProjectAccess: false,
		localCommandExecution: false,
	},
	fallback: {
		localFirst: true,
		remoteAvailable: false,
		message: "Browser-only test runtime.",
	},
} as const;

const consolidatedTools = [
	"evaluate_teaching",
	"request_teaching_improvement",
	"workspace_inspect",
	"workspace_exec",
	"workspace_change",
];

const legacyAdapters = [
	"bench",
	"prompt_eval",
	"evolve",
	"prompt_evolve",
	"auto_improve",
	"remote_execute",
	"list_project_files",
	"read_project_file",
	"source_edit",
	"source_diff",
	"validate_source_edit",
];

const browserOnlyToolOrder = [
	"agent_runtime",
	"remote_execute",
	"animate",
	"deck",
	"generate_image",
	"bench",
	"evolve",
	"quiz",
	"feedback",
	"grade_quiz",
	"policy",
	"outputs",
	"learner_state",
	"auto_improve",
	"improve",
	"trace",
	"prompt_evolve",
	"prompt_eval",
	"timeline",
	"due",
	"ask_user_question",
	"grade_question_checks",
	"remember_learner_profile",
	"set_learner_goal",
	"list_learner_goals",
	"update_goal_step",
	"source_edit",
	"source_diff",
	"run_script",
	"validate_source_edit",
	"source_snapshot",
	"source_restore",
	"list_project_files",
	"read_project_file",
	...consolidatedTools,
];

describe("browser tool assembly contract", () => {
	test("assembles unique consolidated tools and their hidden legacy adapters", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		const tools = await createKeatingTools({} as any, { agentRuntime: baseRuntime });
		const names = tools.map((tool) => tool.name);

		expect(new Set(names).size).toBe(names.length);
		for (const name of [...consolidatedTools, ...legacyAdapters]) {
			expect(names).toContain(name);
		}
		expect(names).toEqual(browserOnlyToolOrder);
	});

	test("gates host mutation tools by the advertised endpoints", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");

		const browserOnly = await createKeatingTools({} as any, { agentRuntime: baseRuntime });
		expect(browserOnly.map((tool) => tool.name)).not.toContain("bash");
		expect(browserOnly.map((tool) => tool.name)).not.toContain("write_project_file");
		expect(browserOnly.map((tool) => tool.name)).not.toContain("edit_project_file");

		const localExec = await createKeatingTools({} as any, {
			agentRuntime: {
				...baseRuntime,
				localExecEndpoint: "/api/local-exec",
				capabilities: { ...baseRuntime.capabilities, localCommandExecution: true },
			},
		});
		const localNames = localExec.map((tool) => tool.name);
		expect(localNames).toContain("bash");
		expect(localNames).toContain("write_project_file");
		expect(localNames).not.toContain("edit_project_file");

		const attachedProject = await createKeatingTools({} as any, {
			agentRuntime: {
				...baseRuntime,
				projectFilesEndpoint: "/api/project-files",
				localExecEndpoint: "/api/local-exec",
				capabilities: {
					...baseRuntime.capabilities,
					hostProjectAccess: true,
					localCommandExecution: true,
				},
			},
		});
		expect(attachedProject.map((tool) => tool.name)).toEqual(expect.arrayContaining([
			"bash",
			"write_project_file",
			"edit_project_file",
		]));
	});

	test("appends the optional speech tool last without resolving credentials", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		let credentialCalls = 0;
		const tools = await createKeatingTools({} as any, {
			agentRuntime: baseRuntime,
			speech: {
				settings: {
					enabled: true,
					providerId: "gemini-live",
					model: "test-live-model",
					voiceName: "Kore",
					customModels: [],
					microphoneEnabled: false,
					videoEnabled: false,
					videoSource: "camera",
					frameIntervalMs: 1000,
					reasoningEffort: "medium",
				},
				getApiKey: async () => {
					credentialCalls += 1;
					return undefined;
				},
			},
		});

		expect(tools.at(-1)?.name).toBe("keating_voice");
		expect(tools.filter((tool) => tool.name === "keating_voice")).toHaveLength(1);
		expect(credentialCalls).toBe(0);
	});

	test("makes every runtime-supported public schema callable immediately", async () => {
		const [{ createKeatingTools }, { filterAvailableKeatingTools }] = await Promise.all([
			import("../keating/browser-tools"),
			import("../keating/capabilities"),
		]);
		const remoteRuntime = {
			...baseRuntime,
			mode: "remote" as const,
			label: "Remote test agent",
			executionEndpoint: "/api/agent-runtime/remote",
			remote: { provider: "test", endpoint: "https://sandbox.example", region: null, snapshot: null, cpu: null, memory: null, disk: null },
			capabilities: {
				...baseRuntime.capabilities,
				remoteSandbox: true,
				secureIsolation: true,
				nativeBinaries: true,
				serverBrokeredSecrets: true,
				durableCompute: true,
			},
			fallback: { localFirst: true, remoteAvailable: true, message: "External test sandbox." },
		};
		const tools = await createKeatingTools({} as any, {
			agentRuntime: remoteRuntime,
			speech: {
				settings: { enabled: true, providerId: "gemini-live", model: "test", voiceName: "Kore", customModels: [], microphoneEnabled: false, videoEnabled: false, videoSource: "camera", frameIntervalMs: 1000, reasoningEffort: "medium" },
				getApiKey: async () => undefined,
			},
		});
		const activeNames = filterAvailableKeatingTools(tools, {
			runtime: remoteRuntime,
			speechEnabled: true,
		}).map((tool) => tool.name);

		for (const expected of [
			"animate",
			"generate_image",
			"workspace_inspect",
			"workspace_exec",
			"workspace_change",
			"evaluate_teaching",
			"request_teaching_improvement",
			"keating_voice",
		]) expect(activeNames).toContain(expected);
	});

	test("posts remote execution to the configured external relay", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		const originalFetch = globalThis.fetch;
		let captured: { url: string; body: unknown } | undefined;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			captured = { url: String(input), body: JSON.parse(String(init?.body)) };
			return new Response(JSON.stringify({ exitCode: 0, stdout: "/workspace\n" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;

		try {
			const tools = await createKeatingTools({} as any, {
				agentRuntime: {
					...baseRuntime,
					mode: "remote",
					label: "External sandbox",
					executionEndpoint: "/api/agent-runtime/remote",
					remote: { provider: "custom", endpoint: "https://sandbox.example", region: null, snapshot: null, cpu: null, memory: null, disk: null },
					capabilities: { ...baseRuntime.capabilities, remoteSandbox: true },
					fallback: { localFirst: true, remoteAvailable: true, message: "External sandbox." },
				},
			});
			const remoteExecute = tools.find((tool) => tool.name === "remote_execute")!;
			await remoteExecute.execute("call-remote", {
				operation: "shell.exec",
				payload: { command: "pwd", cwd: "/workspace" },
			});

			expect(captured).toEqual({
				url: "/api/agent-runtime/remote/execute",
				body: { operation: "shell.exec", payload: { command: "pwd", cwd: "/workspace" } },
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("routes NodePod workspace inspection to its VFS using readable source paths", async () => {
		const { createWorkspaceCapabilityTools } = await import("../keating/browser-tools/workspace");
		const invocations: Array<{ name: string; params: Record<string, unknown> }> = [];
		const registry = {
			has: () => true,
			invoke: async (name: string, params: Record<string, unknown>) => {
				invocations.push({ name, params });
				return `${name}:${String(params.operation ?? "direct")}`;
			},
		};
		const [inspect] = createWorkspaceCapabilityTools(registry, {
			agentRuntime: {
				...baseRuntime,
				mode: "browser-nodepod",
				label: "Browser + NodePod agent",
				executionEndpoint: "nodepod://local",
				capabilities: {
					...baseRuntime.capabilities,
					remoteSandbox: true,
				},
				fallback: {
					localFirst: true,
					remoteAvailable: true,
					message: "NodePod test runtime.",
				},
			},
		});

		await inspect.execute("inspect-own-code", {
			requests: [
				{ operation: "list", path: "" },
				{ operation: "read", path: "web/src/keating/capabilities.ts" },
				{ operation: "diff" },
			],
		});

		expect(invocations).toEqual([
			{
				name: "remote_execute",
				params: {
					operation: "fs.list",
					payload: { path: "/workspace" },
				},
			},
			{
				name: "remote_execute",
				params: {
					operation: "fs.read",
					payload: {
						path: "/workspace/web/src/keating/capabilities.ts",
						encoding: "utf8",
					},
				},
			},
			{
				name: "source_diff",
				params: {},
			},
		]);
	});
});
