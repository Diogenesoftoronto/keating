import type { FlueConversation } from "../keating/flue/conversation";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PendingLearnerResponse } from "../keating/event-store";

export interface ChatPanelSetupCallbacks {
	/** Durable session/fork identity used to scope rendered interaction state. */
	sessionId?: string;
	onApiKeyRequired?: (provider: string) => Promise<boolean>;
	onAuthError?: (provider: string) => Promise<boolean>;
	onBeforeSend?: () => void | Promise<void>;
	onCostClick?: () => void;
	onModelSelect?: () => void;
	onImageGenerationModelSelect?: () => void;
	onFork?: (forkPoint?: number) => void | Promise<void>;
	onRetry?: () => void | Promise<void>;
	onLocalMessagesChanged?: () => void | Promise<void>;
	getPendingLearnerResponses?: () => PendingLearnerResponse[];
	onLearnerResponseDelivered?: (response: PendingLearnerResponse) => void;
	thinkingLevel?: ThinkingLevel;
	onThinkingLevelChange?: (level: ThinkingLevel) => void;
}

export interface ChatPanelHandle {
	setConversation(conversation: FlueConversation, config?: ChatPanelSetupCallbacks): Promise<void>;
}
