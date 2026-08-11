import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";
import { Button } from "@/components/Buttons";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import {
  CourseApiError,
  clearCourseSession,
  fetchCoursesForCurrentAccount,
  joinCourse,
} from "@/lib/courses/client";
import type { CourseListItem, CourseSessionAccount } from "@/lib/courses/types";
import { PRODUCT_LINKS } from "@/lib/product-links";

export default function CoursesScreen() {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const router = useRouter();
  const [courses, setCourses] = useState<CourseListItem[] | null>(null);
  const [account, setAccount] = useState<CourseSessionAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (mode === "refresh") setRefreshing(true);
    setError(null);
    setErrorCode(null);
    try {
      // The server mints the local account during /session. Waiting for that
      // cookie before the list request means both requests always address the
      // same learner, even on a brand-new install.
      const { account: session, courses: list } = await fetchCoursesForCurrentAccount({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setAccount(session);
      setCourses(list);
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      const code = caught instanceof CourseApiError ? caught.code : null;
      setError(code === "notorganic_auth_adapter_unavailable"
        ? "Hosted course sign-in is unavailable on this server. Open Courses on the web to sign in or contact the server administrator."
        : caught instanceof Error ? caught.message : "Could not load your courses.");
      setErrorCode(code);
      // Keep whatever list is already on screen; a failed refresh should not
      // blank out courses the learner was reading.
      setCourses((current) => current ?? []);
    } finally {
      if (loadController.current === controller) loadController.current = null;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
    return () => loadController.current?.abort();
  }, [load]);

  const disconnect = useCallback(async () => {
    if (disconnecting) return;
    loadController.current?.abort();
    setDisconnecting(true);
    setError(null);
    setErrorCode(null);
    setAccount(null);
    setCourses(null);
    try {
      await clearCourseSession();
      await load("initial");
    } finally {
      setDisconnecting(false);
    }
  }, [disconnecting, load]);

  return (
    <Screen
      scroll={false}
      title="Courses"
      subtitle={account ? `Signed in as ${account.displayName}` : "Structured learning with your class or study group"}
      action={(
        <View style={styles.headerActions}>
          {account ? (
            <Button compact variant="quiet" loading={disconnecting} onPress={() => void disconnect()}>
              Disconnect
            </Button>
          ) : null}
          <Button compact variant="secondary" onPress={() => setJoinOpen(true)}>Join</Button>
        </View>
      )}
    >
      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          {errorCode === "notorganic_auth_adapter_unavailable" ? (
            <Button
              compact
              variant="quiet"
              onPress={() => void Linking.openURL(PRODUCT_LINKS.courses)}
            >
              Open Courses on web
            </Button>
          ) : (
            <Button compact variant="quiet" onPress={() => void load("refresh")}>Try again</Button>
          )}
        </View>
      ) : null}

      {courses === null ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primaryText} />
          <Text style={styles.loadingText}>Loading your courses…</Text>
        </View>
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(course) => course.id}
          contentContainerStyle={styles.list}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load("refresh")}
              tintColor={theme.colors.primaryText}
            />
          )}
          renderItem={({ item }) => (
            <CourseRow course={item} onPress={() => router.push(`/course/${item.id}`)} />
          )}
          ListEmptyComponent={(
            <EmptyState
              title="No courses yet"
              body="Join a course with the invite code your teacher or study group shared."
              action={<Button onPress={() => setJoinOpen(true)}>Join a course</Button>}
            />
          )}
        />
      )}

      <JoinCourseSheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(courseId) => {
          setJoinOpen(false);
          void load("refresh");
          router.push(`/course/${courseId}`);
        }}
      />
    </Screen>
  );
}

