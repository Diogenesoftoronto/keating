/**
 * Switching the chat model of the live conversation. Refused mid-reply; the
 * conversation is rebuilt on the new model with its history, and Not Organic
 * models surface account setup when it is still needed.
 */
import type { PostHog } from "posthog-js";
import type { Api, Model } from "@earendil-works/pi-ai";
import { hasNotOrganicProductSession, promptNotOrganicAccess } from "../../components/NotOrganicAccessPromptDialog";
import { addRecentModel } from "../../keating/model-prefs";
import { modelKey } from "../../lib/model-catalog";
import { isNotOrganicProvider, notOrganicModelNeedsConsent } from "../../notorganic-provider";
import { pauseLearnerDelivery } from "../../components/chat/learner-delivery";
import { loadBrowserModel } from "./browser-model";
import type { AgentHostRefs } from "./host-refs";
import type { CreateAgent } from "./useAgentSessionLifecycle";

export async function changeChatModel({
  refs,
  model,
  posthog,
  selectModel,
  createAgent,
}: {
  refs: AgentHostRefs;
  model: Model<Api>;
  posthog: Pick<PostHog, "capture">;
  selectModel: (model: Model<Api>) => void;
  createAgent: CreateAgent;
}): Promise<void> {
  const prevModel = refs.selectedModelRef.current;
  const activeAgent = refs.agentRef.current;
  if (activeAgent?.context.isStreaming) {
    posthog.capture("model_change_blocked", {
      reason: "active_turn",
      from_model: `${prevModel.provider}/${prevModel.id}`,
      to_model: `${model.provider}/${model.id}`,
      session_id: refs.sessionIdRef.current,
    });
    return;
  }
  const request = refs.sessionSwitchRequestsRef.current.current;
  if (model.provider === "browser") await loadBrowserModel(model.id);
  if (!refs.sessionSwitchRequestsRef.current.isCurrent(request) || refs.agentRef.current !== activeAgent) return;
  refs.explicitModelSelectionRef.current = true;
  selectModel(model);
  addRecentModel(modelKey(model));
  posthog.capture("model_changed", {
    model: `${model.provider}/${model.id}`,
    provider: model.provider,
    from_model: `${prevModel.provider}/${prevModel.id}`,
    to_model: `${model.provider}/${model.id}`,
    from_provider: prevModel.provider,
    to_provider: model.provider,
    during_turn: false,
    session_id: refs.sessionIdRef.current,
  });
  const panel = refs.panelRef.current;
  if (activeAgent && panel) {
    const current = activeAgent.context;
    // The conversation is replaced for the same session; hold queued learner
    // submissions so none starts in the conversation being disposed.
    const release = pauseLearnerDelivery(refs.sessionIdRef.current);
    try {
      await createAgent(panel, {
        ...current,
        model,
        messages: [...current.messages],
      }, { preserveSelectedModel: true });
    } finally {
      release();
    }
  }
  const needsModelConsent = notOrganicModelNeedsConsent(model);
  if (isNotOrganicProvider(model.provider) && (needsModelConsent || !(await hasNotOrganicProductSession()))
    && isNotOrganicProvider(refs.selectedModelRef.current.provider)) {
    // Keep the chosen model. Account setup should be visible, with sending
    // still gated by onApiKeyRequired if the learner dismisses the popup.
    void promptNotOrganicAccess({ allowSignIn: true, reconnect: needsModelConsent });
  }
}
