import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Buttons";
import { TavusLiveCall } from "@/components/live/TavusLiveCall";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { buildMobileTavusContext } from "@/lib/tavus-live";
import { fetchCourse } from "@/lib/courses/client";
import type { CourseViewerSnapshot } from "@/lib/courses/types";
import { useKeating } from "@/state/KeatingProvider";
import { useNotOrganicAccount } from "@/state/NotOrganicAccountProvider";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().slice(0, limit);
}

export default function LiveScreen() {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const { colors } = theme;
  const keating = useKeating();
  const notOrganic = useNotOrganicAccount();
  const { courseId, lessonId } = useLocalSearchParams<{ courseId?: string; lessonId?: string }>();
  const [live, setLive] = useState(false);
  const [liveContext, setLiveContext] = useState<{ text: string; sessionId: string } | null>(null);
  const [course, setCourse] = useState<CourseViewerSnapshot | null>(null);
  const [courseLoading, setCourseLoading] = useState(Boolean(courseId));
  const accountReady = notOrganic.status === "signed-in"
    && notOrganic.session !== null
    && notOrganic.session.scope.split(/\s+/).includes("realtime:connect");

  useEffect(() => {
    if (!courseId) {
      setCourse(null);
      setCourseLoading(false);
      return;
    }
    const controller = new AbortController();
    setCourseLoading(true);
    void fetchCourse(courseId, { signal: controller.signal })
      .then((snapshot) => setCourse(snapshot))
      .catch(() => setCourse(null))
      .finally(() => {
        if (!controller.signal.aborted) setCourseLoading(false);
      });
    return () => controller.abort();
  }, [courseId]);

  const context = useMemo(() => buildMobileTavusContext({
    session: keating.activeSession,
    learnerContext: keating.learnerContext,
    learnerData: keating.learnerData,
    artifacts: keating.state.artifacts,
    course: course ? { snapshot: course, lessonId } : null,
  }), [course, keating.activeSession, keating.learnerContext, keating.learnerData, keating.state.artifacts, lessonId]);

  const executeTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    if (name === "deck") {
      const topic = requiredText(args.topic, "Deck topic", 240);
      const title = typeof args.title === "string" && args.title.trim() ? args.title.trim().slice(0, 180) : `${topic} review`;
      if (!Array.isArray(args.cards) || args.cards.length < 2 || args.cards.length > 24) throw new Error("A deck needs between 2 and 24 complete cards.");
      const cards = args.cards.map((value) => {
        const card = asRecord(value);
        if (!card) throw new Error("Every flashcard must include a front and back.");
        return {
          front: requiredText(card.front, "Flashcard front", 500),
          back: requiredText(card.back, "Flashcard back", 1_000),
          tags: Array.isArray(card.tags)
            ? card.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8).map((tag) => tag.slice(0, 60))
            : [topic],
        };
      });
      const deckId = await keating.createLearnerDeck(title, topic, cards);
      return `Saved ${cards.length} flashcards to ${title}. Deck id: ${deckId}.`;
    }
    if (name === "quiz") {
      const topic = requiredText(args.topic, "Quiz topic", 240);
      if (!Array.isArray(args.questions) || args.questions.length < 2 || args.questions.length > 10) throw new Error("A quiz needs between 2 and 10 complete questions.");
      const questions = args.questions.map((value) => {
        const question = asRecord(value);
        if (!question) throw new Error("Every quiz item must be complete.");
        return {
          question: requiredText(question.question, "Question", 500),
          correctAnswer: requiredText(question.correctAnswer, "Correct answer", 500),
          explanation: requiredText(question.explanation, "Explanation", 700),
          options: Array.isArray(question.options)
            ? question.options.filter((option): option is string => typeof option === "string").slice(0, 5)
            : undefined,
        };
      });
      const artifactId = keating.createLiveQuiz(topic, questions);
      return `Saved a ${questions.length}-question retrieval quiz for ${topic}. Artifact id: ${artifactId}.`;
    }
    if (name === "due") {
      const now = Date.now();
      const due = keating.learnerData?.decks.flatMap((deck) => deck.cards
        .filter((card) => Date.parse(card.srs.dueAt) <= now)
        .map(() => deck.title)) ?? [];
      const unique = [...new Set(due)].slice(0, 8);
      return due.length
        ? `${due.length} cards are due across: ${unique.join(", ")}.`
        : "No flashcards are currently due.";
    }
    if (name === "learner_state") {
      const profile = keating.learnerData?.learnerProfile;
      if (!profile) return "Learner evidence is still loading.";
      return {
        sessions: profile.sessionsCount,
        topics: profile.topicsExplored.slice(-8),
        strengths: profile.strengths.slice(0, 8),
        needsReview: profile.weaknesses.slice(0, 8),
        activeGoals: keating.learnerData?.goals.filter((goal) => goal.steps.some((step) => step.status !== "done")).slice(0, 6).map((goal) => goal.title) ?? [],
      };
    }
    throw new Error(`Tool ${name} is not available in Keating Live.`);
  }, [keating]);

  const endLive = useCallback(() => {
    setLive(false);
    setLiveContext(null);
  }, []);

  if (live && liveContext) {
    return (
      <Screen title="Live with KeatingBot" subtitle="Your video, tools, and transcript stay inside Keating" scroll={false}>
        <TavusLiveCall
          conversationalContext={liveContext.text}
          executeTool={executeTool}
          onTranscriptComplete={(turns) => keating.preserveLiveConversation(turns, liveContext.sessionId)}
          onEnded={endLive}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Live" subtitle="Talk to Keating and show what you are working on">
      <View style={styles.hero}>
        <Image
          accessible={false}
          accessibilityIgnoresInvertColors
          source={require("../../../assets/brand/mascot-head-v2.png")}
          style={styles.mascot}
          resizeMode="contain"
        />
        <Text style={styles.heading}>Live with Keating</Text>
        <Text style={styles.body}>Talk face to face with KeatingBot while it works from your current lesson and learning history.</Text>
      </View>

      <View style={styles.status}>
        <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>A continuous Keating lesson</Text>
          <Text style={styles.statusBody}>
            KeatingBot receives a bounded dossier of this lesson, your learner-provided context, goals, and relevant artifacts. The final transcript returns to Tutor when you end the call.
          </Text>
        </View>
      </View>

      <View style={styles.capabilities}>
        <View style={styles.capability}><Ionicons name="videocam-outline" size={18} color={colors.text} /><Text style={styles.capabilityText}>Native voice and PAL video</Text></View>
        <View style={styles.capability}><Ionicons name="phone-portrait-outline" size={18} color={colors.text} /><Text style={styles.capabilityText}>Camera and screen sharing</Text></View>
        <View style={styles.capability}><Ionicons name="albums-outline" size={18} color={colors.text} /><Text style={styles.capabilityText}>Flashcard and quiz tools</Text></View>
      </View>

		{!accountReady ? (
			<View style={styles.accountGate}>
				<Ionicons name="person-circle-outline" size={22} color={colors.primary} />
				<View style={styles.statusCopy}>
					<Text style={styles.statusTitle}>Not Organic account needed</Text>
					<Text style={styles.statusBody}>Sign in before starting KeatingBot so the Tavus conversation is bound to your account and device.</Text>
					{notOrganic.error ? <Text style={styles.accountError}>{notOrganic.error}</Text> : null}
					<Button
						loading={notOrganic.status === "loading" || notOrganic.status === "authorizing"}
						disabled={notOrganic.status === "loading" || notOrganic.status === "authorizing"}
						onPress={() => void notOrganic.login()}
					>
						Sign in to Not Organic
					</Button>
				</View>
			</View>
		) : null}

      {course ? (
        <View style={styles.courseContext}>
          <Text style={styles.courseEyebrow}>CURRENT COURSE</Text>
          <Text style={styles.courseTitle}>{course.course.title}</Text>
          <Text style={styles.courseSummary}>KeatingBot will receive this course, its active lesson, objectives, reading excerpt, and relevant materials.</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
			disabled={courseLoading || !accountReady}
          loading={courseLoading}
			onPress={() => {
				if (!accountReady) return;
            setLiveContext({ text: context, sessionId: keating.activeSession.id });
            setLive(true);
          }}
        >
          Start Live
        </Button>
        <Text style={styles.privacy}>Camera and microphone permission are requested only after you start. Starting creates a Tavus conversation that ends when you tap End.</Text>
      </View>
    </Screen>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    hero: { alignItems: "center", paddingVertical: spacing.lg },
    mascot: { width: 112, height: 112 },
    heading: { ...type.heading, marginTop: spacing.lg, color: colors.text },
    body: { ...type.body, maxWidth: 500, marginTop: spacing.sm, color: colors.textMuted, textAlign: "center" },
    status: {
      flexDirection: "row",
      gap: spacing.md,
      marginVertical: spacing.xl,
      paddingVertical: spacing.lg,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    statusCopy: { flex: 1, minWidth: 0 },
    statusTitle: { ...type.label, color: colors.text },
    statusBody: { ...type.body, marginTop: spacing.xs, color: colors.textMuted },
    capabilities: {
      gap: spacing.sm,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
    },
		accountGate: {
			flexDirection: "row",
			gap: spacing.md,
			padding: spacing.lg,
			borderRadius: radii.lg,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.surfaceRaised,
		},
		accountError: { ...type.caption, marginTop: spacing.xs, color: colors.error },
    capability: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    capabilityText: { ...type.body, color: colors.text },
    courseContext: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, gap: spacing.xs },
    courseEyebrow: { ...type.monoBold, ...type.caption, color: colors.primaryText },
    courseTitle: { ...type.heading, color: colors.text },
    courseSummary: { ...type.body, color: colors.textMuted },
    actions: { gap: spacing.md },
    privacy: { ...type.caption, color: colors.textMuted, textAlign: "center" },
  });
}
