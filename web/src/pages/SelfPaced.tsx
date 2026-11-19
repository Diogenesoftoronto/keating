import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { KeatingGlyph } from "../design-system/glyphs";
import { KeatingBot } from "../components/KeatingBot";
import { AppBar, Button, ButtonLink, Card, Chip, EmptyState, Loading, ConfirmDialog, Field, IconButton, Kbd, Menu, Note, Prose, TextArea, TextInput } from "../design-system/kit";
import { Meter, Progress } from "../design-system/charts";
import { LessonFrame } from "../components/lesson/LessonFrame";
import { fireCompletionConfetti } from "../components/flashcards/review-feedback";
import { scrollBehavior } from "../lib/motion";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { useSeo } from "../hooks/useSeo";
import { downloadTextFile } from "../lib/browser-download";
import { browserComplete } from "../keating/self-paced/agent";
import {
	ACTIVITY_LABELS,
	COURSE_LIMITS,
	EVIDENCE_LABELS,
	activityFingerprint,
	completionCondition,
	courseProgress,
	exportCourseMarkdown,
	summarizeCourse,
	validateCourseSource,
	type ActivityMaterial,
	type ActivityProgress,
	type CourseEvidence,
	type SelfPacedCourse,
} from "../keating/self-paced/contract";
import {
	editCoursePlan,
	markAnswer,
	proposeCourse,
	raiseCourseBudget,
	recordRead,
	setActivitySkipped,
	startCourse,
	submitAnswer,
} from "../keating/self-paced/controller";
import { cancelQueuedJobs, describeQueue, enqueueCoursePreparation, retryFailedJobs, runCoursePreparation, type PrepJob } from "../keating/self-paced/jobs";
import { SELF_PACED_CHANGED_EVENT, selfPacedStore } from "../keating/self-paced/store";
import { EvidenceCounts, activityGlyph } from "../components/self-paced/progress";
import "./self-paced.css";

const store = () => selfPacedStore();

function useNow(intervalMs = 30_000): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}

