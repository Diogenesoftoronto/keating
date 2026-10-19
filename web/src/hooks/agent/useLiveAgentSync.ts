/**
 * Keeps the live conversation in step with settings that change while it
 * runs: speech/tool capability changes re-author its tools, persona, learner
 * context and declared profile edits rebuild its system prompt, the realtime
 * voice surface borrows its prompt and tools, and the session debugger can
 * capture its model context on demand.
 */
import { useEffect } from "react";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { KeatingToolsOptions } from "../../keating/browser-tools";
import {
  composeKeatingSystemPrompt,
  createKeatingTools,
  executeRawKeatingTool,
} from "../../keating/browser-tools";
import { loadAgentRuntimeConfig } from "../../keating/agent-runtime";
import { keatingLifecycle } from "../../keating/lifecycle";
import { loadLearnerContext, subscribeLearnerContext } from "../../keating/learner-context";
import { subscribeDeclaredProfile } from "../../keating/learner-profile-store";
import { buildLiveSessionContext } from "../../keating/live-context";
import { buildLiveHistory } from "../../keating/live-history";
import { subscribePersona } from "../../keating/persona";
import { appendKeatingPortableCatalog, authorKeatingBrowserAgent } from "../../keating/portable-agent";
import type { LiveSpeechBridge, WebSpeechSettings } from "../../keating/speech";
import { registerKeatingWebMcp } from "../../keating/webmcp";
import { captureSessionModelContext, subscribeLifecycleDebug } from "../../lib/session-debug";
import { keatingStorage } from "../keating-storage";
import { availableToolsFor, type ToolOptionsFactory } from "./agent-tools";
import type { AgentHostRefs } from "./host-refs";
import { runPortableBrowserDelegate } from "./portable-delegate";
import { buildAgentSystemPrompt } from "./system-prompt";

/** The realtime voice bridge: the text teacher's prompt, history and tools. */
function liveSpeechBridge(refs: AgentHostRefs): LiveSpeechBridge | null {
  const agent = refs.agentRef.current;
  if (!agent) return null;
  const tools = (agent.context.tools ?? []) as any[];
  return {
    // The real Keating system prompt, so a voice session is the same
    // teacher as the text session rather than a generic assistant.
    instructions: agent.context.systemPrompt,
    history: buildLiveHistory(agent.context.messages ?? []),
    loadContext: () => buildLiveSessionContext({
      storage: keatingStorage,
      sessionId: refs.sessionIdRef.current,
      messages: agent.context.messages ?? [],
      providedProfile: loadLearnerContext(),
      activeCourseId: refs.courseContextRef.current?.activeCourseId,
    }),
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.label ?? tool.name,
      parameters: tool.parameters ?? { type: "object", properties: {} },
    })),
    async execute(call, signal) {
      const tool = tools.find((candidate) => candidate.name === call.name);
      if (!tool?.execute)
        throw new Error(`Unknown live voice tool: ${call.name}`);
      return refs.toolExecutorRef.current.execute({
        toolName: call.name,
        arguments: call.arguments,
        context: {
          sessionId: refs.sessionIdRef.current,
          surface: "voice",
          provenance: refs.untrustedSearchProvenanceRef.current
            ? { trust: "untrusted-web", userAuthorized: false }
            : { trust: "unknown", userAuthorized: false },
        },
        run: () =>
          executeRawKeatingTool(tool, [
            call.callId,
            call.arguments,
            signal,
            () => {},
          ]),
      });
    },
  };
}

