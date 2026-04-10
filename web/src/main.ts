import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple, type Context, type AssistantMessage, createAssistantMessageEventStream, type SimpleStreamOptions, type Model, type Api } from "@mariozechner/pi-ai";
import {
	type AgentState,
	ApiKeyPromptDialog,
	AppStorage,
	ChatPanel,
	CustomProvidersStore,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionsStore,
	SettingsDialog,
	SettingsStore,
	setAppStorage,
	defaultConvertToLlm,
	ProxyTab,
} from "@mariozechner/pi-web-ui";
import { html, render } from "lit";
import { Settings } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";

// Import custom components
import "./components/model-selector";
import "./components/providers-models-tab";
import "./components/settings";
import { KeatingProvidersModelsTab } from "./components/providers-models-tab";
import { KeatingModelSelector } from "./components/model-selector";
import { getProviderApiKey, syncCustomProviderKeys } from "./lib/provider-models";
import { localModel } from "./stores/local-model";
import { createKeatingTools, KEATING_SYSTEM_PROMPT as TOOLS_PROMPT } from "./keating/browser-tools";
import { KeatingStorage } from "./keating/storage";

// Storage setup
const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const backend = new IndexedDBStorageBackend({
	dbName: "keating",
	version: 1,
	stores: [
		settings.getConfig(),
		providerKeys.getConfig(),
		sessions.getConfig(),
		SessionsStore.getMetadataConfig(),
		customProviders.getConfig(),
	],
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
sessions.setBackend(backend);
customProviders.setBackend(backend);

const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

// Keating storage for tools/artifacts
const keatingStorage = new KeatingStorage();

let currentSessionId: string | undefined;
let currentTitle = "Keating";
let isEditingTitle = false;
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;
let selectedModel: Model<Api> | undefined;
let webGpuAvailable: boolean = false;

const BROWSER_MODEL: Model<Api> = {
	id: "gemma-4-e4b",
	name: "Gemma 4 E4B (Browser)",
	api: "browser" as Api,
	provider: "browser",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 0,
	maxTokens: 0,
};

const DEFAULT_MODEL = getModel("google", "gemini-3.1-pro-preview");

const createInitialModel = (): Model<Api> => selectedModel ?? DEFAULT_MODEL;

// ============================================================================
// BROWSER MODEL STREAM FUNCTION
// ============================================================================
const createBrowserStreamFn = () => {
	return async (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const abortSignal = options?.signal;

		// Default assistant message fields for browser model
		const defaultFields = {
			api: "browser" as const,
			provider: "browser" as const,
			model: "gemma-4-e4b",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		};

		// Don't block - run generation asynchronously
		(async () => {
			try {
				if (abortSignal?.aborted) {
					stream.end({
						...defaultFields,
						role: "assistant",
						content: [],
						stopReason: "aborted",
						errorMessage: "Request aborted",
						timestamp: Date.now(),
					} as AssistantMessage);
					return;
				}

				// Extract user messages and format for local model
				const userMessages = context.messages
					.filter((m): m is Extract<typeof m, { role: "user" }> => m.role === "user")
					.map(m => {
						const content = m.content;
						if (typeof content === "string") return content;
						return content.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text").map(c => c.text).join("\n");
					});

				// Build prompt with system and messages
				const systemPrompt = context.systemPrompt || "";
				const conversationHistory = userMessages.join("\n\n");
				const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${conversationHistory}` : conversationHistory;

				// Create partial assistant message for streaming
				const partialMessage: AssistantMessage = {
					...defaultFields,
					role: "assistant",
					content: [{ type: "text", text: "" }],
					stopReason: "stop",
					timestamp: Date.now(),
				};

				stream.push({ type: "start", partial: partialMessage });

				// Generate with local model
				const response = await localModel.generate(fullPrompt, {
					max_length: options?.maxTokens ?? 1024,
					temperature: options?.temperature ?? 0.7,
				}, (token: string) => {
					// Stream tokens as they arrive
					const textBlock = partialMessage.content[0];
					if (textBlock.type === "text") {
						textBlock.text = textBlock.text + token;
					}
					stream.push({ type: "text_start", contentIndex: 0, partial: partialMessage });
				});

				if (abortSignal?.aborted) {
					stream.end({
						...defaultFields,
						role: "assistant",
						content: [{ type: "text", text: response }],
						stopReason: "aborted",
						errorMessage: "Request aborted",
						timestamp: Date.now(),
					} as AssistantMessage);
					return;
				}

				// Final message
				stream.end({
					...defaultFields,
					role: "assistant",
					content: [{ type: "text", text: response }],
					stopReason: "stop",
					timestamp: Date.now(),
				} as AssistantMessage);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				stream.end({
					...defaultFields,
					role: "assistant",
					content: [],
					stopReason: "error",
					errorMessage,
					timestamp: Date.now(),
				} as AssistantMessage);
			}
		})();

		return stream;
	};
};

// ============================================================================
// HYBRID STREAM FUNCTION
// ============================================================================
const hybridStreamFn = async (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
	if (model.provider === "browser") {
		const browserStream = createBrowserStreamFn();
		return browserStream(model, context, options);
	}
	return streamSimple(model, context, options);
};

// ============================================================================
// RENDER
// ============================================================================
const renderApp = () => {
	const headerEl = document.getElementById("header");
	if (headerEl) {
		// Render header only once
		const headerHtml = html`
			<div class="flex items-center justify-between border-b border-border shrink-0 h-full">
				<div class="flex items-center gap-2 px-4 py-3">
					<span class="text-lg font-semibold">${currentTitle}</span>
				</div>
				<div class="flex items-center gap-1 px-2">
					<theme-toggle></theme-toggle>
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Settings, "sm"),
						onClick: () => SettingsDialog.open([new KeatingProvidersModelsTab(), new ProxyTab()]),
						title: "Settings",
					})}
				</div>
			</div>
		`;
		render(headerHtml, headerEl);
	}

	// Append chatPanel to its container (only once)
	const chatContainer = document.getElementById("chat-container");
	if (chatContainer && !chatPanel.parentElement) {
		chatContainer.appendChild(chatPanel);
	}
};

const loadBrowserModel = async () => {
	const state = localModel.getState();
	if (!state.loaded && !state.loading) {
		await localModel.load();
	}

	if (!localModel.getState().loaded) {
		throw new Error(localModel.getState().error || "Failed to load browser model");
	}
};

const switchModel = async (model: Model<Api>) => {
	if (model.provider === "browser") {
		await loadBrowserModel();
	}

	selectedModel = model;

	const currentState = agent?.state;
	await createAgent(
		currentState
			? {
					...currentState,
					model,
					messages: [...currentState.messages],
				}
			: { model },
	);
};

// ============================================================================
// AGENT
// ============================================================================
const createAgent = async (initialState?: Partial<AgentState>) => {
	const tools = await createKeatingTools(keatingStorage);
	
	const nextInitialState: Partial<AgentState> = {
		systemPrompt: TOOLS_PROMPT,
		model: initialState?.model ?? createInitialModel(),
		thinkingLevel: "medium",
		messages: [],
		tools,
		...initialState,
	};

	agent = new Agent({
		initialState: nextInitialState,
		convertToLlm: defaultConvertToLlm,
		streamFn: hybridStreamFn,
	});
	agent.getApiKey = async (provider: string) => await getProviderApiKey(provider);

	agentUnsubscribe = agent.subscribe((event: any) => {
		if (event.type === "state-update") {
			renderApp();
		}
	});

	await chatPanel.setAgent(agent, {
		onApiKeyRequired: async (provider: string) => {
			if (provider === "browser") return true;
			if (await getProviderApiKey(provider)) return true;
			return await ApiKeyPromptDialog.prompt(provider);
		},
		onModelSelect: () => {
			void KeatingModelSelector.open(agent.state.model as Model<Api>, async (model) => {
				await switchModel(model);
			});
		},
	});
};

// ============================================================================
// INIT
// ============================================================================
async function initApp() {
	const app = document.getElementById("app");
	const header = document.getElementById("header");
	if (!app || !header) throw new Error("App containers not found");

	// Check for browser model capability (WebGPU)
	webGpuAvailable = await checkBrowserModelCapability();
	await syncCustomProviderKeys();
	
	// Initialize Keating storage
	await keatingStorage.init();
	
	selectedModel = DEFAULT_MODEL;

	// Create ChatPanel
	chatPanel = new ChatPanel();

	// Create agent
	await createAgent();

	renderApp();
}

async function checkBrowserModelCapability(): Promise<boolean> {
	if (!navigator.gpu) {
		console.log("WebGPU not available, browser model disabled");
		return false;
	}

	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			console.log("No WebGPU adapter found");
			return false;
		}
		console.log("WebGPU available, browser model possible");
		return true;
	} catch (e) {
		console.log("WebGPU check failed:", e);
		return false;
	}
}

// Start app - only if not imported as module
if (typeof window !== "undefined") {
	initApp();
}

export { initApp };
