import type { Agent, ThinkingLevel } from "@mariozechner/pi-agent-core";

export interface ChatPanelSetupCallbacks {
	onApiKeyRequired?: (provider: string) => Promise<boolean>;
	onAuthError?: (provider: string) => Promise<boolean>;
	onBeforeSend?: () => void | Promise<void>;
	onCostClick?: () => void;
	onModelSelect?: () => void;
	onFork?: () => void | Promise<void>;
	thinkingLevel?: ThinkingLevel;
	onThinkingLevelChange?: (level: ThinkingLevel) => void;
}

export interface ChatPanelHandle {
	setAgent(agent: Agent, config?: ChatPanelSetupCallbacks): Promise<void>;
}

