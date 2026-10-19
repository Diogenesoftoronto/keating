/**
 * Mutable identity shared by the browser teacher's hooks.
 *
 * Every asynchronous step in the agent lifecycle compares against these refs
 * rather than captured values: a stale step (an earlier session, a detached
 * panel, a superseded switch request) checks `agentRef`, `sessionIdRef`,
 * `panelRef` and `sessionSwitchRequests` and stops. They are created once per
 * mounted `useKeatingAgent` and passed by reference to the extracted hooks.
 */
import { useRef, type MutableRefObject } from "react";
import type { Model, Api } from "@earendil-works/pi-ai";
import type { FlueConversation } from "../../keating/flue/conversation";
import type { KeatingAgentRuntimeConfig } from "../../keating/agent-runtime";
import type { KeatingToolsOptions } from "../../keating/browser-tools";
import { AuthorizedToolExecutor } from "../../keating/security";
import {
  ArizeTraceClient,
  publishArizeTraceStatus,
  type ArizePublicConfig,
} from "../../lib/arize-observability";
import {
  readAnalyticsPreferences,
  writeAnalyticsPreferences,
} from "../../lib/analytics-preferences";
import { isSessionReplayAvailable } from "../../lib/posthog";
import type { ChatPanelHandle } from "../../types/chat-panel";
import { DEFAULT_MODEL } from "../keating-stream";
import { createSessionId } from "../session-metadata";
import { SessionSwitchRequests } from "../session-switch";

/** Session-start context is computed once per session, then folded into the prompt. */
export interface SessionStartRecord {
  sessionId: string;
  context: string;
  promise: Promise<string> | null;
}

export interface AgentHostRefs {
  agentRef: MutableRefObject<FlueConversation | null>;
  panelRef: MutableRefObject<ChatPanelHandle | null>;
  /** Issued at each navigation click; only the latest may commit. */
  sessionSwitchRequestsRef: MutableRefObject<SessionSwitchRequests>;
  sessionIdRef: MutableRefObject<string>;
  sessionCreatedAtRef: MutableRefObject<string>;
  sessionParentIdRef: MutableRefObject<string | null>;
  sessionForkedAtRef: MutableRefObject<string | undefined>;
  toolExecutorRef: MutableRefObject<AuthorizedToolExecutor>;
  /** Set when the current turn used untrusted web search results. */
  untrustedSearchProvenanceRef: MutableRefObject<boolean>;
  selectedModelRef: MutableRefObject<Model<Api>>;
  explicitModelSelectionRef: MutableRefObject<boolean>;
  courseContextRef: MutableRefObject<KeatingToolsOptions["course"]>;
  speechEnabledRef: MutableRefObject<boolean>;
  systemPromptBaseRef: MutableRefObject<string>;
  agentRuntimeRef: MutableRefObject<KeatingAgentRuntimeConfig | undefined>;
  sessionStartContextRef: MutableRefObject<SessionStartRecord>;
  ensureSessionStartContextRef: MutableRefObject<() => Promise<void>>;
  analyticsTurnIndexRef: MutableRefObject<number>;
  imageModelRetryRef: MutableRefObject<null | (() => Promise<void>)>;
  arizeConfigRef: MutableRefObject<ArizePublicConfig>;
  arizeTraceClientRef: MutableRefObject<ArizeTraceClient | null>;
}

export function useAgentHostRefs(
  courseContext: KeatingToolsOptions["course"],
  speechEnabled: boolean,
): AgentHostRefs {
  const refs: AgentHostRefs = {
    agentRef: useRef<FlueConversation | null>(null),
    panelRef: useRef<ChatPanelHandle | null>(null),
    sessionSwitchRequestsRef: useRef(new SessionSwitchRequests()),
    sessionIdRef: useRef<string>(createSessionId()),
    sessionCreatedAtRef: useRef(new Date().toISOString()),
    sessionParentIdRef: useRef<string | null>(null),
    sessionForkedAtRef: useRef<string | undefined>(undefined),
    toolExecutorRef: useRef(new AuthorizedToolExecutor()),
    untrustedSearchProvenanceRef: useRef(false),
    selectedModelRef: useRef<Model<Api>>(DEFAULT_MODEL),
    explicitModelSelectionRef: useRef(false),
    courseContextRef: useRef(courseContext),
    speechEnabledRef: useRef(speechEnabled),
    systemPromptBaseRef: useRef<string>(""),
    agentRuntimeRef: useRef<KeatingAgentRuntimeConfig | undefined>(undefined),
    sessionStartContextRef: useRef<SessionStartRecord>({ sessionId: "", context: "", promise: null }),
    ensureSessionStartContextRef: useRef<() => Promise<void>>(async () => {}),
    analyticsTurnIndexRef: useRef(0),
    imageModelRetryRef: useRef<null | (() => Promise<void>)>(null),
    arizeConfigRef: useRef<ArizePublicConfig>({
      enabled: false,
      reason: "loading",
      evaluationContentEnabled: false,
      maxContentChars: 16_000,
      rateLimitPerMinute: 30,
    }),
    arizeTraceClientRef: useRef<ArizeTraceClient | null>(null),
  };
  refs.courseContextRef.current = courseContext;
  refs.speechEnabledRef.current = speechEnabled;
  if (!refs.arizeTraceClientRef.current && typeof window !== "undefined") {
    refs.arizeTraceClientRef.current = new ArizeTraceClient(
      fetch,
      publishArizeTraceStatus,
      () => {
        const current = readAnalyticsPreferences(isSessionReplayAvailable());
        writeAnalyticsPreferences({
          ...current,
          arizeEvaluationEnabled: false,
        });
      },
    );
  }
  return refs;
}
