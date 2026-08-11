import { useEffect, useState } from "react";
import Constants from "expo-constants";
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { T, Num } from "gt-react-native";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { MAX_LEARNER_CONTEXT_LENGTH } from "@/lib/learner-context";
import { isDefaultPersona } from "@/lib/persona";
import { providerDefinition, PROVIDERS } from "@/lib/provider-config";
import type { ProviderId } from "@/lib/types";
import {
  FONT_FAMILY_OPTIONS,
  REASONING_LEVEL_OPTIONS,
  THEME_OPTIONS,
} from "@/lib/ui-settings";
import { useKeating } from "@/state/KeatingProvider";
import { useUiSettings } from "@/state/UiSettingsProvider";

const TEMPERATURES = [
  { label: "Focused", value: 0.2 },
  { label: "Balanced", value: 0.6 },
  { label: "Exploratory", value: 0.9 },
] as const;

export default function SettingsScreen() {
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);
  const appVersion = Constants.expoConfig?.version ?? "Unavailable";
  const {
    state,
    keyStatus,
    setProvider,
    updateProviderSettings,
    saveApiKey,
    removeApiKey,
    clearLearningData,
    learnerRepositoryReady,
    persona,
    setPersona,
    restoreDefaultPersona,
    learnerContext,
    setLearnerContext,
    supportsReasoning,
    reasoningLevels,
    supportsTemperature,
  } = useKeating();
  const { settings: uiSettings, updateSettings } = useUiSettings();
  const [apiKey, setApiKey] = useState("");
  const [personaDraft, setPersonaDraft] = useState(persona);
  const [personaSaved, setPersonaSaved] = useState(false);
  const [contextDraft, setContextDraft] = useState(learnerContext);
  const [contextSaved, setContextSaved] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const settings = state.providerSettings;
  const definition = providerDefinition(settings.provider);
  const hasKey = keyStatus[settings.provider];

  useEffect(() => {
    setApiKey("");
    setKeyError(null);
  }, [settings.provider]);

  // Follow the stored persona when it changes outside this screen (hydration,
  // reset) without clobbering an in-progress edit.
  useEffect(() => {
    setPersonaDraft(persona);
    setPersonaSaved(false);
  }, [persona]);

  useEffect(() => {
    setContextDraft(learnerContext);
    setContextSaved(false);
  }, [learnerContext]);

  const chooseProvider = (provider: ProviderId) => {
    setProvider(provider);
  };

  const storeKey = async () => {
    setSavingKey(true);
    setKeyError(null);
    try {
      await saveApiKey(settings.provider, apiKey);
      setApiKey("");
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Could not store the API key.");
    } finally {
      setSavingKey(false);
    }
  };

  const confirmRemoveKey = () => {
    Alert.alert("Remove API key?", `Keating will no longer be able to use ${definition.label} on this device.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove key", style: "destructive", onPress: () => void removeApiKey(settings.provider) },
    ]);
  };

  const confirmClearData = () => {
    Alert.alert(
      "Clear local learning data?",
      "Sessions, artifacts, goals, assessments, decks, reviews, activity, drafts, local attachment files, and About you will be removed. API keys, appearance, and the tutor voice will stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear learning data",
          style: "destructive",
          onPress: () => {
            setDataBusy(true);
            setDataStatus(null);
            setDataError(null);
            void clearLearningData()
              .then(() => setDataStatus("Learning data was cleared from this device."))
              .catch((error) => setDataError(error instanceof Error ? error.message : "Could not clear learning data."))
              .finally(() => setDataBusy(false));
          },
        },
      ],
    );
  };

  return (
    <Screen title="Settings" subtitle="Appearance, provider, teaching style, and on-device data">
      <Section title="Appearance" body="How Keating looks on this device.">
        <FieldLabel>Theme</FieldLabel>
        <ChoiceRow
          options={THEME_OPTIONS}
          selected={uiSettings.theme}
          onSelect={(theme) => updateSettings({ theme })}
        />
        <FieldLabel>Font</FieldLabel>
        <View style={styles.optionList}>
          {FONT_FAMILY_OPTIONS.map((option) => (
            <OptionRow
              key={option.value}
              label={option.label}
              description={option.description}
              selected={uiSettings.fontFamily === option.value}
              onPress={() => updateSettings({ fontFamily: option.value })}
            />
          ))}
        </View>
      </Section>

      <Section title="Chat" body="What the tutor shows you while it teaches.">
        <ToggleRow
          label="Interactive cards"
          description="Render quizzes, question forms, and goals as cards you can answer in place."
          value={uiSettings.showToolUi}
          onValueChange={(showToolUi) => updateSettings({ showToolUi })}
        />
        <ToggleRow
          label="Reasoning summaries"
          description="Show only provider-designated summaries, never hidden chain-of-thought streams."
          value={uiSettings.showReasoning}
          onValueChange={(showReasoning) => updateSettings({ showReasoning })}
        />
        <ToggleRow
          label="Expand summaries"
          description="Open new reasoning-summary disclosures automatically."
          value={uiSettings.autoExpandReasoning}
          onValueChange={(autoExpandReasoning) => updateSettings({ autoExpandReasoning })}
        />
        <ToggleRow
          label="Tool details"
          description="Allow redacted tool arguments and results to expand in the lesson transcript."
          value={uiSettings.showToolDetails}
          onValueChange={(showToolDetails) => updateSettings({ showToolDetails })}
        />
        <ToggleRow
          label="Raw provider errors"
          description="Show the provider's own error text instead of a short explanation."
          value={uiSettings.showRawErrors}
          onValueChange={(showRawErrors) => updateSettings({ showRawErrors })}
        />
        <FieldLabel>Thinking budget</FieldLabel>
        <Text style={styles.hint}>
          {supportsReasoning
            ? "Applied to every reply from the selected model."
            : "The selected model has no thinking budget, so this is ignored until you pick a reasoning model."}
        </Text>
        <View style={styles.optionList}>
          {REASONING_LEVEL_OPTIONS.filter((option) => reasoningLevels.includes(option.value)).map((option) => (
            <OptionRow
              key={option.value}
              label={option.label}
              description={option.description}
              selected={uiSettings.reasoningLevel === option.value}
              onPress={() => updateSettings({ reasoningLevel: option.value })}
            />
          ))}
        </View>
      </Section>

      <Section
        title="About you"
        body="Goals, what you already know, interests, preferred examples, languages, or accessibility needs. Keating uses this as background, never as instructions. It stays on this device."
      >
        <TextInput
          accessibilityLabel="About you"
          multiline
          textAlignVertical="top"
          maxLength={MAX_LEARNER_CONTEXT_LENGTH}
          placeholder="I am learning for… I already know… I learn best with… I am interested in…"
          placeholderTextColor={colors.textFaint}
          value={contextDraft}
          onChangeText={(text) => {
            setContextDraft(text);
            setContextSaved(false);
            setContextError(null);
          }}
          style={[styles.input, styles.contextInput]}
        />
        <View style={styles.buttonRow}>
          <Button
            compact
            disabled={contextDraft.trim() === learnerContext}
            onPress={() => {
              setContextError(null);
              void setLearnerContext(contextDraft)
                .then(() => setContextSaved(true))
                .catch((error) => setContextError(error instanceof Error ? error.message : "Could not save About you."));
            }}
          >
            {contextSaved ? "Saved" : "Save"}
          </Button>
          {learnerContext ? (
            <Button
              compact
              variant="quiet"
              onPress={() => {
                setContextError(null);
                void setLearnerContext("")
                  .catch((error) => setContextError(error instanceof Error ? error.message : "Could not clear About you."));
              }}
            >Clear</Button>
          ) : null}
        </View>
        {contextError ? <Text accessibilityRole="alert" style={styles.error}>{contextError}</Text> : null}
        <Text style={styles.secureNote}>
          {contextDraft.length} / {MAX_LEARNER_CONTEXT_LENGTH} characters
        </Text>
      </Section>

      <Section title="Model provider" body="Requests go directly from this device to the selected provider.">
        <View style={styles.providerList}>
          {PROVIDERS.map((provider) => {
            const selected = provider.id === settings.provider;
            return (
              <Pressable
                key={provider.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => chooseProvider(provider.id)}
                style={({ pressed }) => [styles.providerRow, selected && styles.providerSelected, pressed && styles.pressed]}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                <View style={styles.providerCopy}>
                  <Text style={styles.providerLabel}>{provider.label}</Text>
                  <Text style={styles.providerDescription}>{provider.description}</Text>
                </View>
                {keyStatus[provider.id] ? <Text style={styles.connected}>READY</Text> : null}
              </Pressable>
            );
          })}
        </View>

        <FieldLabel>Model ID</FieldLabel>
        <TextInput
          accessibilityLabel="Model ID"
          autoCapitalize="none"
          autoCorrect={false}
          value={settings.model}
          onChangeText={(model) => updateProviderSettings({ model })}
          style={styles.input}
        />

        {settings.provider === "custom" ? (
          <>
            <FieldLabel>OpenAI-compatible base URL</FieldLabel>
            <TextInput
              accessibilityLabel="Provider base URL"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={settings.baseUrl}
              onChangeText={(baseUrl) => updateProviderSettings({ baseUrl })}
              style={styles.input}
            />
            <Text style={styles.hint}>Android Emulator reaches your computer at 10.0.2.2. Include `/v1` when the server expects it.</Text>
          </>
        ) : null}
      </Section>

      <Section
        title="API key"
        body={hasKey ? `${definition.label} is connected on this device.` : definition.requiresKey ? `Add a ${definition.label} key to start tutoring.` : "A key is optional for this custom endpoint."}
      >
        <TextInput
          accessibilityLabel={`${definition.label} API key`}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder={hasKey ? "Enter a replacement key" : "Paste API key"}
          placeholderTextColor={colors.textFaint}
          value={apiKey}
          onChangeText={setApiKey}
          style={styles.input}
        />
        {keyError ? <Text accessibilityRole="alert" style={styles.error}>{keyError}</Text> : null}
        <View style={styles.buttonRow}>
          <Button compact loading={savingKey} disabled={!apiKey.trim()} onPress={() => void storeKey()}>
            {hasKey ? "Replace key" : "Save key"}
          </Button>
          {hasKey ? <Button compact variant="danger" onPress={confirmRemoveKey}>Remove key</Button> : null}
        </View>
        <Text style={styles.secureNote}>Stored with Expo SecureStore, backed by Android Keystore. Keys are never written to AsyncStorage.</Text>
      </Section>

      <Section
        title="Teacher persona"
        body="The tutor's voice and values. The teaching protocol — diagnosis, reconstruction, retrieval — is fixed and always applied on top of this."
      >
        <TextInput
          accessibilityLabel="Teacher persona"
          multiline
          textAlignVertical="top"
          value={personaDraft}
          onChangeText={(text) => {
            setPersonaDraft(text);
            setPersonaSaved(false);
            setPersonaError(null);
          }}
          style={[styles.input, styles.personaInput]}
        />
        <View style={styles.buttonRow}>
          <Button
            compact
            disabled={personaDraft === persona}
            onPress={() => {
              setPersonaError(null);
              void setPersona(personaDraft)
                .then(() => setPersonaSaved(true))
                .catch((error) => setPersonaError(error instanceof Error ? error.message : "Could not save the tutor persona."));
            }}
          >
            {personaSaved ? "Saved" : "Save persona"}
          </Button>
          {!isDefaultPersona(personaDraft) ? (
            <Button
              compact
              variant="quiet"
              onPress={() => {
                setPersonaError(null);
                void restoreDefaultPersona()
                  .catch((error) => setPersonaError(error instanceof Error ? error.message : "Could not restore John Keating."));
              }}
            >Restore John Keating</Button>
          ) : null}
        </View>
        {personaError ? <Text accessibilityRole="alert" style={styles.error}>{personaError}</Text> : null}
      </Section>

      <Section
        title="Teaching style"
        body={supportsTemperature
          ? "Controls how much variation the selected model can use."
          : "The selected model does not accept temperature, so these controls are unavailable."}
      >
        <View style={styles.temperatureRow} accessibilityRole="radiogroup">
          {TEMPERATURES.map((choice) => {
            const selected = settings.temperature === choice.value;
            return (
              <Pressable
                key={choice.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                disabled={!supportsTemperature}
                onPress={() => updateProviderSettings({ temperature: choice.value })}
                style={({ pressed }) => [
                  styles.temperatureButton,
                  selected && styles.temperatureSelected,
                  !supportsTemperature && styles.temperatureUnsupported,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.temperatureLabel, selected && styles.temperatureLabelSelected]}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section
        title="Local data"
        body={(
          <T>
            <Num>{state.sessions.length}</Num> sessions, <Num>{state.artifacts.length}</Num> saved notes, and{" "}
            <Num>{state.learnerFeedback.helpful + state.learnerFeedback.missed}</Num> ratings on this device.
            Mobile storage is local-only; desktop P2P sync is not enabled on Android yet.
          </T>
        )}
      >
        <Button
          variant="danger"
          loading={dataBusy}
          disabled={!learnerRepositoryReady}
          onPress={confirmClearData}
        >Clear learning data</Button>
        {!learnerRepositoryReady ? <Text style={styles.secureNote}>Opening the local learner repository…</Text> : null}
        {dataStatus ? <Text accessibilityRole="alert" style={styles.connected}>{dataStatus}</Text> : null}
        {dataError ? <Text accessibilityRole="alert" style={styles.error}>{dataError}</Text> : null}
      </Section>

      <View style={styles.about}>
        <Text style={styles.aboutTitle}>Keating Mobile {appVersion}</Text>
        <Text style={styles.aboutBody}>Expo SDK 56 · Android-first · local session storage</Text>
      </View>
    </Screen>
  );
}

function Section({ title, body, children }: { title: string; body: React.ReactNode; children: React.ReactNode }) {
  const styles = createStyles(useKeatingTheme());
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const styles = createStyles(useKeatingTheme());
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

/** A compact segmented control for short, mutually exclusive choices. */
function ChoiceRow<Value extends string>({
  options,
  selected,
  onSelect,
}: {
  options: ReadonlyArray<{ value: Value; label: string }>;
  selected: Value;
  onSelect: (value: Value) => void;
}) {
  const styles = createStyles(useKeatingTheme());
  return (
    <View style={styles.temperatureRow} accessibilityRole="radiogroup">
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.value)}
            style={({ pressed }) => [styles.temperatureButton, isSelected && styles.temperatureSelected, pressed && styles.pressed]}
          >
            <Text style={[styles.temperatureLabel, isSelected && styles.temperatureLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A full-width radio row for choices that need a line of explanation. */
function OptionRow({
  label,
  description,
  selected,
  onPress,
}: {
  label: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = createStyles(useKeatingTheme());
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.providerRow, selected && styles.providerSelected, pressed && styles.pressed]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      <View style={styles.providerCopy}>
        <Text style={styles.providerLabel}>{label}</Text>
        <Text style={styles.providerDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  return (
    <View style={styles.toggleRow}>
      <View style={styles.providerCopy}>
        <Text style={styles.providerLabel}>{label}</Text>
        <Text style={styles.providerDescription}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
        thumbColor={value ? theme.colors.primaryInk : theme.colors.textFaint}
      />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
  section: { marginBottom: spacing.xxl },
  sectionTitle: { ...type.heading, color: colors.text },
  sectionBody: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  sectionContent: { gap: spacing.md, marginTop: spacing.lg },
  providerList: { gap: spacing.sm },
  providerRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  providerSelected: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
  pressed: { backgroundColor: colors.surfacePressed },
  radio: { width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 2, borderColor: colors.textFaint },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 9, height: 9, borderRadius: radii.pill, backgroundColor: colors.primary },
  providerCopy: { flex: 1 },
  providerLabel: { ...type.label, color: colors.text },
  providerDescription: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  connected: { ...type.caption, ...type.monoBold, color: colors.primaryText },
  fieldLabel: { ...type.label, color: colors.text, marginTop: spacing.sm },
  input: {
    ...type.body,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    backgroundColor: colors.backgroundDeep,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  personaInput: { minHeight: 220, maxHeight: 360, paddingVertical: spacing.md, lineHeight: 21 },
  contextInput: { minHeight: 140, maxHeight: 280, paddingVertical: spacing.md, lineHeight: 21 },
  optionList: { gap: spacing.sm },
  toggleRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hint: { ...type.caption, color: colors.textMuted },
  error: { ...type.caption, color: colors.error },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  secureNote: { ...type.caption, color: colors.textFaint },
  temperatureRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  temperatureButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  temperatureSelected: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
  temperatureUnsupported: { opacity: 0.45 },
  temperatureLabel: { ...type.label, color: colors.textMuted },
  temperatureLabelSelected: { color: colors.primaryText },
  about: { alignItems: "center", paddingTop: spacing.lg, paddingBottom: spacing.xxl, borderTopWidth: 1, borderTopColor: colors.border },
  aboutTitle: { ...type.label, ...type.mono, color: colors.text },
  aboutBody: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },
  });
}
