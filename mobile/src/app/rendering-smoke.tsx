import {
  MARKDOWN_PARITY_FIXTURE,
  NESTED_RENDERING_DOCUMENT_FIXTURE,
  OPENUI_JSON_PARITY_FIXTURE,
  RENDERING_FIXTURE_PACK_VERSION,
  RENDERING_LIFECYCLE_FIXTURES,
  validateUiDocument,
} from "@keating/learner-contracts";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MarkdownText } from "@/components/MarkdownText";
import { UiDocumentRenderer } from "@/components/UiDocumentRenderer";
import { spacing, useKeatingTheme } from "@/constants/theme";

const LIFECYCLE_DOCUMENTS = RENDERING_LIFECYCLE_FIXTURES.flatMap(({ payload }) =>
  validateUiDocument(payload) ? [payload] : [],
);

export default function RenderingSmokeScreen() {
  const theme = useKeatingTheme();
  const [lastTurn, setLastTurn] = useState("No learner action sent yet.");
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[theme.type.title, { color: theme.colors.text }]}>Rendering acceptance</Text>
        <Text style={[theme.type.caption, { color: theme.colors.textMuted }]}>Fixture pack v{RENDERING_FIXTURE_PACK_VERSION} · Markdown · canonical · nested · recovery lifecycle</Text>
        <View style={[styles.section, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
          <MarkdownText content={MARKDOWN_PARITY_FIXTURE} />
        </View>
        <FixtureLabel>Canonical document</FixtureLabel>
        <UiDocumentRenderer sourceDocument={OPENUI_JSON_PARITY_FIXTURE} onLearnerTurn={async (text) => setLastTurn(text)} />
        <FixtureLabel>Nested interactions</FixtureLabel>
        <UiDocumentRenderer sourceDocument={NESTED_RENDERING_DOCUMENT_FIXTURE} onLearnerTurn={async (text) => setLastTurn(text)} />
        <FixtureLabel>Lifecycle and recovery states</FixtureLabel>
        {LIFECYCLE_DOCUMENTS.map((document) => (
          <UiDocumentRenderer key={document.id} sourceDocument={document} onLearnerTurn={async (text) => setLastTurn(text)} />
        ))}
        <Text accessibilityLiveRegion="polite" style={[theme.type.caption, { color: theme.colors.textMuted }]}>{lastTurn}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function FixtureLabel({ children }: { children: string }) {
  const theme = useKeatingTheme();
  return <Text style={[theme.type.heading, { color: theme.colors.text }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xxl },
  section: { padding: spacing.md, borderWidth: 1, borderRadius: 12 },
});
