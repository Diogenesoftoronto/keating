import type { Agent, ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface ChatPanelSetupCallbacks {
	onApiKeyRequired?: (provider: string) => Promise<boolean>;
	onAuthError?: (provider: string) => Promise<boolean>;
	onBeforeSend?: () => void | Promise<void>;
	onCostClick?: () => void;
	onModelSelect?: () => void;
	onFork?: (forkPoint?: number) => void | Promise<void>;
	onLocalMessagesChanged?: () => void | Promise<void>;
	thinkingLevel?: ThinkingLevel;
	onThinkingLevelChange?: (level: ThinkingLevel) => void;
}

export interface ChatPanelHandle {
	setAgent(agent: Agent, config?: ChatPanelSetupCallbacks): Promise<void>;
}
