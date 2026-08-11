import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { ActivityCalendar } from "@/components/usage/ActivityCalendar";
import { TopicWheel } from "@/components/usage/TopicWheel";
import { SelfEvolutionChart } from "@/components/usage/SelfEvolutionChart";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { providerDefinition, PROVIDERS } from "@/lib/provider-config";
import {
  exportPortableLearnerFile,
  pickPortableLearnerImport,
  type PortableLearnerImportPreview,
} from "@/lib/learner-portable-file";
import { createExpoPortableLearnerFileIo } from "@/lib/learner-portable-native";
import { buildNativeTrainingArchive } from "@/lib/training-archive";
import { shareNativeTrainingArchive } from "@/lib/training-archive-native";
import { buildNativeFineTuneExport } from "@/lib/training-export";
import { buildMobileUsageSummary, buildRepositoryUsageSummary } from "@/lib/usage-summary";
import { useKeating } from "@/state/KeatingProvider";

export default function UsageScreen() {
  const router = useRouter();
  const {
    state,
    learnerData,
    learnerRepositoryReady,
    exportLearnerData,
    importLearnerData,
    clearLearningData,
    selectSession,
  } = useKeating();
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const summary = useMemo(
    () => learnerData ? buildRepositoryUsageSummary(learnerData) : buildMobileUsageSummary(state),
    [learnerData, state],
  );
  const portableIo = useMemo(createExpoPortableLearnerFileIo, []);
  const [portableBusy, setPortableBusy] = useState<"training" | "export" | "pick" | "import" | "clear" | null>(null);
  const [pendingImport, setPendingImport] = useState<PortableLearnerImportPreview | null>(null);
  const [portableStatus, setPortableStatus] = useState<string | null>(null);
  const [portableError, setPortableError] = useState<string | null>(null);
  const portableDisabled = !learnerRepositoryReady || portableBusy !== null;
  const openSession = (sessionId: string) => {
    selectSession(sessionId);
    router.replace("/");
  };

  const beginPortableAction = (action: NonNullable<typeof portableBusy>) => {
    setPortableBusy(action);
    setPortableStatus(null);
    setPortableError(null);
  };

  const runExport = async () => {
    beginPortableAction("export");
    try {
      const envelope = await exportLearnerData();
      const result = await exportPortableLearnerFile(portableIo, envelope);
      setPortableStatus(`${result.name} was prepared in the system share sheet.`);
    } catch (error) {
      setPortableError(portableActionError(error));
    } finally {
      setPortableBusy(null);
    }
  };

  const runTrainingExport = async () => {
    beginPortableAction("training");
    try {
      const envelope = await exportLearnerData();
      // Let React Native paint the busy state before the bounded synchronous archive build.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const training = buildNativeFineTuneExport(envelope.payload);
      const archive = buildNativeTrainingArchive(training);
      await shareNativeTrainingArchive(archive);
      setPortableStatus(`${archive.filename} was prepared with ${training.recordCount} canonical training record${training.recordCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setPortableError(portableActionError(error));
    } finally {
      setPortableBusy(null);
    }
  };

  const runPickImport = async () => {
    beginPortableAction("pick");
    try {
      const preview = await pickPortableLearnerImport(portableIo);
      if (preview) setPendingImport(preview);
    } catch (error) {
      setPortableError(portableActionError(error));
    } finally {
      setPortableBusy(null);
    }
  };

  const runImport = async () => {
    if (!pendingImport) return;
    beginPortableAction("import");
    try {
      const imported = await importLearnerData(pendingImport.envelope);
      const hidden = imported.unprojected.sessionCount + imported.unprojected.artifactCount;
      setPortableStatus(
        `Merged ${pendingImport.name}. ${pendingImport.summary}.${hidden
          ? ` ${hidden} imported record${hidden === 1 ? " is" : "s are"} preserved in the repository but need a newer native renderer.`
          : ""}`,
      );
      setPendingImport(null);
    } catch (error) {
      setPortableError(portableActionError(error));
    } finally {
      setPortableBusy(null);
    }
  };

  const runClear = async () => {
    beginPortableAction("clear");
    try {
      await clearLearningData();
      setPendingImport(null);
      setPortableStatus("Learning data, drafts, local attachment files, and About you were cleared from this device.");
    } catch (error) {
      setPortableError(portableActionError(error));
    } finally {
      setPortableBusy(null);
    }
  };

  const confirmClear = () => Alert.alert(
    "Clear learning data?",
    "This removes sessions, artifacts, goals, assessments, decks, reviews, activity records, drafts, local attachment files, and About you. API keys, appearance, and the tutor voice stay on this device.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Clear learning data", style: "destructive", onPress: () => void runClear() },
    ],
  );

  return (
    <Screen
      title="Usage & study activity"
      subtitle="A local record of your lessons, sources, model usage, and study topics"
      action={<Button compact variant="quiet" onPress={() => router.back()}>Back</Button>}
    >
      <View style={styles.metrics}>
        <Metric label="Lessons" value={formatNumber(summary.lessons)} styles={styles} />
        <Metric label="Messages" value={formatNumber(summary.messages)} styles={styles} />
        <Metric label="Tokens" value={formatNumber(summary.totalTokens)} styles={styles} />
        <Metric label="Saved items" value={formatNumber(summary.artifacts)} styles={styles} />
        <Metric label="Attachments" value={formatNumber(summary.attachments)} styles={styles} />
        <Metric label="Feedback" value={formatNumber(summary.helpful + summary.missed)} styles={styles} />
      </View>

      <Text style={styles.provenance}>
        Topics below come from lesson titles and generated artifacts. Keating does not infer mastery from a title alone.
      </Text>

      <Section title="Days used" styles={styles}>
        <Text style={styles.sectionCopy}>Each square counts lessons started on that local calendar day. Select an active day to reopen a lesson.</Text>
        <ActivityCalendar sessionStarts={summary.sessionStarts} onOpenSession={openSession} />
      </Section>

      <Section title="Topic mix" styles={styles}>
        <Text style={styles.sectionCopy}>The ring counts persisted topic evidence from lessons and artifacts. It is activity, not a mastery score.</Text>
        <TopicWheel topics={summary.topics} />
      </Section>

      <Section title="What you have been studying" styles={styles}>
        {summary.topics.length ? summary.topics.map((topic) => (
          <DataRow
            key={topic.key}
            title={topic.label}
            detail={`${topic.source} · ${topic.turns ? `${topic.turns} messages · ` : ""}${formatDate(topic.lastStudiedAt)}`}
            styles={styles}
          />
        )) : <EmptyCopy text="Start a named lesson or generate a study artifact to build this list." styles={styles} />}
      </Section>

      <Section title="Model usage" styles={styles}>
        {summary.models.length ? summary.models.map((model) => (
          <DataRow
            key={model.key}
            title={`${providerActivityLabel(model.provider)} · ${model.model}`}
            detail={`${model.replies} ${model.replies === 1 ? "reply" : "replies"} · ${formatNumber(model.tokens)} reported tokens`}
            styles={styles}
          />
        )) : <EmptyCopy text="Model and token totals begin with replies created by this version." styles={styles} />}
        <View style={styles.tokenBreakdown}>
          <Text style={styles.tokenLine}>Input {formatNumber(summary.inputTokens)}</Text>
          <Text style={styles.tokenLine}>Output {formatNumber(summary.outputTokens)}</Text>
          {summary.reportedCostUsd > 0 ? <Text style={styles.tokenLine}>Reported cost ${summary.reportedCostUsd.toFixed(4)}</Text> : null}
        </View>
      </Section>

      <Section title="Learning signals" styles={styles}>
        <DataRow title="Helpful responses" detail={formatNumber(summary.helpful)} styles={styles} />
        <DataRow title="Responses needing work" detail={formatNumber(summary.missed)} styles={styles} />
        <Text style={styles.provenance}>
          Quiz mastery, spaced-repetition retention, goals, and evidence confidence live in Learn & Coming Up. This page keeps activity and provider-reported usage separate.
        </Text>
      </Section>

      <Section title="Self-evolution health" styles={styles}>
        <Text style={styles.sectionCopy}>
          These are scores from actual benchmark and policy-evolution runs. Keating never derives them from lesson titles, message counts, or activity.
        </Text>
        <SelfEvolutionChart benchmarks={learnerData?.benchmarks ?? []} evolutions={learnerData?.evolutions ?? []} />
      </Section>

      <Section title="Recent lessons" styles={styles}>
        {summary.recentLessons.length ? summary.recentLessons.map((lesson) => (
          <DataRow
            key={lesson.id}
            title={lesson.title}
            detail={`${lesson.messages} messages · ${formatDate(lesson.updatedAt)}`}
            styles={styles}
          />
        )) : <EmptyCopy text="Your recent lessons will appear here." styles={styles} />}
      </Section>

      <Section title="Fine-tuning export" styles={styles}>
        <Text style={styles.portableCopy}>
          Export a ZIP with canonical provenance-rich JSONL plus ChatML, Alpaca, KTO, DPO when explicit preferences exist, and GRPO prompt files. Explicitly missed responses stay out of positive supervised fine-tuning data.
        </Text>
        <Text style={styles.portableCopy}>
          Redaction is enabled. Unscored responses remain labelled unscored, source groups stay in one deterministic train or validation split, and the archive includes a manifest, schema, and dataset card. Inspect it before uploading because pattern matching cannot remove every private value.
        </Text>
        <View style={styles.portableActions}>
          <Button
            compact
            variant="secondary"
            disabled={portableDisabled}
            loading={portableBusy === "training"}
            onPress={() => void runTrainingExport()}
          >Export training ZIP</Button>
        </View>
      </Section>

      <Section title="Portable learning data" styles={styles}>
        <Text style={styles.portableCopy}>
          Export includes transcripts, artifacts, goals, assessments, reviews, topic evidence, actual benchmark/evolution history, model IDs, and provider-reported usage. It never includes API keys, provider settings, About you, attachment files, device URIs, or file bytes.
        </Text>
        <Text style={styles.portableCopy}>
          Import merges rather than replaces. Newer records win; an equal-time conflict or invalid, unsafe, unsupported, or oversized backup changes nothing. Imported attachment names remain visible, but their files must be attached again on this device.
        </Text>
        <View style={styles.portableActions}>
          <Button
            compact
            variant="secondary"
            disabled={portableDisabled}
            loading={portableBusy === "export"}
            onPress={() => void runExport()}
          >Export JSON</Button>
          <Button
            compact
            disabled={portableDisabled}
            loading={portableBusy === "pick"}
            onPress={() => void runPickImport()}
          >Choose JSON to import</Button>
          <Button
            compact
            variant="danger"
            disabled={portableDisabled}
            loading={portableBusy === "clear"}
            onPress={confirmClear}
          >Clear learning data</Button>
        </View>
        {!learnerRepositoryReady ? <Text style={styles.portableCopy}>Opening the local learner repository…</Text> : null}
        {pendingImport ? (
          <View style={styles.importPreview}>
            <Text style={styles.importTitle}>Ready to merge {pendingImport.name}</Text>
            <Text style={styles.portableCopy}>{pendingImport.summary}</Text>
            <View style={styles.portableActions}>
              <Button
                compact
                disabled={portableBusy !== null}
                loading={portableBusy === "import"}
                onPress={() => void runImport()}
              >Merge import</Button>
              <Button
                compact
                variant="quiet"
                disabled={portableBusy !== null}
                onPress={() => setPendingImport(null)}
              >Cancel</Button>
            </View>
          </View>
        ) : null}
        {portableStatus ? <Text accessibilityRole="alert" style={styles.portableStatus}>{portableStatus}</Text> : null}
        {portableError ? <Text accessibilityRole="alert" style={styles.portableError}>{portableError}</Text> : null}
      </Section>
    </Screen>
  );
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function Section({ title, children, styles }: { title: string; children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function DataRow({ title, detail, styles }: { title: string; detail: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.row}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>;
}

function EmptyCopy({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

function providerActivityLabel(provider: string): string {
  const native = PROVIDERS.find((candidate) => candidate.id === provider);
  return native ? providerDefinition(native.id).label : provider;
}

function portableActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The learning-data action failed.";
  if (/conflict/i.test(message)) {
    return "This backup conflicts with a record saved at the same time. Existing data was not changed. Export the current data, then choose a newer backup.";
  }
  if (/quota|too large/i.test(message)) {
    return "This backup is too large for the local learner repository. Existing data was not changed. Choose a smaller Keating learner export.";
  }
  return message;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
    metric: {
      width: "31%",
      minWidth: 96,
      flexGrow: 1,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      backgroundColor: colors.surfaceRaised,
    },
    metricValue: { ...type.heading, ...type.monoBold, color: colors.text },
    metricLabel: { ...type.caption, marginTop: 2, color: colors.textMuted },
    provenance: { ...type.caption, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.lg },
    section: { marginTop: spacing.md, marginBottom: spacing.xl },
    sectionTitle: { ...type.heading, marginBottom: spacing.sm, color: colors.text },
    sectionCopy: { ...type.caption, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.md },
    row: { minHeight: 58, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
    rowTitle: { ...type.label, color: colors.text },
    rowDetail: { ...type.caption, marginTop: 2, color: colors.textMuted },
    tokenBreakdown: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingTop: spacing.md },
    tokenLine: { ...type.caption, ...type.mono, color: colors.textMuted },
    empty: { ...type.body, color: colors.textMuted, paddingVertical: spacing.md },
    portableCopy: { ...type.caption, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.sm },
    portableActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
    importPreview: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceRaised,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    importTitle: { ...type.label, color: colors.text, marginBottom: spacing.xs },
    portableStatus: { ...type.caption, color: colors.primaryText, lineHeight: 19, marginTop: spacing.md },
    portableError: { ...type.caption, color: colors.error, lineHeight: 19, marginTop: spacing.md },
  });
}
