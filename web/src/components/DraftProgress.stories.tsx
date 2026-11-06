import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
import { DraftProgressCard } from "./DraftProgress";
import { css } from "../../styled-system/css";

const snapshot: TeachingDraftSnapshot = { phase: "drafting", attempt: 1, maxAttempts: 3, reasoning: "low", standard: "supported", elapsedMs: 6_000, attempts: [], judgeModel: "fixture-v1", selectedAttempt: null, reason: null };
const meta = { title: "Teaching/Reply progress (learner)", component: DraftProgressCard, args: { status: { id: 1, feedback: null, snapshot } },
  decorators: [Story => <div className={css({ padding: "1.5rem", color: "var(--foreground)", background: "var(--background)" })}><Story /></div>],
} satisfies Meta<typeof DraftProgressCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Writing: Story = {};
export const Checking: Story = { args: { status: { id: 2, feedback: null, snapshot: { ...snapshot, phase: "checking", elapsedMs: 18_000 } } } };
export const Improving: Story = { args: { status: { id: 3, feedback: null, snapshot: { ...snapshot, phase: "revising", attempt: 2, elapsedMs: 44_000 } } } };
export const NearLimit: Story = { args: { status: { id: 4, feedback: null, snapshot: { ...snapshot, phase: "checking", attempt: 3, elapsedMs: 76_000 } } } };
