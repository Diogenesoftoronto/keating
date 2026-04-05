import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
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
	ProvidersModelsTab,
} from "@mariozechner/pi-web-ui";
import { html, render } from "lit";
import { Settings } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";

// Import custom components
import "./components/model-selector";
import "./components/settings";

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

// Local model configuration
const LOCAL_MODEL_ID = "unsloth/gemma-4-E4B-it-GGUF";
const LOCAL_MODEL_FILE = "gemma-4-E4B-it-UD-Q4_K_XL.gguf";

// Keating system prompt
const KEATING_SYSTEM_PROMPT = `You are Keating, a hyperteacher designed for cognitive empowerment.

Your purpose is NOT to provide answers, but to ensure humans remain the authors of their own understanding.

Core principles:
1. **Diagnosis First**: Before teaching, understand what the learner already knows and where their gaps lie.
2. **Reconstruction Over Regurgitation**: Make learners reconstruct ideas from memory, not merely agree with explanations.
3. **Transfer Testing**: Ask learners to carry ideas into new settings to prove genuine understanding.
4. **Voice Preservation**: Penalize rote echoing. Reward novel analogies and personal articulation.
5. **Socratic Patience**: Guide with questions, not lectures. Let insights emerge from the learner.

*"That you are here—that life exists and identity, that the powerful play goes on, and you may contribute a verse."*

Your role is to ensure every learner is equipped to contribute their own verse.`;

let currentSessionId: string | undefined;
let currentTitle = "Keating";
let isEditingTitle = false;
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;
let useLocalModel = false;

// ============================================================================
// RENDER
// ============================================================================
const renderApp = () => {
	const app = document.getElementById("app");
	if (!app) return;

	const appHtml = html`
		<div class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border shrink-0">
				<div class="flex items-center gap-2 px-4 py-3">
					<span class="text-lg font-semibold">${currentTitle}</span>
				</div>
				<div class="flex items-center gap-1 px-2">
					<theme-toggle></theme-toggle>
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Settings, "sm"),
						onClick: () => SettingsDialog.open([new ProvidersModelsTab(), new ProxyTab()]),
						title: "Settings",
					})}
				</div>
			</div>

			<!-- Chat Panel -->
			${chatPanel}
		</div>
	`;

	render(appHtml, app);
};

// ============================================================================
// AGENT
// ============================================================================
const createAgent = async (initialState?: Partial<AgentState>) => {
	if (agentUnsubscribe) {
		agentUnsubscribe();
	}

	const defaultModel = useLocalModel
		? getModel("local", LOCAL_MODEL_ID)
		: getModel("google", "gemini-2.0-pro");

	agent = new Agent({
		initialState: initialState || {
			systemPrompt: KEATING_SYSTEM_PROMPT,
			model: defaultModel,
			thinkingLevel: "medium",
			messages: [],
			tools: [],
		},
		convertToLlm: defaultConvertToLlm,
	});

	agentUnsubscribe = agent.subscribe((event: any) => {
		if (event.type === "state-update") {
			renderApp();
		}
	});

	await chatPanel.setAgent(agent, {
		onApiKeyRequired: async (provider: string) => {
			return await ApiKeyPromptDialog.prompt(provider);
		},
	});
};

// ============================================================================
// INIT
// ============================================================================
async function initApp() {
	const app = document.getElementById("app");
	if (!app) throw new Error("App container not found");

	// Show loading
	render(
		html`
			<div class="w-full h-screen flex items-center justify-center bg-background text-foreground">
				<div class="text-muted-foreground">Loading Keating...</div>
			</div>
		`,
		app,
	);

	// Check for local model support
	useLocalModel = await checkLocalModelCapability();

	// Create ChatPanel
	chatPanel = new ChatPanel();

	// Create agent
	await createAgent();

	renderApp();
}

async function checkLocalModelCapability(): Promise<boolean> {
	if (!navigator.gpu) {
		console.log("WebGPU not available, local model disabled");
		return false;
	}

	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			console.log("No WebGPU adapter found");
			return false;
		}
		console.log("WebGPU available, local model possible");
		return true;
	} catch (e) {
		console.log("WebGPU check failed:", e);
		return false;
	}
}

// Start app
initApp();