export function useLiveAgentSync({
  refs,
  speechSettings,
  toolOptions,
  courseContext,
}: {
  refs: AgentHostRefs;
  speechSettings: WebSpeechSettings;
  toolOptions: ToolOptionsFactory;
  courseContext: KeatingToolsOptions["course"];
}): void {
  const { agentRef, systemPromptBaseRef, sessionStartContextRef, agentRuntimeRef } = refs;

  useEffect(() => {
    const agent = agentRef.current;
    if (!agent) return;

    let cancelled = false;
    loadAgentRuntimeConfig()
      .then(async (agentRuntime) => ({
        agentRuntime,
        tools: await createKeatingTools(
          keatingStorage,
          toolOptions(speechSettings, agentRuntime),
        ),
      }))
      .then(async ({ agentRuntime, tools }) => {
        if (cancelled) return;
        agentRuntimeRef.current = agentRuntime;
        const availableTools = await availableToolsFor(
          tools,
          agentRuntime,
          speechSettings.enabled,
          agent.context.model as Model<Api>,
        );
        const systemPrompt = buildAgentSystemPrompt(
          speechSettings.enabled,
          systemPromptBaseRef.current,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
          agentRuntime,
          courseContext,
        );
        const authored = await authorKeatingBrowserAgent({
          instanceId: `browser-teacher-${refs.sessionIdRef.current}-capabilities`,
          modelKey: `${agent.context.model.provider}/${agent.context.model.id}`,
          systemPrompt,
          tools: availableTools,
          hosts: {
            delegate: (request, signal) =>
              runPortableBrowserDelegate(
                request,
                agent.context.model,
                agent.context.thinkingLevel,
                signal,
              ),
            resolveMcpConnection: async () => [],
          },
        });
        if (cancelled || agentRef.current !== agent) return;
        agent.context.tools = [...authored.tools];
        agent.context.systemPrompt = authored.systemPrompt;
        registerKeatingWebMcp(keatingStorage, availableTools).catch(
          console.warn,
        );
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [speechSettings, toolOptions]);

  // Realtime voice has its own WebRTC model connection. Expose the active Flue
  // tool catalog synchronously so voice function calls use the same tools and
  // learner state as typed chat.
  useEffect(() => {
    const handleBridgeRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ bridge?: LiveSpeechBridge }>)
        .detail;
      if (!detail || !agentRef.current) return;
      detail.bridge = liveSpeechBridge(refs)!;
    };
    window.addEventListener("keating:live-speech-bridge", handleBridgeRequest);
    return () =>
      window.removeEventListener(
        "keating:live-speech-bridge",
        handleBridgeRequest,
      );
  }, []);

  useEffect(() => {
    const unsubscribeLifecycle = subscribeLifecycleDebug(keatingLifecycle);
    const captureCurrentContext = () => {
      const agent = agentRef.current;
      if (!agent) return;
      captureSessionModelContext(agent.context.model, {
        systemPrompt: agent.context.systemPrompt,
        messages: agent.context.messages,
        tools: agent.context.tools,
      }, "agent-state");
    };
    window.addEventListener("keating:session-debug-enabled", captureCurrentContext);
    return () => {
      unsubscribeLifecycle();
      window.removeEventListener("keating:session-debug-enabled", captureCurrentContext);
    };
  }, []);

  // Apply teacher-persona edits to the live agent so changes take effect on the
  // next turn without needing a new session.
  useEffect(() => {
    return subscribePersona((persona) => {
      const base = composeKeatingSystemPrompt(persona);
      systemPromptBaseRef.current = base;
      if (agentRef.current) {
        agentRef.current.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
          speechSettings.enabled,
          base,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
          agentRuntimeRef.current,
          courseContext,
        ));
      }
    });
  }, [speechSettings.enabled]);

  useEffect(() => {
    return subscribeLearnerContext((context) => {
      if (agentRef.current) {
        agentRef.current.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
          speechSettings.enabled,
          systemPromptBaseRef.current,
          context,
          sessionStartContextRef.current.context,
          agentRuntimeRef.current,
          courseContext,
        ));
      }
    });
  }, [speechSettings.enabled]);

  // Declared profile edits in Settings reach the live conversation the same way
  // free-text context edits already do.
  useEffect(() => {
    return subscribeDeclaredProfile((profile) => {
      if (agentRef.current) {
        agentRef.current.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
          speechSettings.enabled,
          systemPromptBaseRef.current,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
          agentRuntimeRef.current,
          courseContext,
          profile,
        ));
      }
    });
  }, [speechSettings.enabled]);
}
