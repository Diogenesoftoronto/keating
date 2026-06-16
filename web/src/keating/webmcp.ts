import type { AgentTool } from "@earendil-works/pi-agent-core";
import webMcpSource from "@jason.today/webmcp/src/webmcp.js?raw";

import { KeatingStorage } from "./storage";

type WebMcpToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

type WebMcpInstance = {
	registerTool(name: string, description: string, schema: Record<string, unknown>, execute: (args: Record<string, unknown>) => unknown): void;
	registerPrompt(name: string, description: string, args: Array<Record<string, unknown>>, execute: (args: Record<string, unknown>) => unknown): void;
	registerResource(name: string, description: string, options: Record<string, unknown>, provide: (uri: string) => unknown): void;
};

type WebMcpConstructor = new (options?: Record<string, unknown>) => WebMcpInstance;

declare global {
	interface Window {
		webMCP?: WebMcpInstance;
		__KeatingWebMCP?: WebMcpConstructor;
		__keatingWebMcpRegistered?: boolean;
	}
}

function errorResult(error: unknown): WebMcpToolResult {
	return {
		content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
		isError: true,
	};
}

function artifactUri(type: string, id: string): string {
	return `keating-artifact://${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

async function loadWebMcpConstructor(): Promise<WebMcpConstructor | null> {
	if (window.__KeatingWebMCP) return window.__KeatingWebMCP;

	const script = document.createElement("script");
	const source = `${webMcpSource}\n;window.__KeatingWebMCP = WebMCP;`;
	const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
	script.src = url;
	script.async = true;

	await new Promise<void>((resolve, reject) => {
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("Failed to load WebMCP browser bridge."));
		document.head.appendChild(script);
	});

	URL.revokeObjectURL(url);
	return window.__KeatingWebMCP ?? null;
}

async function ensureWebMcp(): Promise<WebMcpInstance | null> {
	if (window.webMCP) return window.webMCP;

	const Constructor = await loadWebMcpConstructor();
	if (!Constructor) return null;

	window.webMCP = new Constructor({
		color: "#b7791f",
		position: "bottom-right",
		size: "34px",
		padding: "18px",
	});
	return window.webMCP;
}

async function readArtifact(storage: KeatingStorage, type: string, id: string): Promise<{ mimeType: string; text: string }> {
	switch (type) {
		case "plan": {
			const artifact = (await storage.getLessonPlans()).find((item) => item.id === id);
			if (!artifact) break;
			return { mimeType: "text/markdown", text: artifact.content };
		}
		case "map": {
			const artifact = (await storage.getLessonMaps()).find((item) => item.id === id);
			if (!artifact) break;
			return { mimeType: "text/plain", text: artifact.mmdContent };
		}
		case "animation": {
			const artifact = (await storage.getAnimations()).find((item) => item.id === id);
			if (!artifact) break;
			return {
				mimeType: "application/json",
				text: JSON.stringify({
					topic: artifact.topic,
					storyboard: artifact.storyboard,
					scene: artifact.scene,
					manifest: JSON.parse(artifact.manifest),
				}, null, 2),
			};
		}
		case "deck": {
			const artifact = (await storage.getDecks()).find((item) => item.id === id);
			if (!artifact) break;
			return { mimeType: "application/json", text: JSON.stringify(artifact, null, 2) };
		}
		case "verification": {
			const artifact = (await storage.getVerifications()).find((item) => item.id === id);
			if (!artifact) break;
			return { mimeType: "text/markdown", text: artifact.checklist };
		}
		case "benchmark": {
			const artifact = (await storage.getBenchmarks()).find((item) => item.id === id);
			if (!artifact) break;
			return { mimeType: "text/markdown", text: artifact.report };
		}
		case "evolution": {
			const artifact = (await storage.getEvolutions()).find((item) => item.id === id);
			if (!artifact) break;
			return { mimeType: "text/markdown", text: artifact.report };
		}
		case "prompt-evolution": {
			const artifact = (await storage.getPromptEvolutions()).find((item) => item.id === id);
			if (!artifact) break;
			return { mimeType: "text/markdown", text: artifact.report };
		}
	}

	throw new Error(`Unknown Keating artifact: ${type}/${id}`);
}

export async function registerKeatingWebMcp(storage: KeatingStorage, tools: AgentTool[]): Promise<void> {
	if (typeof window === "undefined" || typeof document === "undefined") return;

	const mcp = await ensureWebMcp();
	if (!mcp) return;

	for (const tool of tools) {
		mcp.registerTool(
			`keating.${tool.name}`,
			tool.description ?? `Run Keating tool: ${tool.name}`,
			tool.parameters as Record<string, unknown>,
			async (args: Record<string, unknown>) => {
				try {
					const result = await tool.execute(`webmcp-${tool.name}-${Date.now()}`, args);
					return { content: result.content };
				} catch (error) {
					return errorResult(error);
				}
			}
		);
	}

	mcp.registerPrompt(
		"keating.learn",
		"Use Keating's Socratic teaching tools to learn a topic in the current browser session.",
		[
			{ name: "topic", description: "Topic to learn with Keating", required: true },
		],
		(args: Record<string, unknown>) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Use the WebMCP tools exposed by Keating to learn "${String(args.topic ?? "")}". Start with keating.plan, keating.verify, and keating.map, then teach back the concept with retrieval practice.`,
				},
			}],
		})
	);

	mcp.registerResource(
		"keating.page",
		"Current Keating page content visible to the browser.",
		{ uri: "keating://page", mimeType: "text/html" },
		(uri: string) => ({
			contents: [{ uri, mimeType: "text/html", text: document.body.innerHTML }],
		})
	);

	mcp.registerResource(
		"keating.learner-state",
		"Keating learner profile, sessions, and feedback stored in this browser.",
		{ uri: "keating://learner-state", mimeType: "application/json" },
		async (uri: string) => ({
			contents: [{ uri, mimeType: "application/json", text: JSON.stringify(await storage.getLearnerState(), null, 2) }],
		})
	);

	mcp.registerResource(
		"keating.artifacts",
		"Keating browser artifacts generated in this session.",
		{ uri: "keating://artifacts", mimeType: "application/json" },
		async (uri: string) => {
			const artifacts = (await storage.listArtifacts()).map((artifact) => ({
				...artifact,
				uri: artifactUri(artifact.type, artifact.id),
			}));
			return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(artifacts, null, 2) }] };
		}
	);

	mcp.registerResource(
		"keating.artifact",
		"Read a single Keating artifact by URI.",
		{ uriTemplate: "keating-artifact://{type}/{id}", mimeType: "text/plain" },
		async (uri: string) => {
			const parsed = new URL(uri);
			const type = decodeURIComponent(parsed.hostname);
			const id = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
			const artifact = await readArtifact(storage, type, id);
			return { contents: [{ uri, mimeType: artifact.mimeType, text: artifact.text }] };
		}
	);

	if (!window.__keatingWebMcpRegistered) {
		window.__keatingWebMcpRegistered = true;
		window.dispatchEvent(new CustomEvent("keating:webmcp-ready"));
	}
}
