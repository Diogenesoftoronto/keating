import type { AgentTool } from "@earendil-works/pi-agent-core";
import { shouldRouteExecutionToNodePod, type KeatingAgentRuntimeConfig } from "../agent-runtime";
import {
	isNodePodActive,
	nodePodExecute,
	nodePodApplyEdit,
	nodePodDiffFile,
	nodePodChangedFiles,
	nodePodCreateSnapshot,
	nodePodFindSnapshot,
	nodePodRestoreSnapshot,
	nodePodRunScript,
	nodePodValidateEdit,
	writeJsCounterpart,
	NODEPOD_LOCAL_ENDPOINT,
} from "../nodepod-runtime";
import { createTool, type KeatingToolsOptions, type ToolRegistry } from "./shared";

function unavailableRemoteRuntimeMessage(runtime: KeatingAgentRuntimeConfig | undefined): string {
	if (!runtime || runtime.mode === "browser-only" || !runtime.executionEndpoint) {
		return [
			"# Remote Execution Unavailable",
			"",
			"Keating is running in browser-only mode. Run supported work in the browser and surface this fallback for operations that require native binaries, durable background compute, secure server-side secrets, public inbound networking, Docker/microVM isolation, or unrestricted host filesystem access.",
		].join("\n");
	}

	return "";
}

function stringifyRemoteResult(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	if (text.length <= 12000) return text;
	return `${text.slice(0, 12000)}\n\n[remote output truncated]`;
}

