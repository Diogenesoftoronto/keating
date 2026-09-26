import type { Meta, StoryObj } from "@storybook/react-vite";
import { measureStateComposition, type TeachingDraftSnapshot, type TeachingPolicyTurn } from "@keating/learner-contracts";
import { DraftReviewStatus } from "./DraftReviewStatus";
import { css } from "../../styled-system/css";

// Deliberate private markers verify that only projected numeric sizes reach the UI.
const turn: TeachingPolicyTurn = { learnerMessage: "PRIVATE_REQUEST", conversation: [{ role: "user", content: "PRIVATE_HISTORY" }], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general",
  activeWork: { plan: { documentId: "private-plan", title: "PRIVATE_PLAN", revision: 1, outline: [] }, focus: null, openInteractions: [], truncated: false },
};
const request = { state: { turn, reply: { text: "PRIVATE_REPLY", toolCalls: [] } }, questions: { check: { type: "noul" as const, instructions: "Is the claim supported?" } } };
const state = measureStateComposition(request, 2000);
const before = measureStateComposition({ ...request, state: { ...request.state, turn: { ...turn, conversation: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: "PRIVATE_EVICTED ".repeat(50) })) } } }, 2000);
const snapshot: TeachingDraftSnapshot = { phase: "checking", attempt: 1, maxAttempts: 3, reasoning: "low", standard: "concise", elapsedMs: 1500, attempts: [], judgeModel: "fixture-v1", selectedAttempt: null, reason: null, state,
  slides: [{ phase: "planning", attempt: 0, elapsedMs: 5, turnsDropped: 6, before, after: state }],
  stateHistory: [{ phase: "planning", attempt: 0, elapsedMs: 10, requestIndex: 1, state: measureStateComposition({ ...request, state: { turn } }, 2000) }, { phase: "checking", attempt: 1, elapsedMs: 1400, requestIndex: 2, state }],
};
const meta = { title: "Teaching/Response review", component: DraftReviewStatus, args: { sessionId: "review-story", status: { id: 1, feedback: null, snapshot } },
  decorators: [Story => <div className={css({ padding: "1rem", maxWidth: "56rem", marginInline: "auto", color: "var(--foreground)", background: "var(--background)" })}><Story /></div>],
} satisfies Meta<typeof DraftReviewStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Checking: Story = {};
export const Released: Story = { args: { status: { id: 1, feedback: null, snapshot: { ...snapshot, phase: "released", selectedAttempt: 1, attempts: [{ attempt: 1, reasoning: "low", standard: "concise", generationMs: 800, judgementMs: 600, status: "pass", checks: [], variant: "default" }] } } } };
export const UnknownBudget: Story = { args: { status: { id: 1, feedback: null, snapshot: { ...snapshot, state: { ...state, budgetTokens: null, fillRatio: null } } } } };
