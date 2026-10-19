import { mobileJudgementCalibrationStore, mobileLocalJudgementCalibrationStore } from "@/lib/judgement/calibration";
import type { CalibrationRevisions } from "@/state/judge-config";

/** Live revisions of the hosted and on-device calibration stores. */
export function currentCalibrationRevisions(): CalibrationRevisions {
  return {
    hosted: mobileJudgementCalibrationStore.getRevision(),
    local: mobileLocalJudgementCalibrationStore.getRevision(),
  };
}
