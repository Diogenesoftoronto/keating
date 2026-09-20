import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { useReviewPasses, type UseReviewPassesResult } from "../hooks/use-review-passes";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";
import { messageReviewAnchor } from "../keating/trajectory-review";
import { rubricProposalMatchesTrajectory } from "../keating/trajectory-passes";
import { RubricProposal } from "../components/trajectory/MarginProposals";

test("production review hook invokes independent typed runtime without a generation pool", async () => {
  const messages = [{ role: "assistant", timestamp: 1, content: [{ type: "text", text: "A fraction counts equal parts of a whole." }] }] as unknown as AgentMessage[];
  let calls = 0;
  let passes: UseReviewPassesResult | undefined;
  const judgementRuntime = () => createWebJudgementRuntime({
    settings: { backend: "local", localModelId: "review-local", gatewayPath: "/api/judgement" },
    localScorer: { modelId: "review-local", scoreLabels: async ({ question, labels }) => {
      calls++;
      return labels.map((_, index) => index === (question.type === "score" ? 4 : 0) ? 1 : 0.000001);
    } },
  });
  function Probe() { passes = useReviewPasses("session", messages, [], { judgementRuntime }); return null; }
  renderToStaticMarkup(<Probe />);
  const proposal = await passes!.runRubricScore();
  expect(calls).toBe(14);
  expect(proposal?.judgement?.backend.model).toBe("review-local");
  expect(proposal?.ratings).toHaveLength(6);
  expect(proposal?.ratings[0].messageId).toBe(messageReviewAnchor("session", messages[0], 0).id);
  expect(rubricProposalMatchesTrajectory(proposal!, "session", messages)).toBe(true);
  expect(rubricProposalMatchesTrajectory(proposal!, "different-session", messages)).toBe(false);
  expect(rubricProposalMatchesTrajectory(proposal!, "session", [])).toBe(false);
  const html = renderToStaticMarkup(<RubricProposal proposal={proposal!} onApply={() => {}} onDismiss={() => {}} />);
  expect(html).toContain("Uncalibrated model estimate");
  expect(html).toContain("local/review-local");
  expect(html).toContain("A fraction counts equal parts of a whole.");
});

test("hook keeps failed review unscored and strips thrown provider text", async () => {
  let passes: UseReviewPassesResult | undefined;
  function Probe() {
    passes = useReviewPasses("session", [{ id: "tutor", role: "assistant", content: "This is enough text to be citable." }] as unknown as AgentMessage[], [], {
      judgementRuntime: () => ({ settings: { backend: "local", localModelId: "broken", gatewayPath: "/api/judgement" }, policy: { calibration: { entries: {} }, tiers: [
        { key: { backend: "local", model: "broken", calibrationSha256: null }, call: async () => { throw new Error("private learner record"); } },
      ] } }),
    }); return null;
  }
  renderToStaticMarkup(<Probe />);
  expect(await passes!.runRubricScore()).toBeNull();
});
