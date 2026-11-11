import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReviewNoticeCard } from "./ReviewNoticeCard";

const meta = {
  title: "Conversation/ReviewNoticeCard",
  component: ReviewNoticeCard,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ReviewNoticeCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Withheld: Story = {
  args: {
    kind: "withheld",
    reason: "Keating couldn't prepare a valid review request within the judgement model's limits. Try a new conversation or choose a judgement model with a larger context in Settings.",
  },
};

export const Unverified: Story = {
  args: {
    kind: "unverified",
    children: <p>Ohm's law says the current through a resistor is the voltage across it divided by its resistance.</p>,
  },
};