function CourseRow({ course, onPress }: { course: CourseListItem; onPress: () => void }) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const progress = course.lessonCount > 0
    ? Math.round((course.completedLessons / course.lessonCount) * 100)
    : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${course.title}. ${course.completedLessons} of ${course.lessonCount} lessons done.`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardHeader}>
        <Text numberOfLines={2} style={styles.cardTitle}>{course.title}</Text>
        <Text style={styles.role}>{course.role.toUpperCase()}</Text>
      </View>
      {course.description ? (
        <Text numberOfLines={2} style={styles.cardBody}>{course.description}</Text>
      ) : null}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <Text style={styles.meta}>
        {course.completedLessons} / {course.lessonCount} lessons · {course.memberCount}{" "}
        {course.memberCount === 1 ? "member" : "members"}
      </Text>
    </Pressable>
  );
}

function JoinCourseSheet({
  visible,
  onClose,
  onJoined,
}: {
  visible: boolean;
  onClose: () => void;
  onJoined: (courseId: string) => void;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [code, setCode] = useState("");
  const [needsTeacherConsent, setNeedsTeacherConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const joinController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCode("");
    setNeedsTeacherConsent(false);
    setError(null);
    setErrorCode(null);
  }, [visible]);

  useEffect(() => () => joinController.current?.abort(), []);

  const close = useCallback(() => {
    joinController.current?.abort();
    onClose();
  }, [onClose]);

  const submit = async (acceptTeacherAccess = false) => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    const controller = new AbortController();
    joinController.current?.abort();
    joinController.current = controller;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const snapshot = await joinCourse(trimmed, acceptTeacherAccess, { signal: controller.signal });
      if (controller.signal.aborted) return;
      onJoined(snapshot.course.id);
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      const errorCode = caught instanceof CourseApiError ? caught.code : null;
      if (errorCode === "course_teacher_access_consent_required") {
        setNeedsTeacherConsent(true);
        setError(null);
        setErrorCode(errorCode);
        return;
      }
      setErrorCode(errorCode);
      setError(errorCode === "notorganic_auth_adapter_unavailable"
        ? "Hosted course sign-in is unavailable on this server. Open Courses on the web to sign in or contact the server administrator."
        : caught instanceof CourseApiError
          ? caught.message
          : "Could not join this course. Check the code and try again.");
    } finally {
      if (joinController.current === controller) joinController.current = null;
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close join course" style={styles.scrim} onPress={close} />
        <View accessibilityViewIsModal accessibilityLabel="Join a course" style={styles.sheet}>
          <Text style={styles.sheetTitle}>Join a course</Text>
          <Text style={styles.sheetBody}>Paste the invite code your teacher or study group shared.</Text>
          <TextInput
            accessibilityLabel="Invite code"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            placeholder="Invite code"
            placeholderTextColor={theme.colors.textFaint}
            value={code}
            onChangeText={(value) => {
              setCode(value);
              setNeedsTeacherConsent(false);
              setError(null);
              setErrorCode(null);
            }}
            onSubmitEditing={() => void submit(false)}
            style={styles.input}
          />
          {needsTeacherConsent ? (
            <View style={styles.consentNotice} accessibilityRole="alert">
              <Text style={styles.consentTitle}>Teacher access at enrollment</Text>
              <Text style={styles.consentBody}>
                This managed course shares your current and future course work, tutoring threads,
                submissions, and progress with its teachers. This approval applies only to this course.
              </Text>
            </View>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          <View style={styles.sheetActions}>
            {needsTeacherConsent ? (
              <Button loading={busy} onPress={() => void submit(true)}>Approve and join</Button>
            ) : errorCode === "notorganic_auth_adapter_unavailable" ? (
              <Button variant="secondary" onPress={() => void Linking.openURL(PRODUCT_LINKS.courses)}>
                Open Courses on web
              </Button>
            ) : (
              <Button loading={busy} disabled={!code.trim()} onPress={() => void submit(false)}>Join course</Button>
            )}
            <Button variant="quiet" onPress={close}>Cancel</Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
    headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    loadingText: { ...type.caption, color: colors.textMuted },
    list: { gap: spacing.md, paddingBottom: spacing.xxl },
    card: {
      gap: spacing.sm,
      padding: spacing.lg,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cardPressed: { backgroundColor: colors.surfacePressed },
    cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
    cardTitle: { ...type.heading, flex: 1, color: colors.text },
    role: { ...type.caption, ...type.monoBold, color: colors.primaryText },
    cardBody: { ...type.body, color: colors.textMuted },
    progressTrack: {
      height: 6,
      marginTop: spacing.xs,
      borderRadius: radii.pill,
      backgroundColor: colors.backgroundDeep,
      overflow: "hidden",
    },
    progressFill: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.primary },
    meta: { ...type.caption, color: colors.textFaint },
    errorBanner: {
      gap: spacing.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.errorSurface,
    },
    errorText: { ...type.caption, color: colors.error },
    overlay: { flex: 1, justifyContent: "flex-end" },
    scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay },
    sheet: {
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xxl,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    sheetTitle: { ...type.heading, color: colors.text },
    sheetBody: { ...type.body, color: colors.textMuted },
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
    consentNotice: {
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.primaryStrong,
      backgroundColor: colors.surfaceRaised,
    },
    consentTitle: { ...type.label, color: colors.text },
    consentBody: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    sheetActions: { gap: spacing.sm },
  });
}
