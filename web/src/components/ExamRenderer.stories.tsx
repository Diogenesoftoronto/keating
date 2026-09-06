import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { ExamRenderer, type ExamRendererProps } from "./ExamRenderer";
import { EXAM_FIXTURE_NODE as node } from "./exam/fixtures";
import type { UiActionReceipt } from "@keating/learner-contracts";

const savedReceipt: UiActionReceipt = {
  schemaVersion: 1,
  state: "completed",
  actionFingerprint: "exam-story",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  action: {
    schemaVersion: 1,
    type: "complete-quiz",
    documentId: "exam-story",
    documentRevision: 0,
    nodeId: node.id,
    resultId: `${node.id}-result`,
    idempotencyKey: "exam-result",
    answers: [
      { questionId: "exam-ttl", answer: node.questions[0]!.correctAnswer! },
      { questionId: "exam-explain", answer: "For a live train departure board." },
      { questionId: "exam-fresh", answer: node.questions[2]!.correctAnswer! },
    ],
    score: 2,
    partialCreditPoints: 2,
    partialCredits: { "exam-ttl": 1, "exam-fresh": 1 },
    timing: {
      totalMs: 72_431,
      perQuestionMs: { "exam-ttl": 4_238, "exam-explain": 54_124, "exam-fresh": 7_501 },
    },
    pendingGradeQuestionIds: ["exam-explain"],
    skippedQuestionIds: node.questions.slice(3).map((question) => question.id),
    timedOutQuestionIds: [],
    flaggedQuestionIds: ["exam-explain"],
    examTimedOut: false,
  },
};
const meta = {
  title: "Learning/Exam",
  component: ExamRenderer,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: "min(42rem, 100%)", margin: "1rem auto" }}>
        <Story />
      </div>
    ),
  ],
  args: { node, disabled: false, onAction: fn(() => true) },
} satisfies Meta<typeof ExamRenderer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const InProgress: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Start exam" }),
    );
  },
};
export const QuestionNavigator: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Start exam" }));
    await expect(canvas.queryByRole("navigation", { name: "Exam questions" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Show question navigator" }));
    const navigator = within(canvas.getByRole("navigation", { name: "Exam questions" }));
    await expect(navigator.getAllByRole("button")).toHaveLength(20);
    await userEvent.click(navigator.getByRole("button", { name: "Question 20, unanswered" }));
    await expect(canvas.getByRole("heading", { name: "Question 20 of 20" })).toBeVisible();
    await expect(canvas.queryByRole("navigation", { name: "Exam questions" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Flag" }));
    await userEvent.click(canvas.getByRole("button", { name: "Show question navigator" }));
    await expect(canvas.getByRole("button", { name: "Question 20, unanswered, flagged" })).toHaveAttribute("aria-current", "step");
  },
};
export const Completed: Story = { args: { receipt: savedReceipt } };
export const ReviewAndSubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Start exam" }));
    await userEvent.click(
      canvas.getByRole("radio", { name: "Its time to live" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Next" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Your answer" }),
      "For a live train departure board.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Flag" }));
    await userEvent.click(canvas.getByRole("button", { name: "Next" }));
    await userEvent.click(canvas.getByRole("radio", { name: "False" }));
    await userEvent.click(canvas.getByRole("button", { name: "Review all answers" }));
    await expect(
      canvas.getByRole("heading", { name: "Ready to submit?" }),
    ).toBeVisible();
    await expect(args.onAction).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Submit exam" }));
    await expect(canvas.getByText("Exam submitted")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: node.title })).toHaveFocus();
    await expect(canvas.getByText("1 awaiting grading")).toBeVisible();
    await expect(args.onAction).toHaveBeenCalledOnce();
  },
};
export const TimeLimit: Story = {
  args: { node: { ...node, examTimeLimit: 2 } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Start exam" }));
    await waitFor(
      () =>
        expect(
          canvas.getByRole("heading", { name: "Time is up" }),
        ).toBeVisible(),
      { timeout: 4_000 },
    );
    await userEvent.click(canvas.getByRole("button", { name: "Show question navigator" }));
    await expect(
      canvas.getByRole("button", { name: "Question 1, unanswered" }),
    ).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Submit exam" }));
    await expect(args.onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          examTimedOut: true,
          timing: { totalMs: 2_000, perQuestionMs: { "exam-ttl": 2_000 } },
        }),
      }),
    );
  },
};
export const SaveRecovery: Story = {
  args: { onAction: fn() },
  render: (args) => <SaveRecoveryExam {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Start exam" }));
    await userEvent.click(
      canvas.getByRole("radio", { name: "Its time to live" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Review all answers" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Submit exam" }));
    await userEvent.click(canvas.getByRole("button", { name: "Show question navigator" }));
    await expect(
      canvas.getByRole("button", { name: "Question 1, answered" }),
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Retry save exam" }),
    );
    await expect(canvas.getByText("Exam submitted")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: node.title })).toHaveFocus();
    await expect(args.onAction).toHaveBeenCalledTimes(2);
    const calls = (args.onAction as ReturnType<typeof fn>).mock.calls;
    expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
  },
};

function SaveRecoveryExam(args: ExamRendererProps) {
  const attempts = useRef(0);
  return (
    <ExamRenderer
      {...args}
      onAction={(event) => {
        args.onAction?.(event);
        attempts.current += 1;
        return attempts.current > 1;
      }}
    />
  );
}
