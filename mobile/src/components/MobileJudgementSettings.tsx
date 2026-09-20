import { Switch, Text, View } from "react-native";
import { Button } from "./Buttons";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { useUiSettings } from "@/state/UiSettingsProvider";
import { useNotOrganicAccount } from "@/state/NotOrganicAccountProvider";
import { MobileJudgementCalibrationSettings } from "./MobileJudgementCalibrationSettings";
import { MobileDecisionPolicySettings } from "./MobileDecisionPolicySettings";

export function MobileJudgementSettings() {
  const { settings, updateSettings } = useUiSettings();
  const account = useNotOrganicAccount();
  const { colors } = useKeatingTheme();
  const permitted = account.session?.scope.split(/\s+/).includes("judgement:evaluate") && account.session.issuer;
  return <View style={{ gap: spacing.sm }}>
    <Text style={{ color: colors.text }}>Review on this device with MiniCPM5</Text>
    <Switch accessibilityLabel="Use MiniCPM5 for local judgement" value={settings.judgementLocalModel === "minicpm5-2b-int4"}
      onValueChange={enabled => updateSettings({ judgementLocalModel: enabled ? "minicpm5-2b-int4" : "off" })} />
    <Text style={{ color: colors.textMuted }}>Uses the model downloaded under Offline tutor. This selection is independent of your tutor model. Local review keeps saved answers on this device; uncalibrated estimates keep grades pending.</Text>
    <Text style={{ color: colors.text }}>Review saved work with Not Organic</Text>
    <Switch accessibilityLabel="Allow hosted judgement of saved answers" value={settings.judgementHosted}
      onValueChange={judgementHosted => updateSettings({ judgementHosted })} />
    <Text style={{ color: colors.textMuted }}>Independent of your tutor model. When enabled, assessment prompts, answer keys and your saved answers are sent to Not Organic for review. Uncalibrated estimates keep the final grade pending.</Text>
    <Text style={{ color: colors.textMuted }}>The actual model version is recorded with each review. When both are enabled, local review runs first; hosted review may handle questions it cannot settle.</Text>
    {settings.judgementHosted ? <>
      <Text style={{ color: colors.textMuted }}>{permitted ? "This account has judgement permission." : "Authorize judgement permission for this device."}</Text>
      <Button disabled={account.status === "authorizing"}
        onPress={() => void account.login({ judgement: true })}>{permitted ? "Renew judgement permission" : "Authorize judgement"}</Button>
    </> : null}
    <MobileJudgementCalibrationSettings />
    <MobileJudgementCalibrationSettings local />
    <Text style={{ color: colors.text }}>Remember relevant learner notes</Text>
    <Switch accessibilityLabel="Save reviewed learner notes" value={settings.judgementMemory}
      onValueChange={judgementMemory => updateSettings({ judgementMemory })} />
    <Text style={{ color: colors.textMuted }}>After a reply, review exact quotes found by local Needle recall. Only notes that pass verified calibration are saved for later replies. Stored notes stay on this device and are separated by account. Uses your local or hosted judgement preferences above.</Text>
    <MobileDecisionPolicySettings />
  </View>;
}
