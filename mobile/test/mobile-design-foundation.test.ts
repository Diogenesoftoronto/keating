import { expect, test } from "bun:test";
import { keatingDesignContract } from "@keating/design-contract";

test("design contract supplies complete semantic anchors for native light and dark themes", () => {
  for (const name of ["light", "dark"] as const) {
    const contract = keatingDesignContract.themes[name].colors;
    expect(contract.surface).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contract.surfaceRaised).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contract.text).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contract.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contract.danger).toMatch(/^#[0-9a-f]{6}$/i);
  }
});

test("native foundation projects contract semantics and 44dp shared targets", async () => {
  const theme = await Bun.file("src/constants/theme.ts").text();
  const themeContract = await Bun.file("src/constants/theme-contract.ts").text();
  const buttons = await Bun.file("src/components/Buttons.tsx").text();
  expect(themeContract).toContain("background: colors.surface");
  expect(themeContract).toContain("surface: colors.surfaceRaised");
  expect(themeContract).toContain("primary: colors.accent");
  expect(themeContract).toContain("error: colors.danger");
  expect(theme).toContain("radiiDp.control");
  expect(theme).toContain("radiiDp.panel");
  expect(buttons).toContain("minHeight: 44");
  expect(keatingDesignContract.native.minimumTouchTargetDp).toBe(44);
});

test("native interactive and danger states remain visually distinct in both themes", async () => {
  const { projectNativeTheme } = await import("../src/constants/theme-contract");
  for (const name of ["light", "dark"] as const) {
    const { colors } = projectNativeTheme(name);
    expect(colors.surfaceRaised).not.toBe(colors.surface);
    expect(colors.surfacePressed).not.toBe(colors.surface);
    expect(colors.surfacePressed).not.toBe(colors.surfaceRaised);
    expect(colors.primaryStrong).not.toBe(colors.primary);
    expect(colors.errorSurface).not.toBe(colors.backgroundDeep);
    expect(colors.userBubble).not.toBe(colors.backgroundDeep);
  }
});

test("native shell references canonical Keating identity rather than legacy owl artwork", async () => {
  const root = await Bun.file("src/app/_layout.tsx").text();
  const tabs = await Bun.file("src/app/(tabs)/_layout.tsx").text();
  const tutor = await Bun.file("src/app/(tabs)/index.tsx").text();
  const app = await Bun.file("app.json").json() as {
    expo: { icon: string; userInterfaceStyle: string; android: { adaptiveIcon: { foregroundImage: string } } };
  };
  expect(root).toContain("assets/brand/logo-lockup.png");
  expect(tutor).toContain("assets/brand/logo-lockup.png");
  expect(tutor).toContain("assets/brand/mascot-head-v2.png");
  expect(tabs).toContain("assets/brand/mascot-head-v2.png");
  expect(tabs).not.toContain("sparkles-outline");
  expect(root).not.toContain("keating-mark");
  expect(tutor).not.toContain("introMark");
  expect(app.expo.icon).toBe("./assets/brand/app-icon.png");
  expect(app.expo.android.adaptiveIcon.foregroundImage).toBe("./assets/brand/adaptive-icon.png");
  expect(app.expo.userInterfaceStyle).toBe("automatic");
});

test("mobile model selector occupies the web-equivalent header location", async () => {
  const tutor = await Bun.file("src/app/(tabs)/index.tsx").text();
  const selector = await Bun.file("src/components/ModelSelectorSheet.tsx").text();
  const catalog = await Bun.file("src/lib/model-catalog.ts").text();
  const header = tutor.indexOf("style={styles.header}>");
  const modelSelector = tutor.indexOf("Change model. Current model:");
  const composer = tutor.indexOf("<Composer");
  expect(header).toBeGreaterThan(-1);
  expect(modelSelector).toBeGreaterThan(header);
  expect(modelSelector).toBeLessThan(composer);
  expect(tutor).toContain('name="chevron-down"');
  expect(tutor).toContain("setModelSelectorOpen(true)");
  expect(tutor).toContain("<ModelSelectorSheet");
  expect(selector).toContain("Search by model, ID, or provider");
  expect(selector).toContain("MODEL_CAPABILITY_FILTERS");
  expect(selector).toContain("getRecentModelKeys");
  expect(selector).toContain("refreshModelsDevCatalog");
  expect(selector).toContain("Couldn’t refresh models.dev");
  expect(selector).toContain("refreshController.current?.abort()");
  expect(tutor).toContain("selectionDisabled={isGenerating}");
  expect(catalog).toContain('https://models.dev/api.json');
  expect(tutor).not.toContain("styles.modelLabel");
});

