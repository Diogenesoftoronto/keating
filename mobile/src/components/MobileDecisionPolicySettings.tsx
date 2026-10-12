import { MobileOnlineLearningSettings } from "./MobileOnlineLearning";

/** Retain the Settings entrypoint while replacing manual fitted-model imports with online model selection. */
export function MobileDecisionPolicySettings() {
  return <MobileOnlineLearningSettings />;
}
