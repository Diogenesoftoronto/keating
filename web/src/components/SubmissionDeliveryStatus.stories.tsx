import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubmissionDeliveryStatus } from "./SubmissionDeliveryStatus";

const meta = {
  title: "Learning/Submission delivery",
  component: SubmissionDeliveryStatus,
  parameters: { layout: "centered" },
} satisfies Meta<typeof SubmissionDeliveryStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SavedOnDevice: Story = { args: { state: "local" } };
export const WaitingForConnection: Story = { args: { state: "pending" } };
export const DeliveredToCourse: Story = { args: { state: "delivered" } };
export const RetryDelivery: Story = {
  args: { state: "pending" },
  render: () => <RetryExample />,
};
function RetryExample() {
  const [delivered, setDelivered] = useState(false);
  return <div>
    <p>Simulated delivery. Your saved answer and files remain available throughout.</p>
    <SubmissionDeliveryStatus state={delivered ? "delivered" : "pending"}
      error="The connection dropped. Your work is safe on this device."
      onRetry={() => setDelivered(true)} />
  </div>;
}
export const CourseCopyChanged: Story = {
  args: { state: "pending", error: "The course copy changed on another device. Your work remains saved here; review the course copy before retrying." },
};