test("Tutor exposes a bounded header swipe to the visible Sessions destination", async () => {
  const tutor = await Bun.file("src/app/(tabs)/index.tsx").text();
  expect(tutor).toContain("PanResponder.create");
  expect(tutor).toContain("gesture.dx <= -72");
  expect(tutor).toContain('router.push("/sessions")');
  expect(tutor).toContain("<View {...swipeToSessions.panHandlers} style={styles.header}>");
});

test("mobile session controls are explicit siblings and forks expose lineage", async () => {
  const tutor = await Bun.file("src/app/(tabs)/index.tsx").text();
  const sessions = await Bun.file("src/app/(tabs)/sessions.tsx").text();
  const messages = await Bun.file("src/components/MessageBubble.tsx").text();
  expect(tutor).toContain('activeSession.title !== "New lesson"');
  expect(tutor).toContain("Forked from");
  expect(tutor).toContain("Open original");
  expect(messages).toContain("Fork lesson from this response");
  expect(messages).toContain("Fork here");
  expect(tutor).toContain("forkDisabled={isGenerating}");
  expect(sessions).toContain("buildSessionTreeRows");
  expect(sessions).toContain("Forked from");
  expect(sessions).toMatch(/>\s*Open\s*<\/Button>/);
  expect(sessions).toMatch(/>\s*Fork\s*<\/Button>/);
  expect(sessions).toMatch(/>\s*Delete\s*<\/Button>/);
  expect(sessions).toContain(">CURRENT</Text>");
  expect(sessions).not.toContain("event.stopPropagation()");
});

test("additive session lineage migrates persisted mobile state to schema two", async () => {
  const types = await Bun.file("src/lib/types.ts").text();
  const storage = await Bun.file("src/lib/storage.ts").text();
  const migration = await Bun.file("src/lib/persisted-state.ts").text();
  const provider = await Bun.file("src/state/KeatingProvider.tsx").text();
    expect(types).toContain("schemaVersion: 4");
  expect(types).toContain("parentSessionId?: string");
  expect(storage).toContain("migratePersistedState");
  expect(storage).toContain("It was preserved and not overwritten");
  expect(migration).toContain("candidate.schemaVersion === 1");
    expect(migration).toContain("schemaVersion: 4");
    expect(provider).toContain("schemaVersion: 4");
  expect(provider).toContain("!hydrated || !persistenceReady");
});

test("generation locks before credential I/O and keeps forks out of partial turns", async () => {
  const provider = await Bun.file("src/state/KeatingProvider.tsx").text();
  const completionStart = provider.indexOf("const runCompletion");
  const lock = provider.indexOf("generationBusyRef.current = true", completionStart);
  const credentialRead = provider.indexOf("await getProviderKey", completionStart);
  const forkGuard = provider.indexOf("if (generationBusyRef.current) return null", credentialRead);
  expect(completionStart).toBeGreaterThan(-1);
  expect(lock).toBeGreaterThan(completionStart);
  expect(credentialRead).toBeGreaterThan(lock);
  expect(provider.indexOf("const controller = new AbortController()", completionStart)).toBeLessThan(credentialRead);
  expect(provider.indexOf("if (controller.signal.aborted)", credentialRead)).toBeGreaterThan(credentialRead);
  expect(forkGuard).toBeGreaterThan(credentialRead);
  expect(provider).toContain("if ((!trimmed && attachments.length === 0) || generationBusyRef.current) return");
  expect(provider).toContain("if (generationBusyRef.current) return;");
});

test("bottom navigation exposes the four primary mobile destinations", async () => {
  const tabs = await Bun.file("src/app/(tabs)/_layout.tsx").text();
  for (const route of ["index", "sessions", "courses", "more"]) {
    expect(tabs).toContain(`name="${route}"`);
  }
  // Live, the library, and settings stay routable but off the tab bar. Live is
  // entered from the composer so a voice session inherits the open lesson.
  for (const route of ["live", "artifacts", "settings"]) {
    expect(tabs).toContain(`name="${route}"`);
  }
  expect(tabs.match(/options=\{\{ href: null \}\}/g)?.length).toBe(3);
});

