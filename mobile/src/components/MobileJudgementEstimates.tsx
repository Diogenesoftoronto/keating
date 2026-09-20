import { Text, View } from "react-native";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { mobileJudgementReviewIsCurrent } from "@/lib/learner-repository/judgement-reviews";
import { useKeating } from "@/state/KeatingProvider";

/** Only current saved answers can display a model's separate review estimate. */
export function MobileJudgementEstimates({ documentId }: { documentId: string }) {
  const { judgementReviews, learnerData } = useKeating();
  const { colors } = useKeatingTheme();
  const checks = new Map(learnerData?.questionChecks.map(check => [check.id, check]) ?? []);
  const reviews = judgementReviews.filter(record => record.documentId === documentId
    && mobileJudgementReviewIsCurrent(record, checks.get(record.check.id)));
  if (!reviews.length) return null;
  return <View accessibilityLiveRegion="polite" style={{ gap: spacing.sm }}>
    {reviews.map(record => <View key={record.check.id} style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.text, fontWeight: "600" }}>{record.check.question}</Text>
      {record.judgement.proposal ? <>
        <Text style={{ color: colors.text }}>Uncalibrated estimate: {record.judgement.proposal.verdict}. Final grade pending.</Text>
        <Text selectable style={{ color: colors.text }}>“{record.judgement.proposal.evidenceQuote}”</Text>
        <Text style={{ color: colors.textMuted }}>{record.judgement.proposal.backend.model} · Model evidence, awaiting teacher review.</Text>
      </> : <Text style={{ color: colors.textMuted }}>{record.judgement.final.grading === "pending"
        ? "Saved. Final grade pending; no usable model estimate."
        : `Grade: ${record.judgement.final.verdict} (${record.judgement.final.tier}).`}</Text>}
    </View>)}
  </View>;
}