export function createWorkspaceTools(options: KeatingToolsOptions): AgentTool[] {
	const tools: AgentTool[] = [
		createTool(
			"agent_runtime",
			"Inspect current agent execution mode, available sandbox capabilities, and fallback policy. Use before attempting source execution, native tooling, secret-backed work, or remote-only operations.",
			{},
			async () => {
				const runtime = options.agentRuntime;
				if (!runtime) {
					return "Agent runtime config is unavailable. Assume browser-only local execution and surface clear fallback errors for remote-only work.";
				}

				const capabilities = Object.entries(runtime.capabilities)
					.map(([key, value]) => `- ${key}: ${String(value)}`)
					.join("\n");
				const remote = runtime.remote
					? [
						"",
						"## Remote Sandbox",
						`- provider: ${runtime.remote.provider}`,
						`- endpoint: ${runtime.remote.endpoint ?? "local server default"}`,
						`- region: ${runtime.remote.region ?? "default"}`,
						`- snapshot: ${runtime.remote.snapshot ?? "default"}`,
						`- cpu: ${runtime.remote.cpu ?? "default"}`,
						`- memory: ${runtime.remote.memory ?? "default"}`,
						`- disk: ${runtime.remote.disk ?? "default"}`,
					].join("\n")
					: "";

				const nodePodActive = isNodePodActive();
				const nodePod = nodePodActive
					? [
						"",
						"## NodePod Sandbox",
						`- active: true`,
						`- local endpoint: ${NODEPOD_LOCAL_ENDPOINT}`,
						`- operations: shell.exec, fs.read, fs.write, snapshot.create`,
					].join("\n")
					: "";

				return [
					`# Agent Runtime`,
					"",
					`- mode: ${runtime.mode}`,
					`- label: ${runtime.label}`,
					`- execution endpoint: ${runtime.executionEndpoint ?? "none"}`,
					`- cloud endpoint: ${runtime.cloudEndpoint ?? "none"}`,
					`- project root: ${runtime.projectRoot ?? "none"}`,
					`- project files endpoint: ${runtime.projectFilesEndpoint ?? "none"}`,
					"",
					"## Capabilities",
					capabilities,
					remote,
					nodePod,
					"",
					"## Fallback Policy",
					`- local first: ${runtime.fallback.localFirst}`,
					`- remote available: ${runtime.fallback.remoteAvailable}`,
					`- message: ${runtime.fallback.message}`,
				].join("\n");
			}
		),

		// remote_execute - Send remote-only work to the configured microVM/cloud runtime
		createTool(
			"remote_execute",
			"Execute remote-only agent work through the configured microVM or Keating Cloud backend. Use only when browser-local tools cannot satisfy the request.",
			{
				operation: {
					type: "string",
					description: "Remote operation name, such as shell.exec, fs.read, fs.write, snapshot.create, or sandbox.provision",
				},
				payload: {
					type: "object",
					description: "Operation-specific JSON payload. For shell.exec, use { command, args, cwd, env, timeoutMs }.",
					additionalProperties: true,
				},
			},
			async (params) => {
				const runtime = options.agentRuntime;
				const operation = typeof params.operation === "string" ? params.operation.trim() : "";
				if (!operation) return "Operation required. Pass an operation parameter.";

				// Only a runtime explicitly resolved as browser-nodepod may execute
				// locally. Remote/cloud modes remain authoritative even if a stale pod
				// instance still exists in the tab.
				if (shouldRouteExecutionToNodePod(runtime) && isNodePodActive()) {
					try {
						const result = await nodePodExecute(operation, params.payload);
						return [
							"# Remote Execution Result (NodePod)",
							"",
							`- mode: browser-nodepod`,
							`- operation: ${operation}`,
							"",
							stringifyRemoteResult(result),
						].join("\n");
					} catch (error) {
						return [
							"# Remote Execution Failed (NodePod)",
							"",
							`- operation: ${operation}`,
							`- error: ${error instanceof Error ? error.message : String(error)}`,
						].join("\n");
					}
				}

				if (!runtime || runtime.mode === "browser-only" || !runtime.executionEndpoint) {
					return unavailableRemoteRuntimeMessage(runtime);
				}

				const response = await fetch(`${runtime.executionEndpoint}/execute`, {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
					},
					body: JSON.stringify({
						operation,
						payload: params.payload && typeof params.payload === "object" ? params.payload : {},
					}),
				});

				const contentType = response.headers.get("content-type") ?? "";
				const body = contentType.includes("application/json")
					? await response.json().catch(() => null)
					: await response.text();

				if (!response.ok) {
					return [
						"# Remote Execution Failed",
						"",
						`- status: ${response.status}`,
						`- mode: ${runtime.mode}`,
						`- endpoint: ${runtime.executionEndpoint}`,
						"",
						stringifyRemoteResult(body || response.statusText),
					].join("\n");
				}

				return [
					"# Remote Execution Result",
					"",
					`- mode: ${runtime.mode}`,
					`- operation: ${operation}`,
					"",
					stringifyRemoteResult(body),
				].join("\n");
			}
		),

		// animate - The model authors and renders a real Hyperframes animation
		createTool(
			"source_edit",
			"Apply a precise source code edit using search/replace blocks inside the NodePod sandbox. The file path must be absolute within the sandbox (e.g. /workspace/src/core/policy.ts). Always include enough surrounding context (5-10 lines) in the search block to make it unique. Creates a pre-edit snapshot automatically if none exists for this session.",
			{
				file: { type: "string", description: "Absolute path in NodePod VFS (e.g. /workspace/src/core/policy.ts)" },
				search: { type: "string", description: "Exact code block to search for. Must be unique in the file. Include surrounding lines for safety." },
				replace: { type: "string", description: "Replacement code block." },
				reason: { type: "string", description: "Short explanation of why this change is being made." },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active. Boot it first via the NodePod Visualizer or wait for it to initialize.";
				}
				const file = String(params.file ?? "");
				const search = String(params.search ?? "");
				const replace = String(params.replace ?? "");
				const reason = String(params.reason ?? "agent edit");

				if (!file || !search) {
					return "Error: file and search are required.";
				}

				const result = await nodePodApplyEdit({ file, search, replace, reason });
				if (!result.success) {
					return `# Edit Failed: ${file}\n\n${result.message}`;
				}

				// Auto-transpile .ts → .js so require() works in NodePod
				let jsCounterpart = "";
				if (file.endsWith(".ts")) {
					try {
						jsCounterpart = await writeJsCounterpart(file);
					} catch {
						// transpilation failed — agent can try manually
					}
				}

				return [
					`# Edit Applied: ${file}`,
					"",
					result.message,
					result.diff ? `\n**Diff:** ${result.diff.linesRemoved} removed, ${result.diff.linesAdded} added, Δ${result.diff.charDelta >= 0 ? "+" : ""}${result.diff.charDelta} chars` : "",
					jsCounterpart ? `\n**Transpiled:** ${jsCounterpart} (auto-generated for require())` : "",
					"",
					"Next steps:",
					"- Call `validate_source_edit` with a test script to confirm the change works.",
					"- Call `source_diff` to review all changes.",
				].join("\n");
			}
		),

		// source_diff - Show differences between baseline and current VFS
		createTool(
			"source_diff",
			"Show all files in the NodePod sandbox that differ from their baseline (as bundled at boot). Use after source_edit to review what changed.",
			{},
			async () => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const changed = await nodePodChangedFiles();
				if (changed.length === 0) {
					return "No changes from baseline. All files are at their original state.";
				}
				const lines = ["# Changed Files", ""];
				for (const entry of changed) {
					const diff = await nodePodDiffFile(entry.file);
					lines.push(`## ${entry.file}`);
					lines.push(`Δ ${entry.charDelta >= 0 ? "+" : ""}${entry.charDelta} chars`);
					if (diff?.baseline && diff.current) {
						// Simple diff: show last 5 lines of baseline vs current context
						lines.push("```diff");
						lines.push("// Current state (first 40 lines):");
						lines.push(diff.current.split("\n").slice(0, 40).join("\n"));
						lines.push("```");
					}
					lines.push("");
				}
				return lines.join("\n");
			}
		),

		// run_script - Execute a Node.js script inside the NodePod sandbox
		createTool(
			"run_script",
			"Write and execute a Node.js script inside the NodePod sandbox. Use this to test edited modules, run small experiments, or validate logic changes. The script runs in the /workspace directory and can require any module in the VFS.",
			{
				code: { type: "string", description: "JavaScript code to execute. Can use require() for built-in modules or files in the VFS." },
				filename: { type: "string", description: "Optional filename for the temp script (default: /workspace/_agent_script.js)" },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const code = String(params.code ?? "");
				const filename = String(params.filename ?? "/workspace/_agent_script.js");
				if (!code.trim()) {
					return "Error: code is required.";
				}
				const session = await nodePodRunScript(code, filename);
				return [
					"# Script Result",
					"",
					`- exit code: ${session.exitCode ?? "unknown"}`,
					`- duration: ${session.durationMs ?? "?"}ms`,
					"",
					session.stdout ? `## stdout\n\`\`\`\n${session.stdout}\n\`\`\`` : "",
					session.stderr ? `## stderr\n\`\`\`\n${session.stderr}\n\`\`` : "",
				].filter(Boolean).join("\n");
			}
		),

		// validate_source_edit - Run a test to confirm an edit is correct
		createTool(
			"validate_source_edit",
			"Validate a source edit by running a test script inside the NodePod sandbox. If the test fails, the edit is automatically rolled back to the pre-edit snapshot. Use this AFTER every source_edit to confirm the change works.",
			{
				file: { type: "string", description: "The .ts file that was edited (e.g. /workspace/src/core/policy.ts)" },
				testScript: { type: "string", description: "JavaScript test code. Should import the edited module (use .js extension) and assert expected behavior. Example: `const { clampPolicy } = require('/workspace/src/core/policy.js'); console.assert(clampPolicy({...}).analogyDensity === 0.5);`" },
				autoRollback: { type: "boolean", description: "If true (default), automatically restore the pre-edit snapshot on test failure." },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const file = String(params.file ?? "");
				const testScript = String(params.testScript ?? "");
				const autoRollback = params.autoRollback !== false;

				if (!file || !testScript) {
					return "Error: file and testScript are required.";
				}

				const result = await nodePodValidateEdit(file, testScript, { autoRollback });

				const lines = [
					`# Validation Result: ${result.passed ? "PASSED" : "FAILED"}`,
					"",
					`- File: ${file}`,
					`- Exit code: ${result.exitCode ?? "unknown"}`,
					`- Duration: ${result.durationMs}ms`,
					`- Rollback: ${result.restored ? "performed" : "not needed / unavailable"}`,
					"",
					"## Test Output",
					result.stdout ? `\`\`\`\n${result.stdout}\n\`\`\`` : "(no stdout)",
					result.stderr ? `\`\`\`\n${result.stderr}\n\`\`\`` : "",
				];
				return lines.filter(Boolean).join("\n");
			}
		),

		// source_snapshot - Capture the current NodePod VFS state for rollback
		createTool(
			"source_snapshot",
			"Create a snapshot of the current NodePod sandbox state. Use BEFORE making source edits so you can restore if the change causes a regression. Returns a snapshot ID you can pass to source_restore.",
			{
				label: { type: "string", description: "Human-readable label for the snapshot (e.g. before-policy-tweak)" },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const label = String(params.label ?? "manual");
				const snap = await nodePodCreateSnapshot(label);
				return [
					"# Snapshot Created",
					"",
					`- id: ${snap.id}`,
					`- instanceId: ${snap.instanceId}`,
					`- createdAt: ${snap.createdAt}`,
					"",
					"Restore later with `source_restore` and `id` set to this snapshot id.",
				].join("\n");
			}
		),

		// source_restore - Rollback NodePod VFS to a previous snapshot
		createTool(
			"source_restore",
			"Restore the NodePod sandbox to a previous snapshot. Use this when source edits caused a regression and you want to undo them. Pass either an `id` from source_snapshot or full snapshot `data`.",
			{
				id: { type: "string", description: "Snapshot id returned by source_snapshot." },
				data: { type: "object", description: "Full snapshot data object, if available." },
			},
			async (params) => {
				if (!isNodePodActive()) {
					return "NodePod sandbox is not active.";
				}
				const id = typeof params.id === "string" ? params.id : "";
				let data = params.data;
				if (!data && id) {
					const found = await nodePodFindSnapshot(id);
					data = found?.data;
				}
				if (!data) {
					return "Error: snapshot id or data is required. Pass `id` from source_snapshot, or a full snapshot object.";
				}
				try {
					await nodePodRestoreSnapshot(data);
					return `# Snapshot Restored\n\nNodePod sandbox rolled back${id ? ` to ${id}` : ""}.`;
				} catch (e) {
					return `# Restore Failed\n\n${e instanceof Error ? e.message : String(e)}`;
				}
			}
		),
		// list_project_files - List files in a directory of the host project
		createTool(
			"list_project_files",
			"List files in a directory of the host project root. Returns entries with relative paths and whether each is a directory. Use this to explore the project structure. Directories matching .gitignore/.ignore rules are filtered out (unless --no-ignore was passed at server launch).",
			{
				path: {
					type: "string",
					description: "Relative path from the project root (e.g. \"src/core\" or \"\"). Defaults to the root directory.",
				},
			},
			async (params) => {
				const runtime = options.agentRuntime;
				if (!runtime?.projectFilesEndpoint) {
					return "Project files endpoint is not available. Launch `keating web` from a project directory or pass --root=PATH to enable host project access.";
				}
				const relPath = String(params.path ?? "").replace(/^\/+/, "");
				const url = `${runtime.projectFilesEndpoint}/${relPath}`;
				try {
					const res = await fetch(url, { headers: { accept: "application/json" } });
					if (!res.ok) {
						const text = await res.text().catch(() => "");
						return `# List Failed\n\n- status: ${res.status}\n- error: ${text || res.statusText}`;
					}
					const data = await res.json() as { entries: Array<{ path: string; isDir: boolean }> };
					const lines = [
						`# Project Files: ${relPath || "/"}`,
						"",
						...data.entries.map((e) => `${e.isDir ? "📁" : "📄"} ${e.path}`),
					];
					return lines.join("\n");
				} catch (e) {
					return `# List Failed\n\n${e instanceof Error ? e.message : String(e)}`;
				}
			}
		),

		// read_project_file - Read a file from the host project root
		createTool(
			"read_project_file",
			"Read the contents of a file from the host project root. The path must be relative to the project root (e.g. \"src/core/policy.ts\"). Files matching .gitignore/.ignore rules are blocked (unless --no-ignore was passed at server launch). Returns the file content as text.",
			{
				path: {
					type: "string",
					description: "Relative path from the project root (e.g. \"src/core/policy.ts\").",
				},
			},
			async (params) => {
				const runtime = options.agentRuntime;
				if (!runtime?.projectFilesEndpoint) {
					return "Project files endpoint is not available. Launch `keating web` from a project directory or pass --root=PATH to enable host project access.";
				}
				const relPath = String(params.path ?? "").replace(/^\/+/, "");
				if (!relPath) return "Error: path is required.";
				const url = `${runtime.projectFilesEndpoint}/${relPath}`;
				try {
					const res = await fetch(url, { headers: { accept: "application/json" } });
					if (!res.ok) {
						const text = await res.text().catch(() => "");
						return `# Read Failed\n\n- status: ${res.status}\n- error: ${text || res.statusText}`;
					}
					const data = await res.json() as { path: string; content: string; size: number };
					return [
						`# ${data.path}`,
						`(${data.size} bytes)`,
						"",
						data.content,
					].join("\n");
				} catch (e) {
					return `# Read Failed\n\n${e instanceof Error ? e.message : String(e)}`;
				}
			}
		),
	];

	// Local exec tools are registered ONLY when the server advertises the
	// opt-in endpoint (keating web --allow-local-exec). Presence-as-capability:
	// the model never sees these tools unless they actually work.

	const localExecEndpoint = options.agentRuntime?.localExecEndpoint ?? null;
	if (localExecEndpoint) {
		const projectFilesEndpoint = options.agentRuntime?.projectFilesEndpoint ?? null;

		tools.push(
			createTool(
				"bash",
				"Run a shell command on the local host, scoped to the project root. Available only when Keating web was launched with --allow-local-exec. Commands run WITHOUT a shell: pass the program in `command` and its arguments in `args`. To run a shell one-liner, use command \"bash\" with args [\"-lc\", \"<script>\"]. Returns stdout, stderr, and the exit code.",
				{
					command: { type: "string", description: "Program to run, e.g. \"git\" or \"bash\"." },
					args: { type: "array", items: { type: "string" }, description: "Arguments array, e.g. [\"status\", \"--short\"]." },
					cwd: { type: "string", description: "Directory relative to the project root (defaults to the root)." },
					timeoutMs: { type: "number", description: "Optional timeout in ms (default 30000, max 120000)." },
				},
				async (params) => {
					const command = typeof params.command === "string" ? params.command.trim() : "";
					if (!command) return "Error: command is required.";
					const args = Array.isArray(params.args) ? params.args.map(String) : [];
					const cwd = typeof params.cwd === "string" ? params.cwd : "";
					const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
					try {
						const res = await fetch(`${localExecEndpoint}/exec`, {
							method: "POST",
							headers: { accept: "application/json", "content-type": "application/json" },
							body: JSON.stringify({ command, args, cwd, timeoutMs }),
						});
						if (!res.ok) {
							const text = await res.text().catch(() => "");
							return `# Command Failed\n\n- status: ${res.status}\n- error: ${text || res.statusText}`;
						}
						const data = (await res.json()) as {
							command: string;
							args: string[];
							exitCode: number | null;
							signal: string | null;
							stdout: string;
							stderr: string;
							stdoutTruncated: boolean;
							stderrTruncated: boolean;
							durationMs: number;
							timedOut: boolean;
						};
						const lines = [
							`# $ ${data.command}${data.args.length ? " " + data.args.join(" ") : ""}`,
							`- exit code: ${data.exitCode ?? (data.signal ? `signal ${data.signal}` : "unknown")}`,
							`- duration: ${data.durationMs}ms${data.timedOut ? " (timed out)" : ""}`,
							"",
						];
						if (data.stdout) lines.push("## stdout", "```", data.stdout + (data.stdoutTruncated ? "\n[truncated]" : ""), "```");
						if (data.stderr) lines.push("## stderr", "```", data.stderr + (data.stderrTruncated ? "\n[truncated]" : ""), "```");
						if (!data.stdout && !data.stderr) lines.push("(no output)");
						return lines.join("\n");
					} catch (e) {
						return `# Command Failed\n\n${e instanceof Error ? e.message : String(e)}`;
					}
				},
				["command"],
			),
		);

		tools.push(
			createTool(
				"write_project_file",
				"Create or overwrite a file in the host project root. Available only when Keating web was launched with --allow-local-exec. The path is relative to the project root.",
				{
					path: { type: "string", description: "Relative path from the project root, e.g. \"src/core/policy.ts\"." },
					content: { type: "string", description: "Full file content to write." },
				},
				async (params) => {
					const relPath = typeof params.path === "string" ? params.path.replace(/^\/+/, "") : "";
					if (!relPath) return "Error: path is required.";
					const content = typeof params.content === "string" ? params.content : "";
					try {
						const res = await fetch(`${localExecEndpoint}/write`, {
							method: "POST",
							headers: { accept: "application/json", "content-type": "application/json" },
							body: JSON.stringify({ path: relPath, content }),
						});
						if (!res.ok) {
							const text = await res.text().catch(() => "");
							return `# Write Failed\n\n- status: ${res.status}\n- error: ${text || res.statusText}`;
						}
						const data = (await res.json()) as { path: string; bytes: number };
						return `# Wrote ${data.path}\n\n(${data.bytes} bytes)`;
					} catch (e) {
						return `# Write Failed\n\n${e instanceof Error ? e.message : String(e)}`;
					}
				},
				["path", "content"],
			),
		);

		if (projectFilesEndpoint) {
			tools.push(
				createTool(
					"edit_project_file",
					"Apply a precise search/replace edit to a host project file. Available only when Keating web was launched with --allow-local-exec. The `search` block must appear exactly once in the file (include surrounding context to make it unique).",
					{
						path: { type: "string", description: "Relative path from the project root." },
						search: { type: "string", description: "Exact text to find. Must be unique in the file." },
						replace: { type: "string", description: "Replacement text." },
					},
					async (params) => {
						const relPath = typeof params.path === "string" ? params.path.replace(/^\/+/, "") : "";
						if (!relPath) return "Error: path is required.";
						const search = typeof params.search === "string" ? params.search : "";
						const replace = typeof params.replace === "string" ? params.replace : "";
						if (!search) return "Error: search is required.";
						try {
							const readRes = await fetch(`${projectFilesEndpoint}/${relPath}`, { headers: { accept: "application/json" } });
							if (!readRes.ok) {
								const text = await readRes.text().catch(() => "");
								return `# Edit Failed\n\n- status: ${readRes.status}\n- error: ${text || readRes.statusText}`;
							}
							const file = (await readRes.json()) as { content: string };
							const occurrences = file.content.split(search).length - 1;
							if (occurrences === 0) return `# Edit Failed\n\nSearch block not found in ${relPath}.`;
							if (occurrences > 1) return `# Edit Failed\n\nSearch block appears ${occurrences} times in ${relPath}; add more surrounding context to make it unique.`;
							const updated = file.content.replace(search, replace);
							const writeRes = await fetch(`${localExecEndpoint}/write`, {
								method: "POST",
								headers: { accept: "application/json", "content-type": "application/json" },
								body: JSON.stringify({ path: relPath, content: updated }),
							});
							if (!writeRes.ok) {
								const text = await writeRes.text().catch(() => "");
								return `# Edit Failed\n\n- status: ${writeRes.status}\n- error: ${text || writeRes.statusText}`;
							}
							const data = (await writeRes.json()) as { path: string; bytes: number };
							return `# Edited ${data.path}\n\n(${data.bytes} bytes)`;
						} catch (e) {
							return `# Edit Failed\n\n${e instanceof Error ? e.message : String(e)}`;
						}
					},
					["path", "search", "replace"],
				),
			);
		}
	}

	return tools;
}