test("live is reachable from the composer rather than the tab bar", async () => {
  const tutor = await Bun.file("src/app/(tabs)/index.tsx").text();
  const composer = await Bun.file("src/components/Composer.tsx").text();
  expect(tutor).toContain('onStartLive={() => router.push("/live")}');
  expect(composer).toContain('>Live</Text>');
});

test("secondary mobile destinations use canonical, recoverable product links", async () => {
  const { PRODUCT_LINKS } = await import("../src/lib/product-links");
  const more = await Bun.file("src/app/(tabs)/more.tsx").text();
  const live = await Bun.file("src/app/(tabs)/live.tsx").text();
  expect(PRODUCT_LINKS.courses).toBe("https://keating.help/courses");
  expect(PRODUCT_LINKS.live).toBe("https://keating.help/live");
  expect(PRODUCT_LINKS.credits).toBe("https://keating.help/pricing");
  expect(PRODUCT_LINKS.tutorial).toBe("https://keating.help/tutorial");
  expect(more).toContain("Buy tokens / credits");
  expect(more).toContain("Tutorial");
  expect(more).toContain("Manual");
  expect(live).toContain("Native Live is not available in this build");
  expect(live).toContain("remain required before mobile reaches feature parity");
});

test("courses reads the course API natively and names what stays on the web", async () => {
  const courses = await Bun.file("src/app/(tabs)/courses.tsx").text();
  const detail = await Bun.file("src/app/course/[id].tsx").text();
  expect(courses).toContain("fetchCourses");
  expect(courses).toContain("fetchCoursesForCurrentAccount");
  expect(courses).toContain("joinCourse");
  // Joining starts private. Only the server's managed-course challenge can
  // expose the explicit approval action.
  expect(courses).toContain("acceptTeacherAccess");
  expect(courses).toContain("course_teacher_access_consent_required");
  expect(courses).toContain("Approve and join");
  expect(detail).toContain("fetchCourse");
  expect(detail).toContain("shareCourseMaterial");
  expect(detail).toContain("Study this with Keating");
  expect(detail).toContain("Course building, discussion, and review happen in the web workspace.");
});

test("Usage exposes confirmed, recoverable, secret-free portable learning-data controls", async () => {
  const usage = await Bun.file("src/app/usage.tsx").text();
  const provider = await Bun.file("src/state/KeatingProvider.tsx").text();
  expect(usage).toContain("Portable learning data");
  expect(usage).toContain("Export JSON");
  expect(usage).toContain("Choose JSON to import");
  expect(usage).toContain("Ready to merge");
  expect(usage).toContain("Merge import");
  expect(usage).toContain("Import merges rather than replaces");
  expect(usage).toContain("never includes API keys");
  expect(usage).toContain("attachment files, device URIs, or file bytes");
  expect(usage).toContain('accessibilityRole="alert"');
  expect(usage).toContain("Clear learning data?");
  expect(provider).toContain("reconcileNativeStateIntoPortable");
  expect(provider).toContain("beginClear(intent)");
  expect(provider).toContain("resumePendingLearningDataClear");
});

test("Usage exposes a provenance-rich, redacted fine-tuning archive", async () => {
  const usage = await Bun.file("src/app/usage.tsx").text();
  expect(usage).toContain("Fine-tuning export");
  expect(usage).toContain("Export training ZIP");
  expect(usage).toContain("canonical provenance-rich JSONL");
  expect(usage).toContain("Explicitly missed responses stay out of positive supervised fine-tuning data");
  expect(usage).toContain("Unscored responses remain labelled unscored");
  expect(usage).toContain("manifest, schema, and dataset card");
});

test("Usage exposes actual benchmark and policy-evolution history without inferred scores", async () => {
  const usage = await Bun.file("src/app/usage.tsx").text();
  const chart = await Bun.file("src/components/usage/SelfEvolutionChart.tsx").text();
  expect(usage).toContain("Self-evolution health");
  expect(usage).toContain("scores from actual benchmark and policy-evolution runs");
  expect(usage).toContain("never derives them from lesson titles");
  expect(chart).toContain("Latest benchmark");
  expect(chart).toContain("Latest evolution");
  expect(chart).toContain("Benchmark scores");
  expect(chart).toContain("Evolved policy scores");
});