function when(at: number, now: number): string {
	const minutes = Math.max(1, Math.round((at - now) / 60_000));
	if (minutes < 60) return `in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `in about ${hours} ${hours === 1 ? "hour" : "hours"}`;
	return `on ${new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`;
}

/** An answer being written is kept for this tab, so a reload or a slip of the hand does not lose it. */
const draftKey = (courseId: string, questionId: string) => `keating:self-paced-answer:${courseId}:${questionId}`;
function readAnswerDraft(courseId: string, questionId: string): string {
	try { return sessionStorage.getItem(draftKey(courseId, questionId)) ?? ""; } catch { return ""; }
}
function writeAnswerDraft(courseId: string, questionId: string, value: string): void {
	try {
		if (value) sessionStorage.setItem(draftKey(courseId, questionId), value);
		else sessionStorage.removeItem(draftKey(courseId, questionId));
	} catch { /* The answer is still on screen. */ }
}

function errorText(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

/** Reloads whenever any tab changes course data, so two open tabs agree. */
function useCourseData(courseId: string | undefined) {
	const [state, setState] = useState<{ course?: SelfPacedCourse; evidence: CourseEvidence[]; materials: ActivityMaterial[]; jobs: PrepJob[]; loaded: boolean; error?: string }>({ evidence: [], materials: [], jobs: [], loaded: false });
	const load = useCallback(async () => {
		if (!courseId) return;
		try {
			const [course, evidence, materials, jobs] = await Promise.all([store().getCourse(courseId), store().listEvidence(courseId), store().listMaterials(courseId), store().listJobs(courseId)]);
			setState({ course, evidence, materials, jobs, loaded: true });
		} catch (error) {
			setState((current) => ({ ...current, loaded: true, error: errorText(error, "Your course could not be read from this device.") }));
		}
	}, [courseId]);
	useEffect(() => {
		void load();
		window.addEventListener(SELF_PACED_CHANGED_EVENT, load);
		return () => window.removeEventListener(SELF_PACED_CHANGED_EVENT, load);
	}, [load]);
	return { ...state, reload: load };
}

export function SelfPacedIndex() {
	useSeo({ title: "Self-paced courses · Keating", description: "Short courses on one paper or topic, prepared for you and worked through at your own pace." });
	const navigate = useNavigate();
	const [courses, setCourses] = useState<SelfPacedCourse[] | null>(null);
	const [loadError, setLoadError] = useState("");
	const [title, setTitle] = useState("");
	const [url, setUrl] = useState("");
	const [excerpt, setExcerpt] = useState("");
	const [goal, setGoal] = useState("");
	const [background, setBackground] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [showForm, setShowForm] = useState(false);
	const [steps, setSteps] = useState<Record<string, ReturnType<typeof summarizeCourse>>>({});
	const abort = useRef<AbortController | null>(null);

	const load = useCallback(() => {
		store().listCourses().then((list) => {
			setCourses(list);
			setLoadError("");
			// Progress on each row is a nicety: if it cannot be read, the list still shows.
			void Promise.all(list.filter((course) => course.status !== "draft").map(async (course) =>
				[course.id, summarizeCourse(courseProgress(course, await store().listEvidence(course.id), Date.now()))] as const))
				.then((entries) => setSteps(Object.fromEntries(entries))).catch(() => {});
		}).catch((problem) => { setCourses([]); setLoadError(errorText(problem, "Your courses could not be read from this device.")); });
	}, []);
	useEffect(() => {
		load();
		window.addEventListener(SELF_PACED_CHANGED_EVENT, load);
		return () => { window.removeEventListener(SELF_PACED_CHANGED_EVENT, load); abort.current?.abort(); };
	}, [load]);

	const create = async () => {
		setError("");
		let source;
		try {
			source = validateCourseSource({ kind: url.trim() || excerpt.trim() ? "paper" : "topic", title, url, excerpt });
		} catch (problem) {
			setError(errorText(problem, "Check the source details."));
			return;
		}
		setBusy(true);
		abort.current = new AbortController();
		try {
			const course = await proposeCourse(store(), { source, goal, background }, browserComplete(), { signal: abort.current.signal });
			void navigate({ to: "/learn/$courseId", params: { courseId: course.id } });
		} catch (problem) {
			if (!abort.current.signal.aborted) setError(errorText(problem, "The plan could not be drafted. Try again."));
		} finally {
			setBusy(false);
		}
	};

	const hasCourses = (courses?.length ?? 0) > 0;
	return <div className="self-paced-page">
		<AppBar title="Self-paced courses" />
		<main className="sp-main">
			<header className="sp-intro k-halftone k-green">
				<KeatingBot size={40} state="greeting" label="" />
				<div><h1>Study one thing at your own pace</h1>
					<p>Bring a paper or name a topic. Keating drafts a plan you approve.</p></div>
			</header>
			{hasCourses && <Button glyph="plus" aria-expanded={showForm} aria-controls="new-course-form" onClick={() => setShowForm(!showForm)}>Start another course</Button>}
			{courses !== null && (!hasCourses || showForm) && <Card as="section" id="new-course-form" aria-labelledby="new-course-heading">
				<h2 id="new-course-heading">Start a course</h2>
				<form onSubmit={(event) => { event.preventDefault(); void create(); }}>
					<Field label="Paper or topic"><TextInput id="sp-topic" required maxLength={200} autoFocus={hasCourses} value={title} onChange={e => setTitle(e.target.value)} placeholder="For example: Attention Is All You Need" /></Field>
					<div className="sp-columns">
						<Field label="Link (optional)"><TextInput type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://arxiv.org/abs/…" /></Field>
						<Field label="What you already know (optional)"><TextArea rows={1} maxLength={600} value={background} onChange={e => setBackground(e.target.value)} /></Field>
					</div>
					<details><summary>Text to study from (optional)</summary>
						<Field label="Source text" hint="Keating uses the text you paste. Without it, materials draw on the model’s knowledge. Keating does not open the link.">
							<TextArea rows={4} maxLength={COURSE_LIMITS.excerpt} value={excerpt} onChange={e => setExcerpt(e.target.value)} placeholder="Paste the abstract and sections you want to learn." />
						</Field>
					</details>
					<Field label="What do you want to be able to do?"><TextArea rows={2} maxLength={600} value={goal} onChange={e => setGoal(e.target.value)} placeholder="For example: implement one attention head and explain why it is scaled." /></Field>
					{error && <Note role="alert" tone="warn">{error}</Note>}
					<div className="sp-footer">
						<small>Drafting uses your Chat model and up to 2,400 output tokens. Input and output count toward your {COURSE_LIMITS.defaultTokenBudget.toLocaleString()}-token course limit.</small>
						{busy && <Button variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button>}
						<Button type="submit" variant="primary" glyph={busy ? "spin" : "route"} busy={busy} disabled={!title.trim()}>{busy ? "Drafting your plan…" : "Draft a plan"}</Button>
					</div>
					{busy && <Loading label="Reading the source and sketching a plan. You will review it before anything else is prepared." />}
				</form>
			</Card>}
			<section aria-labelledby="your-courses-heading">
				<h2 id="your-courses-heading">Your courses</h2>
				{loadError ? <div className="sp-empty"><KeatingBot size={40} state="thinking" label="" /><p role="alert">{loadError}</p><Button onClick={load}>Try again</Button></div>
					: courses === null ? <div className="sp-empty"><Loading label="Loading your courses…" /><ButtonLink to="/chat" variant="ghost">Back to Chat</ButtonLink></div>
					: !hasCourses ? <EmptyState heading="Nothing on the desk yet." glyph="book" actions={<Button variant="ghost" onClick={() => document.getElementById("sp-topic")?.focus()}>Start a course</Button>}>Courses you start are kept on this device.</EmptyState>
					: <ul className="sp-library">{courses.map(course => {
						const summary = steps[course.id];
						const draft = course.status === "draft";
						const complete = course.status === "completed";
						const action = draft ? "Review plan" : complete ? "Open" : "Continue";
						return <li key={course.id}>
							<div><strong>{course.title}</strong><small>{draft ? "Plan drafted · waiting for you to approve" : complete ? "Complete · review your work" : summary?.next ? `In progress · next: ${summary.next.activity.title}` : summary?.nextAvailableAt ? `In progress · next activity opens ${when(summary.nextAvailableAt, Date.now())}` : "In progress"}
								{" · "}{course.activities.length} activities · {course.source.title}</small></div>
							<div>{draft ? <Chip>Draft</Chip> : summary && <Progress done={summary.done} total={summary.total} label="Activities completed" />}</div>
							<ButtonLink to={`/learn/${encodeURIComponent(course.id)}`} variant={draft ? "line" : complete ? "ghost" : "primary"} size="sm" aria-label={`${action}: ${course.title}`}>{action}</ButtonLink>
						</li>;
					})}</ul>}
			</section>
		</main>
	</div>;
}

function PreparationPanel({ course, jobs, materials, onChanged }: { course: SelfPacedCourse; jobs: PrepJob[]; materials: ActivityMaterial[]; onChanged: () => void }) {
	const queue = describeQueue(course, jobs);
	const [running, setRunning] = useState(false);
	const [paused, setPaused] = useState(false);
	const [note, setNote] = useState("");
	const abort = useRef<AbortController | null>(null);
	const pending = queue.queued + queue.running + (queue.blocked ? 0 : queue.failed);

	const run = useCallback(async () => {
		if (abort.current) return;
		const controller = new AbortController();
		abort.current = controller;
		setRunning(true); setNote("");
		try {
			const complete = browserComplete();
			const outcome = await runCoursePreparation({
				store: store(), courseId: course.id, signal: controller.signal,
				prepare: async (current, activity, signal) => (await import("../keating/self-paced/agent")).prepareActivityMaterial(current, activity, complete, { signal }),
			});
			if (outcome === "busy") setNote("Another Keating tab is preparing this course.");
		} catch (error) {
			setNote(errorText(error, "Preparation stopped unexpectedly."));
		} finally {
			abort.current = null;
			setRunning(false);
			onChanged();
		}
	}, [course.id, onChanged]);

	// Work the queue whenever there is something to do and nothing stops it.
	useEffect(() => {
		if (course.status === "active" && pending > 0 && !paused && !queue.overBudget && !queue.blocked && !abort.current) void run();
	}, [course.status, pending, paused, queue.overBudget, queue.blocked, run]);
	useEffect(() => () => abort.current?.abort(), []);

	if (course.status !== "active") return null;
	// "Prepared" means a current material exists, whatever happened to the job that made it.
	const wanted = course.activities.filter((activity) => !activity.skipped);
	const total = wanted.length;
	const ready = wanted.filter((activity) => materials.some((material) => material.activityId === activity.id && material.fingerprint === activityFingerprint(course, activity))).length;
	const used = course.budget.usedTokens, max = course.budget.maxTokens;

	return <Card as="section" className="sp-panel" aria-labelledby="prep-heading">
		<h2 className="k-halftone" id="prep-heading">Preparation</h2>
		<p role="status" aria-live="polite">
			{queue.blocked ? "Preparation is paused because of a problem."
				: queue.overBudget ? "Preparation is paused: this course reached its limit."
				: ready >= total ? `All ${total} activities are prepared.`
				: pending === 0 ? `${ready} of ${total} activities are prepared. Preparation is stopped.`
				: paused ? `Paused. ${ready} of ${total} activities prepared.`
				: `Preparing in the background: ${ready} of ${total} ready. You can start on what is ready, or leave this page; it continues whenever Keating is open.`}
		</p>
		<div><small>Activities ready</small><Meter live={running && !paused && ready < total && !queue.blocked && !queue.overBudget} label="Activities ready" value={ready} max={total} valueText={`${ready} of ${total}`} /></div>
		<div><small>Token budget</small><Meter tone="ink" label="Tokens used" value={used} max={max} valueText={`${used.toLocaleString()} of ${max.toLocaleString()}`} /></div>
		<p className="self-paced__hint">Preparation never goes past the limit without asking.</p>
		{queue.blocked && <p className="self-paced__alert" role="alert">{queue.blocked}</p>}
		{note && <p className="self-paced__hint" role="status">{note}</p>}
		<div className="self-paced__actions">
			{queue.blocked && <Button type="button" variant="primary" onClick={() => void retryFailedJobs(store(), course.id, Date.now()).then(onChanged)}><KeatingGlyph name="refresh" size={14} /> Try again</Button>}
			{queue.overBudget && <Button type="button" variant="primary" onClick={() => void raiseCourseBudget(store(), course.id, COURSE_LIMITS.defaultTokenBudget).then(onChanged)}>Allow {COURSE_LIMITS.defaultTokenBudget.toLocaleString()} more tokens</Button>}
			{pending > 0 && !queue.blocked && !queue.overBudget && (paused
				? <Button type="button" variant="line" onClick={() => setPaused(false)}><KeatingGlyph name="play" size={14} /> Resume</Button>
				: <Button type="button" variant="line" onClick={() => { setPaused(true); abort.current?.abort(); }}><KeatingGlyph name="pause" size={14} /> Pause</Button>)}
			{pending > 0 && <Button type="button" variant="line" onClick={() => { setPaused(true); abort.current?.abort(); void cancelQueuedJobs(store(), course.id, Date.now()).then(onChanged); }}>Stop preparing</Button>}
			{pending === 0 && ready < total && !queue.blocked && <Button type="button" variant="primary" onClick={() => { setPaused(false); void enqueueCoursePreparation(store(), course, Date.now(), { revive: true }).then(onChanged); }}>Prepare the remaining activities</Button>}
			{running && <Loading size="inline" label="Working…" />}
		</div>
	</Card>;
}

type AfterActivity = { title: string; go: () => void } | { waiting: string } | undefined;

function ActivityWork({ course, item, material, evidence, after, onChanged }: { course: SelfPacedCourse; item: ActivityProgress; material?: ActivityMaterial; evidence: CourseEvidence[]; after?: AfterActivity; onChanged: () => void }) {
	const { activity } = item;
	const assessed = activity.kind !== "learn";
	// Recall and Apply keep the explanation closed until after an answer; opening it makes the answer "with help".
	const [materialOpen, setMaterialOpen] = useState(!assessed);
	const [hintOpen, setHintOpen] = useState<Record<string, boolean>>({});
	const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((material?.questions ?? []).map((question) => [question.id, readAnswerDraft(course.id, question.id)])));
	const setAnswer = (questionId: string, value: string) => {
		setAnswers((current) => ({ ...current, [questionId]: value }));
		writeAnswerDraft(course.id, questionId, value);
	};
	// Verdicts that were already here when the activity was opened do not replay their receipt.
	const settled = useRef<Set<string> | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState("");
	const own = evidence.filter((record) => record.activityId === activity.id);
	settled.current ??= new Set(own.filter((record) => record.verdict).map((record) => record.id));
	const condition = completionCondition(activity.kind);

	if (!material) return <EmptyState role="status" heading="This activity is not prepared yet.">It appears here as soon as it is ready.</EmptyState>;

	const submit = async (questionId: string) => {
		setBusy(questionId); setError("");
		try {
			await submitAnswer(store(), { courseId: course.id, activityId: activity.id, questionId, answer: answers[questionId] ?? "", help: { hintShown: !!hintOpen[questionId], materialVisible: assessed && materialOpen } }, material, browserComplete());
			setAnswer(questionId, "");
		} catch (problem) {
			setError(errorText(problem, "Your answer could not be marked. It is saved; try marking it again."));
		} finally {
			setBusy(null); onChanged();
		}
	};
	const remark = async (record: CourseEvidence) => {
		const question = material.questions.find((candidate) => candidate.id === record.questionId);
		if (!question) return;
		setBusy(record.id); setError("");
		try { await markAnswer(store(), record, question, browserComplete()); }
		catch (problem) { setError(errorText(problem, "Marking failed again. Your answer is still saved.")); }
		finally { setBusy(null); onChanged(); }
	};

	return <LessonFrame className="self-paced__work k-reveal" glyph={assessed ? "edit" : "book"} title={activity.title} kind={ACTIVITY_LABELS[activity.kind]}
		tools={assessed && <Button size="sm" variant="ghost" aria-expanded={materialOpen} onClick={() => setMaterialOpen(!materialOpen)}>{materialOpen ? "Hide the notes" : "Show the notes"}</Button>}>
		<p className="self-paced__hint">{condition.description}</p>
		{material.groundedIn === "model-knowledge" && <Note>Prepared from what the model knows about the source, not from text you supplied. Check details against the source.</Note>}
		{(activity.kind === "learn" || materialOpen) && <Prose className="self-paced__material"><MarkdownBlock content={material.explanation} /></Prose>}

		{activity.kind === "learn" && item.state !== "done" && <div className="self-paced__actions">
			<Button type="button" variant="primary" onClick={() => void recordRead(store(), course.id, activity.id).then(onChanged).catch((problem) => setError(errorText(problem, "Could not save that. Try again.")))}><KeatingGlyph name="check" size={14} /> Mark as read</Button>
		</div>}

		{material.questions.map((question, index) => {
			const attempts = own.filter((record) => record.questionId === question.id);
			return <section key={question.id} className="self-paced__question" aria-label={`Question ${index + 1}`}>
				<h4>{activity.kind === "learn" ? "Check yourself (optional)" : `Question ${index + 1}`}</h4>
				<Prose className="self-paced__prompt"><MarkdownBlock content={question.prompt} /></Prose>
				{hintOpen[question.id] && <Note><strong>Hint</strong> {question.hint}</Note>}
				<Field label="Your answer" hint={assessed ? "Answers given with the notes or a hint in view count as “with help”." : undefined}>
					<TextArea rows={3} maxLength={COURSE_LIMITS.answer} value={answers[question.id] ?? ""} onChange={(event) => setAnswer(question.id, event.target.value)} onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && busy === null && (answers[question.id] ?? "").trim()) { event.preventDefault(); void submit(question.id); }
					}} />
				</Field>
				<footer className="lesson-foot sp-footer">
					{question.hint && !hintOpen[question.id] && <Button glyph="bulb" variant="ghost" onClick={() => setHintOpen(current => ({ ...current, [question.id]: true }))}>Show a hint</Button>}
					<small className="self-paced__kbd-hint"><Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> also submits</small>
					<Button variant="primary" busy={busy === question.id} disabled={busy !== null || !(answers[question.id] ?? "").trim()} onClick={() => void submit(question.id)}>{busy === question.id ? "Marking…" : "Submit answer"}</Button>
				</footer>
				{attempts.length > 0 && <ol className="self-paced__attempts" aria-label="Your attempts" aria-live="polite">
					{attempts.map((record) => <li key={record.id}>
						<p className="self-paced__attempt-head">
							<span className={`self-paced__verdict self-paced__verdict--${record.verdict ?? "pending"}${record.verdict && !settled.current!.has(record.id) ? " k-receipt" : ""}`}><KeatingGlyph name={record.verdict === "met" ? "check" : record.verdict === "partly" ? "minus" : record.verdict === "not-met" ? "x" : "clock"} size={14} />{record.verdict === "met" ? "Correct" : record.verdict === "partly" ? "Partly" : record.verdict === "not-met" ? "Not quite" : "Not marked"}</span>
							<span>{EVIDENCE_LABELS[record.kind]}</span>
							<span>{new Date(record.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
						</p>
						<p className="self-paced__answer">{record.answer}</p>
						{record.feedback && <p className="self-paced__feedback"><strong>Keating’s feedback (AI):</strong> {record.feedback}</p>}
						{!record.verdict && <Button type="button" variant="line" disabled={busy !== null} onClick={() => void remark(record)}>{busy === record.id ? <Loading size="inline" label="Marking…" /> : "Mark this answer"}</Button>}
					</li>)}
				</ol>}
			</section>;
		})}
		{error && <p className="self-paced__alert" role="alert">{error}</p>}
		{item.state === "done" && after && ("go" in after
			? <div className="self-paced__actions k-reveal"><Button type="button" variant="primary" onClick={after.go}>Next: {after.title} <KeatingGlyph name="right" size={14} /></Button></div>
			: <p className="self-paced__hint k-reveal">{after.waiting}</p>)}
	</LessonFrame>;
}

export function SelfPacedCourse() {
	const { courseId } = useParams({ strict: false }) as { courseId?: string };
	const { course, evidence, materials, jobs, loaded, error, reload } = useCourseData(courseId);
	const now = useNow();
	const [open, setOpen] = useState<string | null>(null);
	const [actionError, setActionError] = useState("");
	const [discard, setDiscard] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState("");
	const [draftPromise, setDraftPromise] = useState("");
	useSeo({ title: `${course?.title ?? "Course"} · Keating`, description: course?.promise ?? "A self-paced course." });

	const progress = useMemo(() => course ? courseProgress(course, evidence, now) : [], [course, evidence, now]);
	const summary = useMemo(() => summarizeCourse(progress), [progress]);

	// "Continue" takes the learner to the work: the opened activity is scrolled to and focused.
	const [focusId, setFocusId] = useState<string | null>(null);
	useEffect(() => {
		if (!focusId) return;
		const heading = document.getElementById(`activity-${focusId}`);
		heading?.focus({ preventScroll: true });
		heading?.closest(".self-paced__activity")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
		setFocusId(null);
	}, [focusId]);

	// Receipts play once, when something is finished while the learner is here; never on page load.
	const seenStates = useRef<Map<string, string> | null>(null);
	const wasCompleted = useRef<boolean | null>(null);
	const [fresh, setFresh] = useState<string | null>(null);
	useEffect(() => {
		if (!course) return;
		const finished = seenStates.current
			? progress.find((item) => item.state === "done" && seenStates.current!.has(item.activity.id) && seenStates.current!.get(item.activity.id) !== "done")
			: undefined;
		if (finished) setFresh(finished.activity.id);
		seenStates.current = new Map(progress.map((item) => [item.activity.id, item.state]));
		const completed = course.status === "completed";
		if (wasCompleted.current === false && completed) void fireCompletionConfetti();
		wasCompleted.current = completed;
	}, [progress, course]);
	const act = (work: Promise<unknown>) => { setActionError(""); void work.then(reload).catch((problem) => setActionError(errorText(problem, "That change could not be saved. Nothing was lost; try again."))); };

	if (!loaded || error || !course) return <div className="self-paced-page"><AppBar title="Self-paced courses" /><main className="sp-main">
		<Card as="section" className="sp-empty">
			{loaded ? <><KeatingBot size={40} state="greeting" label="" /><div role="alert">
				<h1>{error ? "This course could not be opened" : "Course not found"}</h1>
				<p>{error ?? "This course is not on this device. Courses are stored in the browser where they were created."}</p>
			</div></> : <Loading label="Loading your course…" size="page" />}
			<ButtonLink to="/learn">All courses</ButtonLink>
		</Card>
	</main></div>;

	const stateLabel = (item: ActivityProgress): string => item.state === "done" ? "Done"
		: item.state === "skipped" ? "Skipped as already known"
		: item.state === "waiting" ? `Opens ${when(item.availableAt!, now)}`
		: item.state === "locked" ? `After: ${item.blockedBy.join(", ")}`
		: "Ready";

	return <div className="self-paced-page">
		<AppBar title="Self-paced courses" back={{label: "All courses", to: "/learn"}} menu={false}>
			<Menu label="Course actions" trigger={<IconButton label="More" glyph="more" />} items={[
				{id: "edit", label: "Edit title or goal", glyph: "edit", onSelect: () => { setDraftTitle(course.title); setDraftPromise(course.promise); setEditing(true); }},
				{id: "download", label: "Download as Markdown", glyph: "export", onSelect: () => downloadTextFile(`${course.title.replace(/[^\w-]+/g, "-").slice(0, 60) || "course"}.md`, exportCourseMarkdown(course, evidence, materials, now))},
			]} />
		</AppBar>
		<main className="sp-main">
			<header className="self-paced__header">
				{editing ? <Card as="form" onSubmit={(event) => { event.preventDefault(); act(editCoursePlan(store(), course.id, { title: draftTitle, promise: draftPromise }, "Edited the title or goal.").then(() => setEditing(false))); }}>
					<Field label="Title"><TextInput autoFocus required maxLength={COURSE_LIMITS.title} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} /></Field>
					<Field label="You will be able to"><TextArea required rows={2} maxLength={COURSE_LIMITS.promise} value={draftPromise} onChange={(event) => setDraftPromise(event.target.value)} /></Field>
					<div className="sp-footer"><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" variant="primary">Save</Button></div>
				</Card> : <>
					<h1 className="k-halftone k-green">{course.title}</h1>
					<p><strong>You will be able to:</strong> {course.promise}</p>
					<p className="self-paced__hint">Source: {course.source.url ? <a href={course.source.url} target="_blank" rel="noopener noreferrer">{course.source.title} <KeatingGlyph name="ext" size={12} /><span className="k-sr"> (opens in a new tab)</span></a> : course.source.title}{course.source.excerpt ? " · studying from the text you pasted" : " · no text supplied"}</p>
					{course.prerequisites.length > 0 && <details><summary>Before you start ({course.prerequisites.length})</summary><ul>{course.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul></details>}
				</>}
			</header>

			{actionError && <p className="self-paced__alert" role="alert">{actionError}</p>}

			{course.status === "draft" && <Card as="section" aria-labelledby="review-heading">
				<h2 id="review-heading">Review this plan</h2>
				<p>Skip anything you already know, then approve the plan. Keating starts preparing activities after you approve.</p>
				<div className="sp-footer"><Button variant="ghost" onClick={() => setDiscard(true)}>Discard</Button><Button variant="primary" onClick={() => act(startCourse(store(), course.id))}>Approve and start preparing</Button></div>
				<ConfirmDialog open={discard} title="Discard this draft plan?" description="This removes the draft from this device." confirmLabel="Discard" onCancel={() => setDiscard(false)} onConfirm={() => {
					setDiscard(false);
					void store().deleteCourse(course.id).then(() => window.location.assign("/learn")).catch(problem => setActionError(errorText(problem, "The draft could not be deleted.")));
				}} />
			</Card>}

			{course.status === "completed" && <Card as="section" role="status">
				<h2 className="k-halftone k-green">Course complete</h2>
				<div className="self-paced__done-row">
					<KeatingBot size={56} state="success" label="" />
					<p>You finished the final task without help. Your materials and answers stay here, and you can download them.</p>
				</div>
			</Card>}

			{course.status !== "draft" && <div className="sp-columns"><Card as="section" className="sp-panel" aria-labelledby="progress-heading">
				<h2 className="k-halftone" id="progress-heading">Where you are</h2>
				{summary.next && <strong>Step {progress.indexOf(summary.next) + 1} of {summary.total}</strong>}
				<Progress done={summary.done} total={summary.total} label="Activities completed" />

				<p role="status">
					{summary.complete ? "All done."
						: summary.next ? <>Next: <strong>{summary.next.activity.title}</strong>.</>
						: summary.nextAvailableAt ? `Nothing to do right now. Your next activity opens ${when(summary.nextAvailableAt, now)}; recall works best after a gap.`
						: "Waiting for preparation to finish."}
					{" "}{summary.done} of {summary.total} activities done{summary.skipped ? `, ${summary.skipped} skipped` : ""}.
				</p>
				<div data-glyph-host><EvidenceCounts evidence={summary.evidence} /></div>
				{summary.next && open !== summary.next.activity.id && <Button type="button" variant="primary" onClick={() => { setOpen(summary.next!.activity.id); setFocusId(summary.next!.activity.id); }}>Continue</Button>}
			</Card>
			<PreparationPanel course={course} jobs={jobs} materials={materials} onChanged={reload} /></div>}

			<section aria-labelledby="plan-heading">
				<h2 id="plan-heading">Plan</h2>
				<ol className="self-paced__plan">
					{progress.map((item, index) => {
						const { activity } = item;
						const canOpen = course.status !== "draft" && (item.state === "available" || item.state === "done");
						const isOpen = open === activity.id && canOpen;
						const current = course.status === "active" && summary.next === item;
						const glyph = activityGlyph(item.state);
						const isLast = index === progress.length - 1;
						return <li key={activity.id} className="self-paced__activity" data-glyph-host data-state={item.state} data-current={current || undefined}>
							<KeatingGlyph name={glyph} size={16} />
							<div className="self-paced__activity-head">
								<div>
									<h3 id={`activity-${activity.id}`} tabIndex={-1}>{index + 1} · {activity.title}</h3>
									<small className={fresh === activity.id ? "k-receipt" : ""}>{ACTIVITY_LABELS[activity.kind]}{isLast ? " · final task" : ""} · {current ? "Now" : stateLabel(item)}</small>
								</div>
								<div className="self-paced__actions">
									{canOpen && <Button type="button" variant="ghost" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : activity.id)}>{isOpen ? "Close" : item.state === "done" ? "Review" : "Open"} <KeatingGlyph name="chev" className="k-chevron" size={14} /></Button>}
									{!isLast && item.state !== "done" && (activity.skipped
										? <Button type="button" variant="ghost" onClick={() => act(setActivitySkipped(store(), course.id, activity.id, false))}>Bring back</Button>
										: <Button type="button" variant="ghost" onClick={() => act(setActivitySkipped(store(), course.id, activity.id, true))}>I already know this</Button>)}
								</div>
							</div>
							<details className="sp-why"><summary>Why this activity?</summary><p>{activity.purpose}</p><small>From: {activity.source.label}</small></details>
							{isOpen && <ActivityWork course={course} item={item} material={materials.find((material) => material.activityId === activity.id)} evidence={evidence} onChanged={reload}
								after={summary.complete ? undefined
									: summary.next && summary.next.activity.id !== activity.id ? { title: summary.next.activity.title, go: () => { setOpen(summary.next!.activity.id); setFocusId(summary.next!.activity.id); } }
									: summary.nextAvailableAt ? { waiting: `That is everything for now. Your next activity opens ${when(summary.nextAvailableAt, now)}; recall works best after a gap.` }
									: undefined} />}
						</li>;
					})}
				</ol>
			</section>

			<details>
				<summary>Plan changes ({course.changes.length})</summary>
				<ol className="self-paced__changes">
					{[...course.changes].reverse().map((change, index) => <li key={`${change.at}-${index}`}>
						<span className="self-paced__change-by">{change.by === "agent" ? "Keating" : "You"}</span> {change.summary} <span className="self-paced__hint">{new Date(change.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
					</li>)}
				</ol>
			</details>
		</main>
	</div>;
}
