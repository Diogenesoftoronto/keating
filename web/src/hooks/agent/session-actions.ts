/**
 * One-off actions on a session: share the active session, and ask the model
 * for a better title.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { promptKeatingApiKey } from "../../components/KeatingApiKeyPromptDialog";
import {
  buildSharedTrajectory,
  saveSharedSession,
  sharedSessionUrl,
  type SharedSessionUrlResult,
} from "../../keating/shared-sessions";
import { loadKeatingUiSettings } from "../../keating/ui-settings";
import { getProviderApiKey } from "../../lib/provider-models";
import type { SessionData } from "../../types/session";
import { sessions } from "../keating-storage";
import { sessionTitle } from "../session-metadata";
import { loadBrowserModel } from "./browser-model";
import type { AgentHostRefs } from "./host-refs";
import { requestSessionTitle } from "./session-title";

/**
 * Saves, then publishes the active session as a share link and copies it.
 * Fails if the learner switches session while the share is prepared.
 */
export async function shareActiveSession(
  refs: Pick<AgentHostRefs, "agentRef" | "sessionIdRef" | "sessionCreatedAtRef">,
  saveSessionSnapshot: (agent: NonNullable<AgentHostRefs["agentRef"]["current"]>) => Promise<void>,
): Promise<SharedSessionUrlResult> {
  const agent = refs.agentRef.current;
  if (!agent) throw new Error("No active session to share");
  const originalSessionId = refs.sessionIdRef.current;
  const originalCreatedAt = refs.sessionCreatedAtRef.current;
  const originalMessages = [...agent.context.messages];
  const originalModel = agent.context.model;
  const originalThinkingLevel = agent.context.thinkingLevel;
  const assertShareSourceIsCurrent = () => {
    if (refs.agentRef.current !== agent || refs.sessionIdRef.current !== originalSessionId) {
      throw new Error("The active session changed while the share was being prepared. Share it again from the session you want.");
    }
  };
  await saveSessionSnapshot(agent);
  assertShareSourceIsCurrent();
  const trajectory = await buildSharedTrajectory(
    originalSessionId,
    originalMessages,
  );
  assertShareSourceIsCurrent();
  const shared = saveSharedSession(
    originalMessages,
    originalCreatedAt,
    {
      model: originalModel,
      thinkingLevel: originalThinkingLevel,
      trajectory,
    },
  );
  const result = await sharedSessionUrl(
    shared,
    window.location.origin,
    loadKeatingUiSettings().shareLinkMode,
  );
  await navigator.clipboard?.writeText(result.url).catch((error) => {
    console.warn("Failed to copy share link:", error);
  });
  return result;
}

/** A model-suggested title for a stored session; prompts for a key if needed. */
export async function suggestSessionTitle(
  sessionId: string,
  fallbackModel: Model<Api>,
): Promise<string> {
  const session = (await sessions.loadSession(
    sessionId,
  )) as SessionData | null;
  if (!session) throw new Error("Session not found");

  const model = session.model ?? fallbackModel;
  if (model.provider === "browser") {
    await loadBrowserModel(model.id);
  } else if (!(await getProviderApiKey(model.provider))) {
    const allowed = await promptKeatingApiKey(model.provider);
    if (!allowed)
      throw new Error(`No API key available for ${model.provider}`);
  }

  const apiKey =
    model.provider === "browser"
      ? undefined
      : await getProviderApiKey(model.provider);
  const title = await requestSessionTitle(model as Model<Api>, apiKey, session.messages, session.title);
  if (!title) return sessionTitle(session.messages);
  return title;
}
