import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { T, Num } from "gt-react-native";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { colors, radii, spacing, type } from "@/constants/theme";
import { isDefaultPersona } from "@/lib/persona";
import { providerDefinition, PROVIDERS } from "@/lib/provider-config";
import type { ProviderId } from "@/lib/types";
import { useKeating } from "@/state/KeatingProvider";

const TEMPERATURES = [
  { label: "Focused", value: 0.2 },
  { label: "Balanced", value: 0.6 },
  { label: "Exploratory", value: 0.9 },
] as const;

export default function SettingsScreen() {
  const {
    state,
    keyStatus,
    setProvider,
    updateProviderSettings,
    saveApiKey,
    removeApiKey,
    clearLearningData,
    persona,
    setPersona,
    restoreDefaultPersona,
  } = useKeating();
  const [apiKey, setApiKey] = useState("");
  const [personaDraft, setPersonaDraft] = useState(persona);
  const [personaSaved, setPersonaSaved] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
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
      "All sessions, feedback, and saved notes will be removed. Provider keys will stay in secure storage.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear learning data", style: "destructive", onPress: () => void clearLearningData() },
      ],
    );
  };

  return (
    <Screen title="Settings" subtitle="Provider, teaching style, and on-device data">
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
          }}
          style={[styles.input, styles.personaInput]}
        />
        <View style={styles.buttonRow}>
          <Button
            compact
            disabled={personaDraft === persona}
            onPress={() => {
              void setPersona(personaDraft).then(() => setPersonaSaved(true));
            }}
          >
            {personaSaved ? "Saved" : "Save persona"}
          </Button>
          {!isDefaultPersona(personaDraft) ? (
            <Button compact variant="quiet" onPress={() => void restoreDefaultPersona()}>Restore John Keating</Button>
          ) : null}
        </View>
      </Section>

      <Section title="Teaching style" body="Controls how much variation the selected model can use.">
        <View style={styles.temperatureRow} accessibilityRole="radiogroup">
          {TEMPERATURES.map((choice) => {
            const selected = settings.temperature === choice.value;
            return (
              <Pressable
                key={choice.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => updateProviderSettings({ temperature: choice.value })}
                style={({ pressed }) => [styles.temperatureButton, selected && styles.temperatureSelected, pressed && styles.pressed]}
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
        <Button variant="danger" onPress={confirmClearData}>Clear learning data</Button>
      </Section>

      <View style={styles.about}>
        <Text style={styles.aboutTitle}>Keating Mobile 2.5.0</Text>
        <Text style={styles.aboutBody}>Expo SDK 56 · Android-first · local session storage</Text>
      </View>
    </Screen>
  );
}

function Section({ title, body, children }: { title: string; body: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
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
  connected: { ...type.caption, ...type.mono, color: colors.primary, fontWeight: "700" },
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
  hint: { ...type.caption, color: colors.textMuted },
  error: { ...type.caption, color: colors.error },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  secureNote: { ...type.caption, color: colors.textFaint },
  temperatureRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  temperatureButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  temperatureSelected: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
  temperatureLabel: { ...type.label, color: colors.textMuted },
  temperatureLabelSelected: { color: colors.primary },
  about: { alignItems: "center", paddingTop: spacing.lg, paddingBottom: spacing.xxl, borderTopWidth: 1, borderTopColor: colors.border },
  aboutTitle: { ...type.label, ...type.mono, color: colors.text },
  aboutBody: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },
});