test("Learn is a first-class surface and Tutor cards commit durable learner evidence before success UI", async () => {
  const more = await Bun.file("src/app/(tabs)/more.tsx").text();
  const learn = await Bun.file("src/app/learn.tsx").text();
  const review = await Bun.file("src/app/review.tsx").text();
  const deckEditor = await Bun.file("src/app/deck-editor.tsx").text();
  const content = await Bun.file("src/components/MessageContent.tsx").text();
  const quiz = await Bun.file("src/components/cards/QuizCard.tsx").text();
  const questions = await Bun.file("src/components/cards/QuestionCard.tsx").text();
  const goals = await Bun.file("src/components/cards/GoalCard.tsx").text();
  const provider = await Bun.file("src/state/KeatingProvider.tsx").text();

  expect(more).toContain("Learn & Coming Up");
  expect(more).toContain('router.push("/learn" as never)');
  expect(more).toContain('router.push("/usage" as never)');
  expect(learn).toContain("buildLearnerProgress");
  expect(learn).toContain("buildComingUp");
  expect(learn).toContain("setLearnerStudyPriority");
  expect(review).toContain("buildReviewQueue");
  expect(review).toContain("recordLearnerCardReview");
  expect(learn).toContain('router.push("/deck-editor" as never)');
  expect(deckEditor).toContain("createLearnerDeck");
  expect(deckEditor).toContain("Your draft is still here");
  expect(deckEditor).toContain("Anki package transfer is not available");
  expect(deckEditor.indexOf("await learner.createLearnerDeck")).toBeLessThan(deckEditor.indexOf("router.replace"));

  expect(content).toContain("portableGoalFromInteractive");
  expect(content).toContain("portableQuizResultFromInteractive");
  expect(content).toContain("portableQuestionChecksFromInteractive");
  expect(content).toContain('interactiveRecordId("goal", key, 0)');
  expect(content).toContain('interactiveRecordId("quiz", key, 0)');
  expect(content).toContain('interactiveRecordId("question-check", key, questionIndex)');
  expect(quiz).toContain("initialState");
  expect(questions).toContain("initialState");
  expect(goals).toContain("initialStatuses");
  expect(provider).toContain("ensureLearnerGoalData");
  expect(provider).toContain("updateGoalStepData(ensured");
  expect(provider).toContain("appendQuizResultData");
  expect(provider).toContain("appendQuestionChecksData");
  expect(quiz.indexOf("await onSubmit")).toBeLessThan(quiz.indexOf("submitted: true"));
  expect(questions.indexOf("await onSubmit")).toBeLessThan(questions.indexOf("submitted: true"));
  const goalCycle = goals.slice(goals.indexOf("const cycle"), goals.indexOf("const report"));
  expect(goalCycle.indexOf("await onStepStatusChange")).toBeLessThan(goalCycle.indexOf("writeCardState"));
  expect(quiz).toContain("Your answers are still here; try again.");
  expect(questions).toContain("They are still here; try again.");
});

test("empty, thinking, and assessment states use the shared product vocabulary", async () => {
  const empty = await Bun.file("src/components/EmptyState.tsx").text();
  const messages = await Bun.file("src/components/MessageBubble.tsx").text();
  const questions = await Bun.file("src/components/cards/QuestionCard.tsx").text();
  expect(empty).toContain("assets/brand/logo-lockup.png");
  expect(empty).not.toContain(">K</Text>");
  expect(messages).toContain("isReduceMotionEnabled");
  expect(questions).not.toContain("borderLeftWidth");
  expect(questions).toContain("backgroundColor: colors.surface");
});

test("representative learner surfaces consume the dynamic native theme", async () => {
  const files = [
    "src/app/(tabs)/sessions.tsx",
    "src/app/(tabs)/artifacts.tsx",
    "src/app/(tabs)/settings.tsx",
    "src/components/MarkdownText.tsx",
    "src/components/cards/GoalCard.tsx",
    "src/components/cards/QuestionCard.tsx",
    "src/components/cards/QuizCard.tsx",
  ];
  for (const file of files) {
    const source = await Bun.file(file).text();
    expect(source).toContain("useKeatingTheme");
    expect(source).not.toMatch(/import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*["']@\/constants\/theme["']/s);
  }
});
