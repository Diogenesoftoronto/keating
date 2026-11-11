import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, ExternalLink, Lock, Pause, Play, Plus, RefreshCw, Timer } from "lucide-react";
import { KeatingBot } from "../components/KeatingBot";
import { Nav } from "../components/Nav";
import { Spinner } from "../components/Spinner";
import { fireCompletionConfetti } from "../components/flashcards/review-feedback";
import { scrollBehavior } from "../lib/motion";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { useSeo } from "../hooks/useSeo";
import { downloadTextFile } from "../lib/browser-download";
import { browserComplete } from "../keating/self-paced/agent";
import {
	ACTIVITY_LABELS,
	COURSE_LIMITS,
	EVIDENCE_KINDS,
	EVIDENCE_LABELS,
	activityFingerprint,
	completionCondition,
	courseProgress,
	exportCourseMarkdown,
	summarizeCourse,
	validateCourseSource,
	type ActivityMaterial,
	type ActivityProgress,
	type ActivityState,
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

function StepBar({ states, label, mini = false }: { states: readonly ActivityState[]; label: string; mini?: boolean }) {
	return <div className={`self-paced__steps${mini ? " self-paced__steps--mini" : ""}`} role="img" aria-label={label}>
		{states.map((state, index) => <span key={index} data-state={state} />)}
	</div>;
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
	const [steps, setSteps] = useState<Record<string, ActivityState[]>>({});
	const abort = useRef<AbortController | null>(null);

	const load = useCallback(() => {
		store().listCourses().then((list) => {
			setCourses(list);
			// Progress on each row is a nicety: if it cannot be read, the list still shows.
			void Promise.all(list.filter((course) => course.status !== "draft").map(async (course) =>
				[course.id, courseProgress(course, await store().listEvidence(course.id), Date.now()).map((item) => item.state)] as const))
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
	const formSection = (
			<section id="new-course-form" className={`self-paced__card${hasCourses ? " k-reveal" : ""}`} aria-labelledby="new-course-heading">
				<h2 id="new-course-heading">Start a course</h2>
				<form onSubmit={(event) => { event.preventDefault(); void create(); }}>
					<label className="self-paced__field"><span>Paper or topic</span>
						<input type="text" required maxLength={200} value={title} autoFocus={hasCourses} onChange={(event) => setTitle(event.target.value)} placeholder="For example: Attention Is All You Need" />
					</label>
					<label className="self-paced__field"><span>Link (optional)</span>
						<input type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://arxiv.org/abs/…" />
					</label>
					<label className="self-paced__field"><span>Text to study from (optional)</span>
						<textarea rows={5} maxLength={COURSE_LIMITS.excerpt} value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="Paste the abstract and the sections you want to learn." />
						<span className="self-paced__hint">With pasted text, materials stick to what it says. Without it, Keating works from what the model knows about the source and marks the materials as such. Keating does not open the link.</span>
					</label>
					<label className="self-paced__field"><span>What do you want to be able to do?</span>
						<textarea rows={2} maxLength={600} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="For example: implement scaled dot-product attention and explain why it is scaled" />
					</label>
					<label className="self-paced__field"><span>What do you already know? (optional)</span>
						<textarea rows={2} maxLength={600} value={background} onChange={(event) => setBackground(event.target.value)} />
					</label>
					{error && <p className="self-paced__alert" role="alert">{error}</p>}
					<div className="self-paced__actions">
						<button type="submit" className="self-paced__button self-paced__button--primary" disabled={busy || !title.trim()}>{busy ? <><Spinner size={14} /> Drafting your plan…</> : "Draft a plan"}</button>
						{busy && <button type="button" className="self-paced__button" onClick={() => abort.current?.abort()}>Cancel</button>}
					</div>
					{busy && <div className="self-paced__drafting k-reveal" role="status">
						<KeatingBot size={40} state="thinking" label="" />
						<span>Reading the source and sketching a plan. You will review it before anything else is prepared.</span>
					</div>}
					<p className="self-paced__hint">Drafting uses the model you chose in Chat and counts toward this course's limit of {COURSE_LIMITS.defaultTokenBudget.toLocaleString()} tokens. Nothing else is prepared until you approve the plan.</p>
				</form>
			</section>
	);
	const listSection = (
			<section aria-labelledby="your-courses-heading">
				<h2 id="your-courses-heading" className="self-paced__section-title">Your courses</h2>
				{loadError && <p className="self-paced__alert" role="alert">{loadError}</p>}
				{courses === null ? <p role="status">Loading…</p>
					: courses.length === 0 ? <div className="self-paced__empty">
						<KeatingBot size={56} state="greeting" label="" />
						<div>
							<p><strong>Nothing on the desk yet.</strong></p>
							<p className="self-paced__hint">Name a paper or a topic above and Keating will draft a short plan for you to look over. Courses are kept on this device.</p>
						</div>
					</div>
					: <ul className="self-paced__list">
						{courses.map((course) => <li key={course.id}>
							<Link to="/learn/$courseId" params={{ courseId: course.id }} className="self-paced__course-link">
								<span className="self-paced__course-title">{course.title}</span>
								<span className="self-paced__hint">
									{course.status === "draft" ? "Plan waiting for your review"
										: course.status === "completed" ? "Completed"
										: steps[course.id] ? `${steps[course.id]!.filter((state) => state === "done").length} of ${course.activities.length} done` : "In progress"}
									{" · "}{course.activities.length} activities · {course.source.title}
								</span>
								{steps[course.id] && <StepBar mini states={steps[course.id]!} label={`${steps[course.id]!.filter((state) => state === "done").length} of ${course.activities.length} activities done`} />}
							</Link>
						</li>)}
					</ul>}
			</section>
	);

	return <div className="self-paced-page retro-layout retro-page">
		<Nav />
		<main className="self-paced">
			<header className="self-paced__header">
				<h1>Self-paced courses</h1>
				<p>Pick one paper or topic and say what you want to be able to do. Keating drafts a short plan for you to review, prepares each step in the background, and you work through it over several sittings.</p>
			</header>

			{courses !== null && !hasCourses && formSection}
			{listSection}
			{hasCourses && <div className="self-paced__actions">
				<button type="button" className="self-paced__button" aria-expanded={showForm} aria-controls="new-course-form" onClick={() => setShowForm((open) => !open)}>
					<Plus size={14} aria-hidden="true" /> Start another course <ChevronDown className="k-chevron" size={14} aria-hidden="true" />
				</button>
			</div>}
			{hasCourses && showForm && formSection}
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
	if (ready >= total && pending === 0 && !queue.blocked) {
		return <p className="self-paced__prep-done" role="status">
			<strong><Check size={14} aria-hidden="true" /> All {total} activities are prepared.</strong>
			<span>{course.budget.usedTokens.toLocaleString()} of {course.budget.maxTokens.toLocaleString()} tokens used.</span>
		</p>;
	}
	const used = course.budget.usedTokens, max = course.budget.maxTokens;

	return <section className="self-paced__card" aria-labelledby="prep-heading">
		<h2 id="prep-heading">Preparation</h2>
		<p role="status" aria-live="polite">
			{queue.blocked ? "Preparation is paused because of a problem."
				: queue.overBudget ? "Preparation is paused: this course reached its limit."
				: ready >= total ? `All ${total} activities are prepared.`
				: pending === 0 ? `${ready} of ${total} activities are prepared. Preparation is stopped.`
				: paused ? `Paused. ${ready} of ${total} activities prepared.`
				: `Preparing in the background: ${ready} of ${total} ready. You can start on what is ready, or leave this page; it continues whenever Keating is open.`}
		</p>
		<div className="self-paced__meter" role="img" aria-label={`${used.toLocaleString()} of ${max.toLocaleString()} tokens used`}>
			<span style={{ transform: `scaleX(${Math.min(1, max > 0 ? used / max : 0)})` }} />
		</div>
		<p className="self-paced__hint">{used.toLocaleString()} of {max.toLocaleString()} tokens used on this course. Preparation never goes past the limit without asking.</p>
		{queue.blocked && <p className="self-paced__alert" role="alert">{queue.blocked}</p>}
		{note && <p className="self-paced__hint" role="status">{note}</p>}
		<div className="self-paced__actions">
			{queue.blocked && <button type="button" className="self-paced__button self-paced__button--primary" onClick={() => void retryFailedJobs(store(), course.id, Date.now()).then(onChanged)}><RefreshCw size={14} aria-hidden="true" /> Try again</button>}
			{queue.overBudget && <button type="button" className="self-paced__button self-paced__button--primary" onClick={() => void raiseCourseBudget(store(), course.id, COURSE_LIMITS.defaultTokenBudget).then(onChanged)}>Allow {COURSE_LIMITS.defaultTokenBudget.toLocaleString()} more tokens</button>}
			{pending > 0 && !queue.blocked && !queue.overBudget && (paused
				? <button type="button" className="self-paced__button" onClick={() => setPaused(false)}><Play size={14} aria-hidden="true" /> Resume</button>
				: <button type="button" className="self-paced__button" onClick={() => { setPaused(true); abort.current?.abort(); }}><Pause size={14} aria-hidden="true" /> Pause</button>)}
			{pending > 0 && <button type="button" className="self-paced__button" onClick={() => { setPaused(true); abort.current?.abort(); void cancelQueuedJobs(store(), course.id, Date.now()).then(onChanged); }}>Stop preparing</button>}
			{pending === 0 && ready < total && !queue.blocked && <button type="button" className="self-paced__button self-paced__button--primary" onClick={() => { setPaused(false); void enqueueCoursePreparation(store(), course, Date.now(), { revive: true }).then(onChanged); }}>Prepare the remaining activities</button>}
			{running && <span className="self-paced__drafting"><Spinner size={14} /> Working…</span>}
		</div>
	</section>;
}

type AfterActivity = { title: string; go: () => void } | { waiting: string } | undefined;

function ActivityWork({ course, item, material, evidence, after, onChanged }: { course: SelfPacedCourse; item: ActivityProgress; material?: ActivityMaterial; evidence: CourseEvidence[]; after?: AfterActivity; onChanged: () => void }) {
	const { activity } = item;
	const assessed = activity.kind !== "learn";
	// Recall and Apply keep the explanation closed until after an answer; opening it makes the answer "with help".
	const hideFirst = activity.kind === "recall" || activity.kind === "transfer";
	const [materialOpen, setMaterialOpen] = useState(!hideFirst && activity.kind !== "practice");
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

	if (!material) return <p className="self-paced__hint" role="status">This activity is not prepared yet. It appears here as soon as it is ready.</p>;

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

	return <div className="self-paced__work k-reveal">
		<p className="self-paced__hint">Completes when: {condition.description}</p>
		{material.groundedIn === "model-knowledge" && <p className="self-paced__notice">Prepared from what the model knows about the source, not from text you supplied. Check details against the source.</p>}

		{(activity.kind === "learn" || materialOpen) && <div className="self-paced__material"><MarkdownBlock content={material.explanation} /></div>}
		{assessed && <button type="button" className="self-paced__button" aria-expanded={materialOpen} onClick={() => setMaterialOpen((open) => !open)}>
			{materialOpen ? "Hide the notes" : hideFirst ? "Show the notes (answers given after this count as “with help”)" : "Show the refresher (answers given after this count as “with help”)"}
		</button>}

		{activity.kind === "learn" && item.state !== "done" && <div className="self-paced__actions">
			<button type="button" className="self-paced__button self-paced__button--primary" onClick={() => void recordRead(store(), course.id, activity.id).then(onChanged).catch((problem) => setError(errorText(problem, "Could not save that. Try again.")))}><Check size={14} aria-hidden="true" /> Mark as read</button>
		</div>}

		{material.questions.map((question, index) => {
			const attempts = own.filter((record) => record.questionId === question.id);
			return <section key={question.id} className="self-paced__question" aria-label={`Question ${index + 1}`}>
				<h4>{activity.kind === "learn" ? "Check yourself (optional)" : `Question ${index + 1}`}</h4>
				<div className="self-paced__prompt"><MarkdownBlock content={question.prompt} /></div>
				{question.hint && (hintOpen[question.id]
					? <p className="self-paced__notice"><strong>Hint:</strong> {question.hint}</p>
					: <button type="button" className="self-paced__button self-paced__button--quiet" onClick={() => setHintOpen((current) => ({ ...current, [question.id]: true }))}>Show a hint{assessed ? " (your answer will count as “with help”)" : ""}</button>)}
				<label className="self-paced__field"><span>Your answer</span>
					<textarea rows={4} maxLength={COURSE_LIMITS.answer} value={answers[question.id] ?? ""} onChange={(event) => setAnswer(question.id, event.target.value)} onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && busy === null && (answers[question.id] ?? "").trim()) { event.preventDefault(); void submit(question.id); }
					}} />
				</label>
				<div className="self-paced__actions">
					<button type="button" className="self-paced__button self-paced__button--primary" disabled={busy !== null || !(answers[question.id] ?? "").trim()} onClick={() => void submit(question.id)}>{busy === question.id ? <><Spinner size={14} /> Marking…</> : "Submit answer"}</button>
					<span className="self-paced__hint self-paced__kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> also submits</span>
				</div>
				{attempts.length > 0 && <ol className="self-paced__attempts" aria-label="Your attempts">
					{attempts.map((record) => <li key={record.id}>
						<p className="self-paced__attempt-head">
							<span className={`self-paced__verdict self-paced__verdict--${record.verdict ?? "pending"}${record.verdict && !settled.current!.has(record.id) ? " k-receipt" : ""}`}>{record.verdict === "met" && <Check size={12} aria-hidden="true" />}{record.verdict === "met" ? "Correct" : record.verdict === "partly" ? "Partly correct" : record.verdict === "not-met" ? "Not yet" : "Not marked"}</span>
							<span>{EVIDENCE_LABELS[record.kind]}</span>
							<span>{new Date(record.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
						</p>
						<p className="self-paced__answer">{record.answer}</p>
						{record.feedback && <p className="self-paced__feedback"><strong>Keating’s feedback (AI):</strong> {record.feedback}</p>}
						{!record.verdict && <button type="button" className="self-paced__button" disabled={busy !== null} onClick={() => void remark(record)}>{busy === record.id ? <><Spinner size={14} /> Marking…</> : "Mark this answer"}</button>}
					</li>)}
				</ol>}
			</section>;
		})}
		{error && <p className="self-paced__alert" role="alert">{error}</p>}
		{item.state === "done" && after && ("go" in after
			? <div className="self-paced__actions k-reveal"><button type="button" className="self-paced__button self-paced__button--primary" onClick={after.go}>Next: {after.title} <ArrowRight size={14} aria-hidden="true" /></button></div>
			: <p className="self-paced__hint k-reveal">{after.waiting}</p>)}
	</div>;
}

export function SelfPacedCourse() {
	const { courseId } = useParams({ strict: false }) as { courseId?: string };
	const { course, evidence, materials, jobs, loaded, error, reload } = useCourseData(courseId);
	const now = useNow();
	const [open, setOpen] = useState<string | null>(null);
	const [actionError, setActionError] = useState("");
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

	if (!loaded) return <div className="self-paced-page retro-layout retro-page"><Nav /><main className="self-paced"><p role="status">Loading your course…</p></main></div>;
	if (error || !course) return <div className="self-paced-page retro-layout retro-page"><Nav /><main className="self-paced">
		<section className="self-paced__card" role="alert">
			<h1>{error ? "This course could not be opened" : "Course not found"}</h1>
			<p>{error ?? "This course is not on this device. Courses are stored in the browser where they were created."}</p>
			<Link to="/learn" className="self-paced__button">All courses</Link>
		</section>
	</main></div>;

	const stateLabel = (item: ActivityProgress): string => item.state === "done" ? "Done"
		: item.state === "skipped" ? "Skipped as already known"
		: item.state === "waiting" ? `Opens ${when(item.availableAt!, now)}`
		: item.state === "locked" ? `After: ${item.blockedBy.join(", ")}`
		: "Ready";

	return <div className="self-paced-page retro-layout retro-page">
		<Nav />
		<main className="self-paced">
			<p><Link to="/learn" className="self-paced__back"><ArrowLeft size={14} aria-hidden="true" /> All courses</Link></p>
			<header className="self-paced__header">
				{editing ? <form className="self-paced__card" onSubmit={(event) => { event.preventDefault(); act(editCoursePlan(store(), course.id, { title: draftTitle, promise: draftPromise }, "Edited the title or goal.").then(() => setEditing(false))); }}>
					<label className="self-paced__field"><span>Title</span><input type="text" required maxLength={COURSE_LIMITS.title} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} /></label>
					<label className="self-paced__field"><span>You will be able to</span><textarea required rows={2} maxLength={COURSE_LIMITS.promise} value={draftPromise} onChange={(event) => setDraftPromise(event.target.value)} /></label>
					<div className="self-paced__actions"><button type="submit" className="self-paced__button self-paced__button--primary">Save</button><button type="button" className="self-paced__button" onClick={() => setEditing(false)}>Cancel</button></div>
				</form> : <>
					<h1>{course.title}</h1>
					<p><strong>You will be able to:</strong> {course.promise}</p>
					<p className="self-paced__hint">Source: {course.source.url ? <a href={course.source.url} target="_blank" rel="noopener noreferrer">{course.source.title}<ExternalLink className="self-paced__ext" size={12} aria-hidden="true" /><span className="public-profile__sr"> (opens in a new tab)</span></a> : course.source.title}{course.source.excerpt ? " · studying from the text you pasted" : " · no text supplied"}</p>
					{course.prerequisites.length > 0 && <details className="self-paced__details"><summary>Before you start ({course.prerequisites.length})</summary><ul>{course.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul></details>}
					<div className="self-paced__actions">
						<button type="button" className="self-paced__button" onClick={() => { setDraftTitle(course.title); setDraftPromise(course.promise); setEditing(true); }}>Edit title or goal</button>
						<button type="button" className="self-paced__button" onClick={() => downloadTextFile(`${course.title.replace(/[^\w-]+/g, "-").slice(0, 60) || "course"}.md`, exportCourseMarkdown(course, evidence, materials, now))}><Download size={14} aria-hidden="true" /> Download as Markdown</button>
					</div>
				</>}
			</header>

			{actionError && <p className="self-paced__alert" role="alert">{actionError}</p>}

			{course.status === "draft" && <section className="self-paced__card self-paced__card--action" aria-labelledby="review-heading">
				<h2 id="review-heading">Review this plan</h2>
				<p>Keating drafted this plan. Skip anything you already know, then approve it. Preparing the activities starts only after you approve.</p>
				<div className="self-paced__actions">
					<button type="button" className="self-paced__button self-paced__button--primary" onClick={() => act(startCourse(store(), course.id))}>Approve and start preparing</button>
					<button type="button" className="self-paced__button" onClick={() => { if (window.confirm("Delete this draft plan?")) void store().deleteCourse(course.id).then(() => { window.location.assign("/learn"); }).catch((problem) => setActionError(errorText(problem, "The draft could not be deleted."))); }}>Discard</button>
				</div>
			</section>}

			{course.status === "completed" && <section className="self-paced__card self-paced__card--done" role="status">
				<h2>Course complete</h2>
				<div className="self-paced__done-row">
					<KeatingBot size={56} state="success" label="" />
					<p>You finished the final task without help. Your materials and answers stay here, and you can download them.</p>
				</div>
			</section>}

			{course.status !== "draft" && <section className="self-paced__card" aria-labelledby="progress-heading">
				<h2 id="progress-heading">Where you are</h2>
				<StepBar states={progress.map((item) => item.state)} label={`${summary.done} of ${summary.total} activities done${summary.skipped ? `, ${summary.skipped} skipped` : ""}`} />
				<p role="status">
					{summary.complete ? "All done."
						: summary.next ? <>Next: <strong>{summary.next.activity.title}</strong>.</>
						: summary.nextAvailableAt ? `Nothing to do right now. Your next activity opens ${when(summary.nextAvailableAt, now)}; recall works best after a gap.`
						: "Waiting for preparation to finish."}
					{" "}{summary.done} of {summary.total} activities done{summary.skipped ? `, ${summary.skipped} skipped` : ""}.
				</p>
				<dl className="self-paced__evidence">
					{EVIDENCE_KINDS.map((kind) => <div key={kind} data-zero={summary.evidence[kind] === 0 || undefined}><dt>{EVIDENCE_LABELS[kind]}</dt><dd>{summary.evidence[kind]}</dd></div>)}
				</dl>
				<p className="self-paced__hint">These are counted separately on purpose: reading something, answering with help, answering alone, recalling it later and applying it somewhere new are different things.</p>
				{summary.next && open !== summary.next.activity.id && <button type="button" className="self-paced__button self-paced__button--primary" onClick={() => { setOpen(summary.next!.activity.id); setFocusId(summary.next!.activity.id); }}>Continue</button>}
			</section>}

			<PreparationPanel course={course} jobs={jobs} materials={materials} onChanged={reload} />

			<section aria-labelledby="plan-heading">
				<h2 id="plan-heading" className="self-paced__section-title">Plan</h2>
				<ol className="self-paced__plan">
					{progress.map((item, index) => {
						const { activity } = item;
						const canOpen = course.status !== "draft" && (item.state === "available" || item.state === "done");
						const isOpen = open === activity.id && canOpen;
						const isLast = index === progress.length - 1;
						return <li key={activity.id} className="self-paced__activity" data-state={item.state}>
							<span className="self-paced__step" aria-hidden="true">{item.state === "done" ? <Check size={14} /> : index + 1}</span>
							<div className="self-paced__activity-head">
								<div>
									<p className="self-paced__kind">{ACTIVITY_LABELS[activity.kind]}{isLast ? " · final task" : ""}</p>
									<h3 id={`activity-${activity.id}`} tabIndex={-1}>{activity.title}</h3>
									<p className={`self-paced__state${fresh === activity.id ? " k-receipt" : ""}`}>
										{item.state === "done" ? <Check size={14} aria-hidden="true" /> : item.state === "waiting" ? <Timer size={14} aria-hidden="true" /> : item.state === "locked" ? <Lock size={14} aria-hidden="true" /> : null}
										{stateLabel(item)}
									</p>
								</div>
								<div className="self-paced__actions">
									{canOpen && <button type="button" className="self-paced__button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : activity.id)}>{isOpen ? "Close" : item.state === "done" ? "Review" : "Open"} <ChevronDown className="k-chevron" size={14} aria-hidden="true" /></button>}
									{!isLast && item.state !== "done" && (activity.skipped
										? <button type="button" className="self-paced__button self-paced__button--quiet" onClick={() => act(setActivitySkipped(store(), course.id, activity.id, false))}>Bring back</button>
										: <button type="button" className="self-paced__button self-paced__button--quiet" onClick={() => act(setActivitySkipped(store(), course.id, activity.id, true))}>I already know this</button>)}
								</div>
							</div>
							<p className="self-paced__purpose"><strong>Why:</strong> {activity.purpose}</p>
							<p className="self-paced__hint">From: {activity.source.label}</p>
							{isOpen && <ActivityWork course={course} item={item} material={materials.find((material) => material.activityId === activity.id)} evidence={evidence} onChanged={reload}
								after={summary.complete ? undefined
									: summary.next && summary.next.activity.id !== activity.id ? { title: summary.next.activity.title, go: () => { setOpen(summary.next!.activity.id); setFocusId(summary.next!.activity.id); } }
									: summary.nextAvailableAt ? { waiting: `That is everything for now. Your next activity opens ${when(summary.nextAvailableAt, now)}; recall works best after a gap.` }
									: undefined} />}
						</li>;
					})}
				</ol>
			</section>

			<details className="self-paced__details">
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