export function createWorkspaceCapabilityTools(registry: ToolRegistry, options: KeatingToolsOptions = {}): AgentTool[] {
	return [
		createTool(
			"workspace_inspect",
			"Batch read-only workspace operations. Use one call for related directory listings, file reads, and sandbox diffs.",
			{
				requests: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							operation: { type: "string", enum: ["list", "read", "diff"] },
							path: { type: "string" },
						},
						required: ["operation"],
					},
				},
			},
			async (params) => {
				const requests = Array.isArray(params.requests) ? params.requests : [];
				const sections: string[] = [];
				const runtime = options.agentRuntime;
				const nodePod = shouldRouteExecutionToNodePod(runtime);
				const remote = runtime?.mode === "host" || runtime?.mode === "remote" || runtime?.mode === "cloud";
				for (const request of requests) {
					if (!request || typeof request !== "object") continue;
					const item = request as Record<string, unknown>;
					const operation = String(item.operation ?? "");
					const toolName = operation === "list" ? "list_project_files" : operation === "read" ? "read_project_file" : operation === "diff" ? "source_diff" : "";
					if (!toolName) continue;
					if (nodePod && operation === "diff") {
						sections.push(await registry.invoke("source_diff", {}));
					} else if (nodePod || remote) {
						const remoteOperation = operation === "list" ? "fs.list" : operation === "read" ? "fs.read" : "source.diff";
						const rawPath = typeof item.path === "string" ? item.path.trim() : "";
						const path = nodePod
							? rawPath.startsWith("/workspace")
								? rawPath
								: `/workspace${rawPath ? `/${rawPath.replace(/^\.?\//, "")}` : ""}`
							: rawPath;
						sections.push(await registry.invoke("remote_execute", {
							operation: remoteOperation,
							payload: {
								path,
								...(nodePod && operation === "read" ? { encoding: "utf8" } : {}),
							},
						}));
					} else {
						sections.push(await registry.invoke(toolName, { path: item.path }));
					}
				}
				return sections.join("\n\n---\n\n") || "No valid inspection requests were supplied.";
			},
			["requests"],
		),
		createTool(
			"workspace_exec",
			"Execute one or more commands through the connected local, NodePod, or remote backend. Commands are run sequentially and stop after the first failure.",
			{
				commands: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							command: { type: "string" },
							args: { type: "array", items: { type: "string" } },
							cwd: { type: "string" },
							timeout_ms: { type: "number" },
						},
						required: ["command"],
					},
				},
			},
			async (params) => {
				const commands = Array.isArray(params.commands) ? params.commands : [];
				const sections: string[] = [];
				for (const command of commands) {
					if (!command || typeof command !== "object") continue;
					const item = command as Record<string, unknown>;
					const commandName = String(item.command ?? "").trim();
					if (!commandName) continue;
					const args = Array.isArray(item.args) ? item.args.map(String) : [];
					const localTool = registry.has("bash");
					const output = localTool
						? await registry.invoke( "bash", { command: commandName, args, cwd: item.cwd, timeoutMs: item.timeout_ms })
						: await registry.invoke( "remote_execute", {
							operation: "shell.exec",
							payload: { command: commandName, args, cwd: item.cwd, timeoutMs: item.timeout_ms },
						});
					sections.push(output);
					if (/failed|exit code:\s*[1-9]/i.test(output)) break;
				}
				return sections.join("\n\n---\n\n") || "No valid commands were supplied.";
			},
			["commands"],
		),
		createTool(
			"workspace_change",
			"Apply one or more precise edits through the connected workspace adapter. NodePod edits may include validation and automatic rollback.",
			{
				edits: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							path: { type: "string" },
							search: { type: "string" },
							replace: { type: "string" },
							reason: { type: "string" },
							test_script: { type: "string" },
						},
						required: ["path", "search", "replace"],
					},
				},
			},
			async (params) => {
				const edits = Array.isArray(params.edits) ? params.edits : [];
				const sections: string[] = [];
				const runtime = options.agentRuntime;
				const remote = runtime?.mode === "host" || runtime?.mode === "remote" || runtime?.mode === "cloud";
				for (const edit of edits) {
					if (!edit || typeof edit !== "object") continue;
					const item = edit as Record<string, unknown>;
					const path = String(item.path ?? "");
					const nodePod = shouldRouteExecutionToNodePod(runtime) && isNodePodActive();
					const output = remote
						? await registry.invoke("remote_execute", {
							operation: "fs.edit",
							payload: { path, search: item.search, replace: item.replace, reason: item.reason },
						})
						: await registry.invoke(nodePod ? "source_edit" : "edit_project_file", nodePod
							? { file: path, search: item.search, replace: item.replace, reason: item.reason }
							: { path, search: item.search, replace: item.replace });
					sections.push(output);
					if (/edit failed|capability unavailable/i.test(output)) break;
					if ((nodePod || remote) && typeof item.test_script === "string" && item.test_script.trim()) {
						const validation = remote
							? await registry.invoke("remote_execute", {
								operation: "shell.exec",
								payload: { command: "sh", args: ["-lc", item.test_script], cwd: "/workspace" },
							})
							: await registry.invoke("validate_source_edit", {
							file: path,
							testScript: item.test_script,
							autoRollback: true,
						});
						sections.push(validation);
						if (/FAILED/.test(validation)) break;
					}
				}
				return sections.join("\n\n---\n\n") || "No valid edits were supplied.";
			},
			["edits"],
		),
	];
}
