import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Buttons";
import { MarkdownText } from "@/components/MarkdownText";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { fetchCourse } from "@/lib/courses/client";
import { shareCourseMaterial } from "@/lib/courses/material-download";
import type { CourseLesson, CourseMaterial, CourseViewerSnapshot } from "@/lib/courses/types";
import { openProductLink } from "@/lib/open-product-link";
import { useKeating } from "@/state/KeatingProvider";

const MATERIAL_ICON: Record<CourseMaterial["kind"], React.ComponentProps<typeof Ionicons>["name"]> = {
  document: "document-text-outline",
  image: "image-outline",
  link: "link-outline",
  note: "reader-outline",
  anki: "albums-outline",
};

export default function CourseDetailScreen() {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { startNewSessionWithMessage } = useKeating();
  const [snapshot, setSnapshot] = useState<CourseViewerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setError(null);
    try {
      const result = await fetchCourse(id, { signal: next.signal });
      if (!next.signal.aborted) setSnapshot(result);
    } catch (caught) {
      if (next.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : "Could not open this course.");
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  /** Hands a lesson to the tutor in a fresh lesson thread. */
  const studyWithKeating = async (lesson: CourseLesson) => {
    if (!snapshot) return;
    await startNewSessionWithMessage(
      `I am working through "${lesson.title}" in the course "${snapshot.course.title}".`
      + `${lesson.summary ? `\n\nLesson summary: ${lesson.summary}` : ""}`
      + `${lesson.objectives.length > 0 ? `\n\nObjectives:\n${lesson.objectives.map((o) => `- ${o}`).join("\n")}` : ""}`
      + "\n\nStart by finding out what I already understand, then teach me the rest.",
    );
    router.push("/");
  };

  if (error) {
    return (
      <Screen title="Course">
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
        <View style={styles.actions}>
          <Button onPress={() => void load()}>Try again</Button>
          <Button variant="quiet" onPress={() => router.back()}>Back to courses</Button>
        </View>
      </Screen>
    );
  }

  if (!snapshot) {
    return (
      <Screen title="Course">
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primaryText} />
          <Text style={styles.loadingText}>Opening course…</Text>
        </View>
      </Screen>
    );
  }

  const { course, viewer } = snapshot;
  const completed = new Set(viewer.progress.completedLessonIds);
  const unattachedMaterials = course.materials.filter((material) => !material.lessonId);

  return (
    <Screen
      scroll={false}
      title={course.title}
      subtitle={`${viewer.role} · revision ${course.revision}`}
      action={<Button compact variant="quiet" onPress={() => router.back()}>Back</Button>}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {course.description ? <Text style={styles.description}>{course.description}</Text> : null}

        {course.outcomes.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Outcomes</Text>
            {course.outcomes.map((outcome) => (
              <View key={outcome} style={styles.bulletRow}>
                <Ionicons name="ellipse" size={6} color={theme.colors.primaryText} style={styles.bulletDot} />
                <Text style={styles.bulletText}>{outcome}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {course.modules.map((module) => (
          <View key={module.id} style={styles.block}>
            <Text style={styles.blockTitle}>{module.title}</Text>
            {module.description ? <Text style={styles.blockBody}>{module.description}</Text> : null}
            {module.lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                courseId={course.id}
                materials={course.materials.filter((material) => material.lessonId === lesson.id)}
                done={completed.has(lesson.id)}
                expanded={openLessonId === lesson.id}
                onToggle={() => setOpenLessonId((current) => current === lesson.id ? null : lesson.id)}
            onStudy={() => void studyWithKeating(lesson)}
              />
            ))}
            {module.lessons.length === 0 ? <Text style={styles.emptyNote}>No lessons in this module yet.</Text> : null}
          </View>
        ))}

        {unattachedMaterials.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Course materials</Text>
            {unattachedMaterials.map((material) => (
              <MaterialRow key={material.id} courseId={course.id} material={material} />
            ))}
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Members</Text>
          {course.members.map((member) => (
            <View key={member.accountId} style={styles.memberRow}>
              <Text numberOfLines={1} style={styles.memberName}>{member.displayName}</Text>
              <Text style={styles.memberRole}>{member.role}</Text>
            </View>
          ))}
        </View>

        {/*
          Authoring, discussion, and review still live on the web workspace;
          the app links out rather than pretending they are missing.
        */}
        <Text style={styles.footnote}>
          Course building, discussion, and review happen in the web workspace.
        </Text>
        <Button
          variant="quiet"
          onPress={() => void openProductLink("Keating Courses", `https://keating.help/courses/${course.id}`)}
        >
          Open full workspace on web
        </Button>
      </ScrollView>
    </Screen>
  );
}

function LessonRow({
  lesson,
  courseId,
  materials,
  done,
  expanded,
  onToggle,
  onStudy,
}: {
  lesson: CourseLesson;
  courseId: string;
  materials: CourseMaterial[];
  done: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStudy: () => void;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  return (
    <View style={styles.lesson}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${lesson.title}${done ? ", completed" : ""}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.lessonHeader, pressed && styles.lessonPressed]}
      >
        <Ionicons
          name={done ? "checkmark-circle" : "ellipse-outline"}
          size={20}
          color={done ? theme.colors.primaryText : theme.colors.textFaint}
        />
        <View style={styles.lessonCopy}>
          <Text style={styles.lessonTitle}>{lesson.title}</Text>
          {lesson.summary ? <Text numberOfLines={expanded ? undefined : 2} style={styles.lessonSummary}>{lesson.summary}</Text> : null}
          {lesson.estimatedMinutes ? <Text style={styles.lessonMeta}>{lesson.estimatedMinutes} min</Text> : null}
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.colors.textFaint} />
      </Pressable>

      {expanded ? (
        <View style={styles.lessonBody}>
          {lesson.objectives.length > 0 ? (
            <>
              <Text style={styles.lessonSectionTitle}>Objectives</Text>
              {lesson.objectives.map((objective) => (
                <View key={objective} style={styles.bulletRow}>
                  <Ionicons name="ellipse" size={6} color={theme.colors.primaryText} style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{objective}</Text>
                </View>
              ))}
            </>
          ) : null}

          {lesson.reading ? (
            <>
              <Text style={styles.lessonSectionTitle}>Reading</Text>
              <MarkdownText content={lesson.reading} />
            </>
          ) : null}

          {materials.length > 0 ? (
            <>
              <Text style={styles.lessonSectionTitle}>Materials</Text>
              {materials.map((material) => (
                <MaterialRow key={material.id} courseId={courseId} material={material} />
              ))}
            </>
          ) : null}

          <Button compact onPress={onStudy}>Study this with Keating</Button>
        </View>
      ) : null}
    </View>
  );
}

function MaterialRow({ courseId, material }: { courseId: string; material: CourseMaterial }) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Public links can open normally. Uploaded files stay in-app until they have
  // been downloaded with the native course credential, then use the OS viewer.
  const canOpen = material.kind !== "note" && (material.kind !== "link" || Boolean(material.url));
  const open = async () => {
    if (!canOpen || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (material.kind === "link" && material.url) await openProductLink(material.title, material.url);
      else await shareCourseMaterial(courseId, material);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open this course material.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole={material.kind === "note" ? "text" : "button"}
        accessibilityLabel={material.title}
        accessibilityState={{ busy, disabled: !canOpen }}
        disabled={!canOpen || busy}
        onPress={() => void open()}
        style={({ pressed }) => [styles.materialRow, pressed && styles.lessonPressed]}
      >
        <Ionicons name={MATERIAL_ICON[material.kind]} size={18} color={theme.colors.textMuted} />
        <View style={styles.lessonCopy}>
          <Text numberOfLines={1} style={styles.materialTitle}>{material.title}</Text>
          {material.description ? <Text numberOfLines={2} style={styles.materialBody}>{material.description}</Text> : null}
        </View>
        {busy ? <ActivityIndicator size="small" color={theme.colors.primaryText} /> : material.kind === "note" ? null : (
          <Ionicons name={material.kind === "link" ? "open-outline" : "download-outline"} size={15} color={theme.colors.textFaint} />
        )}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.materialError}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    scroll: { gap: spacing.xl, paddingBottom: spacing.xxl },
    loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
    loadingText: { ...type.caption, color: colors.textMuted },
    description: { ...type.body, color: colors.textMuted },
    block: { gap: spacing.sm },
    blockTitle: { ...type.caption, ...type.monoBold, color: colors.primaryText, textTransform: "uppercase", letterSpacing: 1 },
    blockBody: { ...type.body, color: colors.textMuted },
    emptyNote: { ...type.caption, color: colors.textFaint },
    bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    bulletDot: { marginTop: 8 },
    bulletText: { ...type.body, flex: 1, color: colors.text },
    lesson: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    lessonHeader: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    lessonPressed: { backgroundColor: colors.surfacePressed },
    lessonCopy: { flex: 1, minWidth: 0 },
    lessonTitle: { ...type.label, color: colors.text },
    lessonSummary: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    lessonMeta: { ...type.caption, color: colors.textFaint, marginTop: 2 },
    lessonBody: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
    },
    lessonSectionTitle: { ...type.caption, ...type.mono, color: colors.textMuted, textTransform: "uppercase" },
    materialRow: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    materialTitle: { ...type.label, color: colors.text },
    materialBody: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    materialError: { ...type.caption, color: colors.error, marginTop: spacing.xs },
    memberRow: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    memberName: { ...type.body, flex: 1, color: colors.text },
    memberRole: { ...type.caption, ...type.mono, color: colors.textMuted },
    footnote: { ...type.caption, color: colors.textFaint },
    actions: { gap: spacing.md },
    errorBanner: {
      padding: spacing.md,
      marginBottom: spacing.lg,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.errorSurface,
    },
    errorText: { ...type.caption, color: colors.error },
  });
}
