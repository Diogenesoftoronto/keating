/**
 * The browser teacher's system prompt: persona/base prompt plus learner
 * context, OpenUI instructions, session-start context, workspace capabilities
 * and course collaboration.
 */
import type { DeclaredLearnerProfile } from "@keating/learner-contracts";
import {
  appendCourseCollaborationPrompt,
  buildKeatingSystemPrompt,
  type KeatingToolsOptions,
} from "../../keating/browser-tools";
import type { KeatingAgentRuntimeConfig } from "../../keating/agent-runtime";
import { appendWorkspaceCapabilityPrompt } from "../../keating/capabilities";
import { keatingOpenUIPrompt } from "../../keating/openui/library";
import { loadDeclaredProfile } from "../../keating/learner-profile-store";
import { composeSessionStartSystemPrompt } from "../../keating/session-start-hooks";

export function buildAgentSystemPrompt(
  speechEnabled: boolean,
  basePrompt: string,
  learnerContext: string,
  sessionStartContext = "",
  agentRuntime?: KeatingAgentRuntimeConfig,
  course?: KeatingToolsOptions["course"],
  declaredProfile: DeclaredLearnerProfile = loadDeclaredProfile(),
): string {
  const prompt = buildKeatingSystemPrompt(
    speechEnabled,
    basePrompt,
    learnerContext,
    declaredProfile,
  );
  const promptWithOpenUi = basePrompt.includes(keatingOpenUIPrompt)
    ? prompt
    : `${prompt}\n\n${keatingOpenUIPrompt}`;
  const promptWithSessionContext = composeSessionStartSystemPrompt(
    promptWithOpenUi,
    sessionStartContext,
  );
  const promptWithWorkspace = appendWorkspaceCapabilityPrompt(
    promptWithSessionContext,
    { runtime: agentRuntime },
  );
  return appendCourseCollaborationPrompt(promptWithWorkspace, course);
}
