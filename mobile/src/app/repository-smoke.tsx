import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PortableLearnerData } from "@keating/learner-contracts";
import { colors, spacing, type } from "@/constants/theme";
import { openExpoLearnerRepository } from "@/lib/learner-repository/expo";
import {
  MIGRATION_PHASES,
  type MigrationPhase,
} from "@/lib/learner-repository/migration-journal";

const DATABASE_NAME = "keating-learner-native-smoke.sqlite";
const MIGRATION_ID = "native-expo-sqlite-smoke-v2";
const DIGEST = "a".repeat(64);
const AT = "2026-08-10T00:00:00.000Z";

function smokeData(): PortableLearnerData {
  return {
    generatedAt: AT,
    sessions: [{
      id: "smoke-session", title: "SQLite evidence", createdAt: AT, updatedAt: AT,
      activeBranchId: "smoke-branch",
      branches: [{ id: "smoke-branch", sessionId: "smoke-session", createdAt: AT, updatedAt: AT }],
      messages: [{
        id: "smoke-message", role: "user", content: "Persist this", createdAt: AT,
        attachments: [{ id: "smoke-attachment", kind: "document", name: "smoke.md", mimeType: "text/markdown", sizeBytes: 16 }],
      }],
    }],
    artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [], studyPriorities: [],
    feedbackEvents: [],
    usageEvents: [{
      id: "smoke-usage", provider: "openai", model: "gpt-5", createdAt: AT, sessionId: "smoke-session",
      providerReported: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    }],
    topicEvidence: [{
      id: "smoke-evidence", topic: "SQLite evidence", createdAt: AT, provenance: "session",
      reference: { kind: "session", id: "smoke-session" },
    }],
    benchmarks: [],
    evolutions: [],
    learnerProfile: { topicsExplored: ["SQLite evidence"], strengths: [], weaknesses: [], sessionsCount: 1, lastSessionAt: AT },
  };
}

async function exerciseNativeRepository(): Promise<void> {
  const repository = await openExpoLearnerRepository({ databaseName: DATABASE_NAME });
  try {
    let entry = await repository.migrations.start({
      id: MIGRATION_ID,
      sourceVersion: 1,
      targetVersion: 2,
      digest: DIGEST,
    });
    const remaining = MIGRATION_PHASES.slice(MIGRATION_PHASES.indexOf(entry.phase) + 1);
    for (const phase of remaining) {
      entry = await repository.migrations.advance(MIGRATION_ID, phase as MigrationPhase);
    }
    if (entry.phase !== "completed") throw new Error("Migration did not complete.");
    await repository.records.replaceWithLocalAttachments(smokeData(), [{
      messageId: "smoke-message",
      attachmentId: "smoke-attachment",
      uri: "file:///keating-smoke/smoke.md",
    }]);
    const exported = await repository.records.exportPortable();
    if (exported.payload.usageEvents[0]?.providerReported.totalTokens !== 3
      || JSON.stringify(exported).includes("file:///keating-smoke")) {
      throw new Error("Portable export did not preserve usage or leaked a local attachment URI.");
    }
  } finally {
    await repository.close();
  }

  const reopened = await openExpoLearnerRepository({ databaseName: DATABASE_NAME });
  try {
    const persisted = await reopened.migrations.get(MIGRATION_ID);
    if (persisted?.phase !== "completed" || persisted.digest !== DIGEST) {
      throw new Error("Completed migration did not survive repository restart.");
    }
    const snapshot = await reopened.records.snapshot();
    const locations = await reopened.records.getLocalAttachments();
    if (snapshot.sessions[0]?.messages[0]?.attachments?.[0]?.name !== "smoke.md"
      || snapshot.topicEvidence[0]?.topic !== "SQLite evidence"
      || locations[0]?.uri !== "file:///keating-smoke/smoke.md") {
      throw new Error("Portable records or local attachment locations did not survive restart.");
    }
  } finally {
    await reopened.close();
  }
}

export default function RepositorySmokeScreen() {
  const [result, setResult] = useState<"running" | "passed" | "failed">("running");
  const [detail, setDetail] = useState("Opening the native Expo SQLite repository…");

  useEffect(() => {
    let active = true;
    void exerciseNativeRepository().then(
      () => {
        console.info("[keating:native-repository-smoke] PASSED schema journal portable-records local-attachments usage-evidence close reopen");
        if (!active) return;
        setResult("passed");
        setDetail("Schema, journal, portable usage/evidence, private attachment location, close, reopen, and persisted read passed.");
      },
      (error: unknown) => {
        console.error("[keating:native-repository-smoke] FAILED", error);
        if (!active) return;
        setResult("failed");
        setDetail(error instanceof Error ? error.message : "Unknown native repository failure.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>INTERNAL ACCEPTANCE</Text>
        <Text style={styles.title}>Native SQLite smoke</Text>
        {result === "running" ? <ActivityIndicator color={colors.primaryText} /> : null}
        <Text style={[styles.result, result === "failed" ? styles.failed : null]}>
          {result.toUpperCase()}
        </Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  card: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  eyebrow: { ...type.mono, color: colors.primaryText, fontSize: 12, letterSpacing: 1.5 },
  title: { ...type.heading, color: colors.text, fontSize: 24 },
  result: { ...type.monoBold, color: colors.primaryText, fontSize: 18 },
  failed: { color: colors.error },
  detail: { ...type.body, color: colors.textMuted, fontSize: 15, lineHeight: 22 },
});
