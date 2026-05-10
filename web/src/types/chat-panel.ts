import type { Agent } from "@mariozechner/pi-agent-core";

export interface ChatPanelSetupCallbacks {
	onApiKeyRequired?: (provider: string) => Promise<boolean>;
	onAuthError?: (provider: string) => Promise<boolean>;
	onBeforeSend?: () => void | Promise<void>;
	onCostClick?: () => void;
	onModelSelect?: () => void;
	onFork?: () => void | Promise<void>;
}

export interface ChatPanelHandle {
	setAgent(agent: Agent, config?: ChatPanelSetupCallbacks): Promise<void>;
}

