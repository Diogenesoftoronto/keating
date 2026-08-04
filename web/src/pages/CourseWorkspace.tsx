import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
	ArrowLeft, Check, Circle, FileText, Layers3, MessageSquareText, Plus,
	Send, Share2, StickyNote, X,
} from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { CourseInviteDialog } from "../components/courses/CourseInviteDialog";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import {
	applyCourseOperation, CourseApiError, getCourse, newCourseOperationId,
} from "../courses/client";
import {
	allCourseLessons, courseCompletionPercent, type CourseLesson,
	type CourseMember, type CourseViewerSnapshot,
} from "../courses/contracts";
import { useCourseRealtime } from "../courses/useCourseRealtime";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

const s = {
	page: css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" }),
	top: css({ position: "sticky", top: 0, zIndex: 40, borderBottom: "2px solid var(--ink)", bg: "color-mix(in srgb, var(--paper) 94%, transparent)", backdropFilter: "blur(12px)" }),
	topInner: css({ mx: "auto", display: "flex", maxW: "96rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", px: "1rem", py: "0.65rem" }),
	mode: css({ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid var(--ink)" }),
	modeButton: css({ px: "0.75rem", py: "0.45rem", fontFamily: "var(--mono-display)", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }),
	grid: css({ mx: "auto", display: "grid", minH: "calc(100vh - 58px)", maxW: "96rem", lg: { gridTemplateColumns: "17rem minmax(0, 1fr)" }, xl: { gridTemplateColumns: "17rem minmax(0, 1fr) 19rem" } }),
	left: css({ borderBottom: "2px solid var(--ink)", bg: "var(--paper-deep, #e9e2d2)", p: "1rem", lg: { borderRight: "2px solid var(--ink)", borderBottom: 0 } }),
	center: css({ minW: 0, bg: "var(--card)", p: { base: "1rem", md: "2rem", xl: "2.5rem" } }),
	right: css({ borderTop: "2px solid var(--ink)", bg: "var(--paper-deep, #e9e2d2)", p: "1rem", lg: { gridColumn: "1 / -1" }, xl: { gridColumn: "auto", borderTop: 0, borderLeft: "2px solid var(--ink)" } }),
	sectionLabel: css({ fontFamily: "var(--mono-display)", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-soft)" }),
	panel: css({ border: "1px solid var(--ink)", bg: "var(--card)" }),
	button: css({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", border: "1px solid var(--ink)", px: "0.7rem", py: "0.5rem", fontSize: "0.78rem", fontWeight: 700, _hover: { bg: "var(--course-wash, #ddebdd)" }, _disabled: { opacity: 0.55 } }),
	primaryButton: css({ bg: "var(--course-green, #1e9b50)", color: "white", _hover: { bg: "var(--course-green-dark, #14743c)" } }),
	input: css({ w: "100%", border: "1px solid var(--ink)", bg: "var(--paper)", px: "0.7rem", py: "0.6rem", fontSize: "0.85rem", outline: 0, _focus: { boxShadow: "0 0 0 2px var(--peer-blue, #3468b3)" } }),
};

function formatRelative(iso: string): string {
	const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
	return `${Math.round(minutes / 1_440)}d`;
}

function memberName(member: CourseMember, viewerId: string): string {
	return member.accountId === viewerId ? "You" : member.displayName;
}

type WorkspaceMode = "desk" | "room";
type WorkspaceTextField =
	| "activeLessonId"
	| "noteText"
	| "answer"
	| "comment"
	| "materialTitle"
	| "materialUrl"
	| "cardFront"
	| "cardBack";

interface CourseWorkspaceState {
	snapshot: CourseViewerSnapshot | null;
	loading: boolean;
	error: string;
	saving: string;
	mode: WorkspaceMode;
	activeLessonId: string;
	noteText: string;
	answer: string;
	shareAnswer: boolean;
	comment: string;
	inviteOpen: boolean;
	materialTitle: string;
	materialUrl: string;
	cardFront: string;
	cardBack: string;
}

type CourseWorkspaceAction =
	| { type: "snapshot.received"; snapshot: CourseViewerSnapshot }
	| { type: "loading.finished" }
	| { type: "error.changed"; message: string }
	| { type: "saving.changed"; label: string }
	| { type: "mode.changed"; mode: WorkspaceMode }
	| { type: "text.changed"; field: WorkspaceTextField; value: string }
	| { type: "note.synced"; noteText: string }
	| { type: "answer.synced"; answer: string; shareAnswer: boolean }
	| { type: "share-answer.changed"; value: boolean }
	| { type: "invite.changed"; open: boolean }
	| { type: "material.cleared" }
	| { type: "card.cleared" };

const INITIAL_WORKSPACE_STATE: CourseWorkspaceState = {
	snapshot: null,
	loading: true,
	error: "",
	saving: "",
	mode: "desk",
	activeLessonId: "",
	noteText: "",
	answer: "",
	shareAnswer: false,
	comment: "",
	inviteOpen: false,
	materialTitle: "",
	materialUrl: "",
	cardFront: "",
	cardBack: "",
};

function courseWorkspaceReducer(state: CourseWorkspaceState, action: CourseWorkspaceAction): CourseWorkspaceState {
	switch (action.type) {
		case "snapshot.received":
			return { ...state, snapshot: action.snapshot, error: "" };
		case "loading.finished":
			return state.loading ? { ...state, loading: false } : state;
		case "error.changed":
			return state.error === action.message ? state : { ...state, error: action.message };
		case "saving.changed":
			return state.saving === action.label ? state : { ...state, saving: action.label };
		case "mode.changed":
			return state.mode === action.mode ? state : { ...state, mode: action.mode };
		case "text.changed":
			return state[action.field] === action.value ? state : { ...state, [action.field]: action.value };
		case "note.synced":
			return state.noteText === action.noteText ? state : { ...state, noteText: action.noteText };
		case "answer.synced":
			return {
				...state,
				answer: action.answer,
				shareAnswer: action.shareAnswer,
			};
		case "share-answer.changed":
			return state.shareAnswer === action.value ? state : { ...state, shareAnswer: action.value };
		case "invite.changed":
			return state.inviteOpen === action.open ? state : { ...state, inviteOpen: action.open };
		case "material.cleared":
			return { ...state, materialTitle: "", materialUrl: "" };
		case "card.cleared":
			return { ...state, cardFront: "", cardBack: "" };
	}
}

export function CourseWorkspace() {
	const { courseId } = useParams({ strict: false }) as { courseId: string };
	const [access, retryAccess] = useCoursesAccess();
	const [state, dispatch] = useReducer(courseWorkspaceReducer, INITIAL_WORKSPACE_STATE);
	const {
		snapshot, loading, error, saving, mode, activeLessonId, noteText, answer,
		shareAnswer, comment, inviteOpen, materialTitle, materialUrl, cardFront, cardBack,
	} = state;
	const setSnapshot = useCallback((next: CourseViewerSnapshot) => {
		dispatch({ type: "snapshot.received", snapshot: next });
	}, []);
	const setText = useCallback((field: WorkspaceTextField, value: string) => {
		dispatch({ type: "text.changed", field, value });
	}, []);

	const refresh = useCallback(async () => {
		if (access.status !== "ready") return;
		try {
			const next = await getCourse(courseId);
			setSnapshot(next);
		} catch (cause) {
			dispatch({ type: "error.changed", message: cause instanceof Error ? cause.message : "The course could not be loaded." });
		} finally {
			dispatch({ type: "loading.finished" });
		}
	}, [access.status, courseId, setSnapshot]);

	useEffect(() => { void refresh(); }, [refresh]);
	const realtime = useCourseRealtime(access.status === "ready" ? courseId : null, setSnapshot, () => void refresh());
	const course = snapshot?.course;
	const lessons = useMemo(() => course ? allCourseLessons(course) : [], [course]);
	const activeLesson = lessons.find((lesson) => lesson.id === activeLessonId) ?? lessons[0];
	const activeModule = course?.modules.find((module) => module.lessons.some((lesson) => lesson.id === activeLesson?.id));
	const sharedNote = course?.sharedNotes.find((note) => note.lessonId === activeLesson?.id);
	const ownSubmission = course?.submissions.find((submission) => submission.lessonId === activeLesson?.id && submission.accountId === snapshot?.viewer.accountId);

	useSeo({ title: course ? `${course.title} — Keating Courses` : "Course — Keating", description: course?.description ?? "A collaborative Keating course." });

	useEffect(() => {
		if (!activeLessonId && lessons[0]) setText("activeLessonId", snapshot?.viewer.progress.activeLessonId ?? lessons[0].id);
	}, [activeLessonId, lessons, setText, snapshot?.viewer.progress.activeLessonId]);
	useEffect(() => {
		dispatch({ type: "note.synced", noteText: sharedNote?.text ?? "" });
	}, [sharedNote?.id, sharedNote?.version]);
	useEffect(() => {
		dispatch({
			type: "answer.synced",
			answer: ownSubmission?.answer ?? "",
			shareAnswer: ownSubmission?.sharedWithPeers ?? false,
		});
	}, [ownSubmission?.id, ownSubmission?.version]);

	const mutate = async (operation: Parameters<typeof applyCourseOperation>[0], label: string) => {
		dispatch({ type: "saving.changed", label });
		dispatch({ type: "error.changed", message: "" });
		try {
			const result = await applyCourseOperation(operation);
			setSnapshot(result.snapshot);
		} catch (cause) {
			dispatch({ type: "error.changed", message: cause instanceof Error ? cause.message : "The change could not be saved." });
			if (cause instanceof CourseApiError && cause.status === 409) void refresh();
		} finally { dispatch({ type: "saving.changed", label: "" }); }
	};

	if (access.status !== "ready") return <div className={s.page}><CoursesAccessGate state={access} onRetry={retryAccess} /></div>;
	if (loading) return <div className={s.page}><p className={css({ py: "8rem", textAlign: "center", color: "var(--ink-soft)" })}>Opening course desk…</p></div>;
	if (!snapshot || !course || !activeLesson) return <div className={s.page}><div className={css({ mx: "auto", maxW: "42rem", px: "1rem", py: "6rem", textAlign: "center" })}><h1 className={css({ fontFamily: "Georgia, serif", fontSize: "2rem" })}>Course unavailable</h1><p className={css({ mt: "0.75rem", color: "var(--destructive)" })}>{error || "This course has no lessons yet."}</p><Link to="/courses" className={cx(s.button, css({ mt: "1.5rem", textDecoration: "none", color: "inherit" }))}><ArrowLeft size={15} /> Course library</Link></div></div>;

	const viewer = snapshot.viewer;
	const completed = viewer.progress.completedLessonIds.includes(activeLesson.id);
	const online = new Set(realtime.presentAccountIds);
	const networkStatus = realtime.status === "connected" ? snapshot.network?.status ?? "connected" : realtime.status;

	return <div className={s.page}>
		<header className={s.top}><div className={s.topInner}>
			<div className={css({ display: "flex", minW: 0, alignItems: "center", gap: "0.75rem" })}><Link to="/courses" aria-label="Back to courses" className={css({ display: "grid", h: "2rem", w: "2rem", flexShrink: 0, placeItems: "center", color: "inherit", _hover: { bg: "var(--course-wash, #ddebdd)" } })}><ArrowLeft size={18} /></Link><div className={css({ minW: 0 })}><p className={s.sectionLabel}>Course desk</p><h1 className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "Georgia, serif", fontSize: "1.15rem", fontWeight: 700 })}>{course.title}</h1></div></div>
			<div className={css({ display: "flex", alignItems: "center", gap: "0.6rem" })}><div className={s.mode}><button type="button" className={s.modeButton} style={mode === "desk" ? { background: "var(--ink)", color: "var(--paper)" } : undefined} onClick={() => dispatch({ type: "mode.changed", mode: "desk" })}>Desk</button><button type="button" className={s.modeButton} style={mode === "room" ? { background: "var(--ink)", color: "var(--paper)" } : undefined} onClick={() => dispatch({ type: "mode.changed", mode: "room" })}>Room</button></div>{snapshot.permissions.canInvite && <button type="button" className={cx(s.button, s.primaryButton)} onClick={() => dispatch({ type: "invite.changed", open: true })}><Share2 size={15} /><span className={css({ display: { base: "none", sm: "inline" } })}>Invite</span></button>}</div>
		</div></header>

		{error && <div role="alert" className={css({ position: "sticky", top: "58px", zIndex: 30, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", borderBottom: "1px solid var(--destructive)", bg: "#f8e4de", px: "1rem", py: "0.6rem", color: "#7d2b1d" })}><span>{error}</span><button type="button" onClick={() => dispatch({ type: "error.changed", message: "" })} aria-label="Dismiss"><X size={16} /></button></div>}
		{viewer.teacherAccess === "requested" && <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "0.75rem", borderBottom: "2px solid var(--ink)", bg: "#fff0d4", px: "1rem", py: "0.75rem", fontSize: "0.82rem" })}><strong>Your teacher requested full access to current and future course work.</strong><button type="button" className={cx(s.button, s.primaryButton)} onClick={() => void mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "teacher-access.respond", approve: true }, "access")}>Approve once</button><button type="button" className={s.button} onClick={() => void mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "teacher-access.respond", approve: false }, "access")}>Keep private</button></div>}

		<div className={s.grid}>
			<aside className={s.left}>
				<p className={s.sectionLabel}>Course outline</p>
				<div className={css({ mt: "0.75rem", display: "grid", gap: "1rem" })}>{course.modules.map((module) => <section key={module.id}><h2 className={css({ mb: "0.35rem", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" })}>{module.title}</h2><div className={css({ display: "grid", gap: "0.25rem" })}>{module.lessons.map((lesson, index) => { const done = viewer.progress.completedLessonIds.includes(lesson.id); return <button key={lesson.id} type="button" onClick={() => { setText("activeLessonId", lesson.id); dispatch({ type: "mode.changed", mode: "desk" }); }} className={css({ display: "grid", gridTemplateColumns: "1.4rem minmax(0, 1fr)", gap: "0.45rem", borderLeft: "3px solid transparent", px: "0.4rem", py: "0.5rem", textAlign: "left", _hover: { bg: "var(--card)" } })} style={activeLesson.id === lesson.id ? { background: "var(--card)", borderLeftColor: "var(--course-green)" } : undefined}><span className={css({ display: "grid", h: "1.25rem", w: "1.25rem", placeItems: "center", borderRadius: "50%", bg: done ? "var(--course-green)" : "transparent", color: done ? "white" : "var(--ink-soft)" })}>{done ? <Check size={12} /> : index + 1}</span><span className={css({ fontSize: "0.78rem", lineHeight: 1.35 })}>{lesson.title}</span></button>; })}</div></section>)}</div>
				<div className={css({ mt: "1.25rem", borderTop: "1px solid var(--ink)", pt: "1rem" })}><p className={s.sectionLabel}>Course material</p><div className={css({ mt: "0.6rem", display: "grid", gap: "0.4rem", fontSize: "0.76rem" })}>{course.materials.length ? course.materials.map((material) => <a key={material.id} href={material.url} target="_blank" rel="noreferrer" className={css({ display: "flex", alignItems: "center", gap: "0.4rem", color: "inherit" })}><FileText size={14} /> {material.title}</a>) : <span className={css({ color: "var(--ink-soft)" })}>No sources yet</span>}</div></div>
				<div className={css({ mt: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--ink)", pt: "1rem" })}><span className={css({ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", fontWeight: 700 })}><Layers3 size={15} /> Anki deck</span><span className={css({ fontFamily: "var(--mono-display)", fontSize: "0.7rem" })}>{course.cards.length} cards</span></div>
			</aside>

			<main className={s.center}>{mode === "desk" ? <DeskView lesson={activeLesson} moduleTitle={activeModule?.title ?? "Course"} completed={completed} noteText={noteText} setNoteText={(value) => setText("noteText", value)} sharedNoteVersion={sharedNote?.version ?? 0} answer={answer} setAnswer={(value) => setText("answer", value)} shareAnswer={shareAnswer} setShareAnswer={(value) => dispatch({ type: "share-answer.changed", value })} saving={saving} onComplete={() => void mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "lesson.complete", lessonId: activeLesson.id, completed: !completed }, "complete")} onSaveNote={() => void mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "shared-note.update", noteId: sharedNote?.id ?? `note_${activeLesson.id}`, lessonId: activeLesson.id, title: `${activeLesson.title} notes`, text: noteText, baseVersion: sharedNote?.version ?? 0 }, "note")} onSaveAnswer={() => activeLesson.exercise && void mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "submission.save", submissionId: ownSubmission?.id ?? `submission_${crypto.randomUUID().replaceAll("-", "")}`, lessonId: activeLesson.id, exerciseId: activeLesson.exercise.id, answer, sharedWithPeers: shareAnswer }, "answer")} /> : <RoomView snapshot={snapshot} activeLesson={activeLesson} online={online} comment={comment} setComment={(value) => setText("comment", value)} saving={saving} onComment={() => { if (!comment.trim()) return; void mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "comment.add", commentId: `comment_${crypto.randomUUID().replaceAll("-", "")}`, lessonId: activeLesson.id, body: comment.trim() }, "comment").then(() => setText("comment", "")); }} onReview={(submissionId, feedback) => mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "submission.review", submissionId, status: "reviewed", feedback }, "review")} />}</main>

			<aside className={s.right}>
				<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}><p className={s.sectionLabel}>Live room</p><span className={css({ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontFamily: "var(--mono-display)", fontSize: "0.65rem", color: networkStatus === "connected" ? "var(--course-green-dark, #14743c)" : "var(--amber, #e8a33d)" })}><span className={css({ h: "0.45rem", w: "0.45rem", borderRadius: "50%", bg: "currentColor" })} />{networkStatus}</span></div>
				<div className={css({ mt: "0.75rem", display: "grid", gap: "0.5rem" })}>{course.members.map((member) => <div key={member.accountId} className={css({ display: "flex", alignItems: "center", gap: "0.55rem", fontSize: "0.78rem" })}><span className={css({ position: "relative", display: "grid", h: "1.75rem", w: "1.75rem", placeItems: "center", borderRadius: "50%", bg: member.role === "teacher" || member.role === "owner" ? "var(--course-green)" : "var(--peer-blue, #3468b3)", fontWeight: 800, color: "white" })}>{member.displayName.charAt(0).toUpperCase()}<span className={css({ position: "absolute", right: "-1px", bottom: "-1px", h: "0.5rem", w: "0.5rem", border: "1px solid var(--paper-deep)", borderRadius: "50%", bg: online.has(member.accountId) ? "var(--phosphor, #4be388)" : "#9ba19a" })} /></span><span className={css({ minW: 0, flex: 1 })}><strong className={css({ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{memberName(member, viewer.accountId)}</strong><span className={css({ fontSize: "0.67rem", color: "var(--ink-soft)", textTransform: "uppercase" })}>{member.role}</span></span>{snapshot.permissions.canRequestTeacherAccess && member.role !== "owner" && member.role !== "teacher" && member.teacherAccess === "private" && <button type="button" onClick={() => void mutate({ id: newCourseOperationId(), courseId, baseRevision: course.revision, type: "teacher-access.request", memberAccountId: member.accountId }, "access")} className={css({ fontSize: "0.65rem", textDecoration: "underline" })}>request access</button>}</div>)}</div>
				<section className={css({ mt: "1.25rem", borderTop: "1px solid var(--ink)", pt: "1rem" })}><p className={s.sectionLabel}>Progress</p><div className={css({ mt: "0.6rem", h: "0.5rem", overflow: "hidden", border: "1px solid var(--ink)", bg: "var(--paper)" })}><div style={{ width: `${courseCompletionPercent(course, viewer)}%` }} className={css({ h: "100%", bg: "var(--course-green)" })} /></div><p className={css({ mt: "0.35rem", fontFamily: "var(--mono-display)", fontSize: "0.67rem" })}>{courseCompletionPercent(course, viewer)}% complete</p></section>
				<section className={css({ mt: "1.25rem", borderTop: "1px solid var(--ink)", pt: "1rem" })}><p className={s.sectionLabel}>Recent activity</p><div className={css({ mt: "0.6rem", display: "grid", gap: "0.65rem" })}>{course.activity.slice(0, 5).map((item) => <div key={item.id} className={css({ display: "grid", gridTemplateColumns: "0.5rem minmax(0, 1fr)", gap: "0.5rem", fontSize: "0.72rem" })}><span className={css({ mt: "0.3rem", h: "0.4rem", w: "0.4rem", borderRadius: "50%", bg: "var(--course-green)" })} /><span>{item.message}<small className={css({ display: "block", color: "var(--ink-soft)" })}>{formatRelative(item.createdAt)}</small></span></div>)}</div></section>
				<CourseTools snapshot={snapshot} activeLesson={activeLesson} materialTitle={materialTitle} setMaterialTitle={(value) => setText("materialTitle", value)} materialUrl={materialUrl} setMaterialUrl={(value) => setText("materialUrl", value)} cardFront={cardFront} setCardFront={(value) => setText("cardFront", value)} cardBack={cardBack} setCardBack={(value) => setText("cardBack", value)} saving={saving} mutate={mutate} onMaterialSaved={() => dispatch({ type: "material.cleared" })} onCardSaved={() => dispatch({ type: "card.cleared" })} />
				{snapshot.network?.publicKey && <details className={css({ mt: "1rem", borderTop: "1px solid var(--ink)", pt: "0.75rem" })}><summary className={css({ cursor: "pointer", fontFamily: "var(--mono-display)", fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase" })}>Pear feed</summary><p className={css({ mt: "0.5rem", overflowWrap: "anywhere", fontFamily: "var(--mono-body)", fontSize: "0.6rem", color: "var(--ink-soft)" })}>{snapshot.network.publicKey}</p></details>}
			</aside>
		</div>
		{inviteOpen && <CourseInviteDialog courseId={courseId} onClose={() => dispatch({ type: "invite.changed", open: false })} />}
	</div>;
}

function DeskView(props: { lesson: CourseLesson; moduleTitle: string; completed: boolean; noteText: string; setNoteText(value: string): void; sharedNoteVersion: number; answer: string; setAnswer(value: string): void; shareAnswer: boolean; setShareAnswer(value: boolean): void; saving: string; onComplete(): void; onSaveNote(): void; onSaveAnswer(): void }) {
	const { lesson } = props;
	return <article className={css({ mx: "auto", maxW: "48rem" })}><p className={s.sectionLabel}>{props.moduleTitle} · {lesson.estimatedMinutes ? `${lesson.estimatedMinutes} min` : "self paced"}</p><h2 className={css({ mt: "0.75rem", maxW: "18ch", fontFamily: "Georgia, serif", fontSize: { base: "2.35rem", md: "3.35rem" }, lineHeight: 1.02, letterSpacing: "-0.035em" })}>{lesson.title}</h2><p className={css({ mt: "0.8rem", fontFamily: "Georgia, serif", fontSize: "1.15rem", fontStyle: "italic", color: "var(--ink-soft)" })}>{lesson.summary}</p>
		{lesson.objectives.length > 0 && <div className={css({ mt: "1.5rem", borderLeft: "4px solid var(--course-green)", bg: "var(--course-wash, #ddebdd)", p: "1rem" })}><p className={s.sectionLabel}>By the end</p><ul className={css({ mt: "0.5rem", pl: "1.1rem", lineHeight: 1.65, listStyle: "square" })}>{lesson.objectives.map((objective) => <li key={objective}>{objective}</li>)}</ul></div>}
		<div className={css({ mt: "2rem", fontFamily: "Georgia, serif", fontSize: { base: "1.08rem", md: "1.17rem" }, lineHeight: 1.85, "& p + p": { mt: "1.25rem" } })}>{lesson.reading.split(/\n\n+/).map((paragraph) => <p key={paragraph.slice(0, 32)}>{paragraph}</p>)}</div>
		{lesson.exercise && <section className={css({ mt: "2.5rem", border: "2px solid var(--ink)", bg: "var(--paper)", boxShadow: "5px 5px 0 var(--amber, #e8a33d)" })}><header className={css({ borderBottom: "1px solid var(--ink)", px: "1rem", py: "0.65rem" })}><p className={s.sectionLabel}>Worked exercise</p></header><div className={css({ p: "1rem" })}><p className={css({ fontFamily: "Georgia, serif", fontSize: "1.1rem", lineHeight: 1.6 })}>{lesson.exercise.prompt}</p><textarea value={props.answer} onChange={(event) => props.setAnswer(event.target.value)} placeholder={lesson.exercise.placeholder} rows={7} className={cx(s.input, css({ mt: "1rem", resize: "vertical", lineHeight: 1.55 }))} /><div className={css({ mt: "0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}><label className={css({ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontSize: "0.78rem" })}><input type="checkbox" checked={props.shareAnswer} onChange={(event) => props.setShareAnswer(event.target.checked)} /> Share with peers</label><button type="button" className={cx(s.button, s.primaryButton)} disabled={!props.answer.trim() || props.saving === "answer"} onClick={props.onSaveAnswer}><Send size={14} /> {props.saving === "answer" ? "Saving…" : "Save work"}</button></div></div></section>}
		<section className={css({ mt: "2.5rem" })}><div className={css({ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "1rem" })}><div><p className={s.sectionLabel}>Shared notes · version {props.sharedNoteVersion}</p><h3 className={css({ mt: "0.25rem", fontFamily: "Georgia, serif", fontSize: "1.45rem" })}>The margin everyone can write in.</h3></div><StickyNote size={22} /></div><textarea value={props.noteText} onChange={(event) => props.setNoteText(event.target.value)} rows={7} className={cx(s.input, css({ mt: "0.8rem", resize: "vertical", bg: "#fff9dc", lineHeight: 1.55 }))} placeholder="Add a definition, question, or useful example…" /><div className={css({ mt: "0.65rem", display: "flex", justifyContent: "flex-end" })}><button type="button" className={s.button} disabled={props.saving === "note"} onClick={props.onSaveNote}>{props.saving === "note" ? "Saving…" : "Save shared notes"}</button></div></section>
		<div className={css({ mt: "2.5rem", display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--ink)", pt: "1rem" })}><button type="button" className={cx(s.button, props.completed && s.primaryButton)} onClick={props.onComplete}>{props.completed ? <Check size={15} /> : <Circle size={15} />}{props.completed ? "Lesson complete" : "Mark complete"}</button></div>
	</article>;
}

function RoomView({ snapshot, activeLesson, online, comment, setComment, saving, onComment, onReview }: { snapshot: CourseViewerSnapshot; activeLesson: CourseLesson; online: Set<string>; comment: string; setComment(value: string): void; saving: string; onComment(): void; onReview(submissionId: string, feedback: string): Promise<void> }) {
	const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
	const comments = snapshot.course.comments.filter((item) => item.lessonId === activeLesson.id);
	return <div className={css({ mx: "auto", maxW: "52rem" })}><p className={s.sectionLabel}>Course room · {activeLesson.title}</p><h2 className={css({ mt: "0.6rem", fontFamily: "Georgia, serif", fontSize: { base: "2.2rem", md: "3rem" }, lineHeight: 1.05 })}>Think where others can answer.</h2><p className={css({ mt: "0.75rem", maxW: "55ch", color: "var(--ink-soft)", lineHeight: 1.65 })}>Presence is live; course work and discussion remain here when everyone leaves.</p>
		<section className={css({ mt: "2rem", display: "grid", gap: "0.8rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } })}>{snapshot.course.members.map((member) => <div key={member.accountId} className={css({ border: "1px solid var(--ink)", bg: online.has(member.accountId) ? "var(--course-wash, #ddebdd)" : "var(--paper)", p: "1rem" })}><div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}><strong>{member.displayName}</strong><span className={css({ fontFamily: "var(--mono-display)", fontSize: "0.65rem", textTransform: "uppercase", color: online.has(member.accountId) ? "var(--course-green-dark, #14743c)" : "var(--ink-soft)" })}>{online.has(member.accountId) ? "in room" : "away"}</span></div><p className={css({ mt: "0.4rem", fontSize: "0.75rem", color: "var(--ink-soft)" })}>{member.role} · {courseCompletionPercent(snapshot.course, member)}% complete</p></div>)}</section>
		{snapshot.permissions.canReview && <section className={css({ mt: "2rem", border: "2px solid var(--ink)", bg: "var(--paper)", p: "1rem", boxShadow: "5px 5px 0 var(--peer-blue, #3468b3)" })}><p className={s.sectionLabel}>Teacher overview</p><h3 className={css({ mt: "0.35rem", fontFamily: "Georgia, serif", fontSize: "1.6rem" })}>Many learners, one clear view.</h3><div className={css({ mt: "1rem", overflowX: "auto" })}><table className={css({ w: "100%", borderCollapse: "collapse", fontSize: "0.78rem", "& th, & td": { borderBottom: "1px solid var(--ink)", px: "0.5rem", py: "0.65rem", textAlign: "left" } })}><thead><tr><th>Learner</th><th>Progress</th><th>Teacher access</th><th>Last active</th></tr></thead><tbody>{snapshot.course.members.filter((member) => member.role === "student" || member.role === "peer").map((member) => <tr key={member.accountId}><td>{member.displayName}</td><td>{courseCompletionPercent(snapshot.course, member)}%</td><td>{member.teacherAccess}</td><td>{formatRelative(member.progress.lastActiveAt)}</td></tr>)}</tbody></table></div><div className={css({ mt: "1.25rem", display: "grid", gap: "0.8rem" })}>{snapshot.course.submissions.length ? snapshot.course.submissions.map((submission) => { const learner = snapshot.course.members.find((member) => member.accountId === submission.accountId); const feedback = reviewDrafts[submission.id] ?? submission.review?.feedback ?? ""; return <article key={submission.id} className={css({ borderLeft: "3px solid var(--course-green)", bg: "var(--card)", p: "0.8rem" })}><div className={css({ display: "flex", justifyContent: "space-between", gap: "1rem", fontSize: "0.72rem" })}><strong>{learner?.displayName ?? "Learner"}</strong><span>{submission.review?.status ?? "needs review"}</span></div><p className={css({ mt: "0.6rem", whiteSpace: "pre-wrap", lineHeight: 1.55 })}>{submission.answer}</p><textarea rows={2} value={feedback} onChange={(event) => setReviewDrafts((current) => ({ ...current, [submission.id]: event.target.value }))} className={cx(s.input, css({ mt: "0.7rem", resize: "vertical" }))} placeholder="Teacher feedback…" /><div className={css({ mt: "0.5rem", display: "flex", justifyContent: "flex-end" })}><button type="button" className={cx(s.button, s.primaryButton)} disabled={saving === "review"} onClick={() => void onReview(submission.id, feedback)}>Mark reviewed</button></div></article>; }) : <p className={css({ fontSize: "0.8rem", color: "var(--ink-soft)" })}>Approved learner work will appear here. Private work remains hidden until access is granted.</p>}</div></section>}
		<section className={css({ mt: "2rem", borderTop: "2px solid var(--ink)", pt: "1.5rem" })}><div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}><MessageSquareText size={19} /><h3 className={css({ fontFamily: "Georgia, serif", fontSize: "1.5rem" })}>Lesson discussion</h3></div><div className={css({ mt: "1rem", display: "grid", gap: "0.75rem" })}>{comments.length ? comments.map((item) => { const member = snapshot.course.members.find((candidate) => candidate.accountId === item.accountId); return <article key={item.id} className={css({ borderLeft: "3px solid var(--peer-blue, #3468b3)", bg: "var(--paper)", p: "0.8rem" })}><div className={css({ display: "flex", justifyContent: "space-between", gap: "1rem", fontSize: "0.72rem" })}><strong>{member?.displayName ?? "Course member"}</strong><span className={css({ color: "var(--ink-soft)" })}>{formatRelative(item.createdAt)}</span></div><p className={css({ mt: "0.4rem", lineHeight: 1.55 })}>{item.body}</p></article>; }) : <p className={css({ color: "var(--ink-soft)", fontStyle: "italic" })}>No thread yet. Leave the first useful question.</p>}</div><div className={css({ mt: "1rem", display: "flex", alignItems: "stretch", gap: "0.5rem" })}><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} className={cx(s.input, css({ resize: "vertical" }))} placeholder="Ask or add context…" /><button type="button" className={cx(s.button, s.primaryButton)} disabled={!comment.trim() || saving === "comment"} onClick={onComment} aria-label="Post comment"><Send size={16} /></button></div></section>
	</div>;
}

type CourseToolsTextField = "courseTitle" | "courseDescription" | "lessonTitle" | "lessonReading";

interface CourseToolsDraft {
	courseTitle: string;
	courseDescription: string;
	lessonTitle: string;
	lessonReading: string;
}

type CourseToolsDraftAction =
	| { type: "course.synced"; title: string; description: string }
	| { type: "lesson.synced"; title: string; reading: string }
	| { type: "text.changed"; field: CourseToolsTextField; value: string };

function courseToolsDraftReducer(state: CourseToolsDraft, action: CourseToolsDraftAction): CourseToolsDraft {
	switch (action.type) {
		case "course.synced":
			return { ...state, courseTitle: action.title, courseDescription: action.description };
		case "lesson.synced":
			return { ...state, lessonTitle: action.title, lessonReading: action.reading };
		case "text.changed":
			return state[action.field] === action.value ? state : { ...state, [action.field]: action.value };
	}
}

function CourseTools(props: { snapshot: CourseViewerSnapshot; activeLesson: CourseLesson; materialTitle: string; setMaterialTitle(value: string): void; materialUrl: string; setMaterialUrl(value: string): void; cardFront: string; setCardFront(value: string): void; cardBack: string; setCardBack(value: string): void; saving: string; mutate: (operation: Parameters<typeof applyCourseOperation>[0], label: string) => Promise<void>; onMaterialSaved(): void; onCardSaved(): void }) {
	const { snapshot, activeLesson } = props;
	const [draft, dispatch] = useReducer(courseToolsDraftReducer, {
		courseTitle: snapshot.course.title,
		courseDescription: snapshot.course.description,
		lessonTitle: activeLesson.title,
		lessonReading: activeLesson.reading,
	});
	const { courseTitle, courseDescription, lessonTitle, lessonReading } = draft;
	useEffect(() => {
		dispatch({ type: "course.synced", title: snapshot.course.title, description: snapshot.course.description });
	}, [snapshot.course.title, snapshot.course.description]);
	useEffect(() => {
		dispatch({ type: "lesson.synced", title: activeLesson.title, reading: activeLesson.reading });
	}, [activeLesson.id, activeLesson.title, activeLesson.reading]);
	const module = snapshot.course.modules.find((candidate) => candidate.lessons.some((lesson) => lesson.id === activeLesson.id));
	if (!snapshot.permissions.canEditCourse && !snapshot.permissions.canEditDeck) return null;
	return <section className={css({ mt: "1.25rem", borderTop: "1px solid var(--ink)", pt: "1rem" })}><p className={s.sectionLabel}>Course tools</p>{snapshot.permissions.canEditCourse && <><details className={css({ mt: "0.6rem" })}><summary className={css({ cursor: "pointer", fontSize: "0.76rem", fontWeight: 700 })}>Edit course details</summary><div className={css({ mt: "0.5rem", display: "grid", gap: "0.4rem" })}><input value={courseTitle} onChange={(event) => dispatch({ type: "text.changed", field: "courseTitle", value: event.target.value })} className={s.input} placeholder="Course title" /><textarea value={courseDescription} onChange={(event) => dispatch({ type: "text.changed", field: "courseDescription", value: event.target.value })} className={s.input} rows={3} placeholder="Course description" /><button type="button" className={s.button} disabled={!courseTitle.trim() || props.saving === "course"} onClick={() => void props.mutate({ id: newCourseOperationId(), courseId: snapshot.course.id, baseRevision: snapshot.course.revision, type: "course.update", patch: { title: courseTitle, description: courseDescription } }, "course")}>Save course</button></div></details>{module && <details className={css({ mt: "0.7rem" })}><summary className={css({ cursor: "pointer", fontSize: "0.76rem", fontWeight: 700 })}>Edit this lesson</summary><div className={css({ mt: "0.5rem", display: "grid", gap: "0.4rem" })}><input value={lessonTitle} onChange={(event) => dispatch({ type: "text.changed", field: "lessonTitle", value: event.target.value })} className={s.input} placeholder="Lesson title" /><textarea value={lessonReading} onChange={(event) => dispatch({ type: "text.changed", field: "lessonReading", value: event.target.value })} className={s.input} rows={7} placeholder="Lesson reading" /><button type="button" className={s.button} disabled={!lessonTitle.trim() || props.saving === "lesson"} onClick={() => void props.mutate({ id: newCourseOperationId(), courseId: snapshot.course.id, baseRevision: snapshot.course.revision, type: "lesson.update", moduleId: module.id, lesson: { ...activeLesson, title: lessonTitle, reading: lessonReading } }, "lesson")}>Save lesson</button></div></details>}<details className={css({ mt: "0.7rem" })}><summary className={css({ cursor: "pointer", fontSize: "0.76rem", fontWeight: 700 })}>Add source link</summary><div className={css({ mt: "0.5rem", display: "grid", gap: "0.4rem" })}><input value={props.materialTitle} onChange={(event) => props.setMaterialTitle(event.target.value)} className={s.input} placeholder="Source title" /><input value={props.materialUrl} onChange={(event) => props.setMaterialUrl(event.target.value)} className={s.input} placeholder="https://…" type="url" /><button type="button" className={s.button} disabled={!props.materialTitle || !props.materialUrl || props.saving === "material"} onClick={() => void props.mutate({ id: newCourseOperationId(), courseId: snapshot.course.id, baseRevision: snapshot.course.revision, type: "material.add", material: { id: `material_${crypto.randomUUID().replaceAll("-", "")}`, kind: "link", title: props.materialTitle, url: props.materialUrl } }, "material").then(props.onMaterialSaved)}><Plus size={13} /> Add material</button></div></details></>}{snapshot.permissions.canEditDeck && <details className={css({ mt: "0.7rem" })}><summary className={css({ cursor: "pointer", fontSize: "0.76rem", fontWeight: 700 })}>Add Anki card</summary><div className={css({ mt: "0.5rem", display: "grid", gap: "0.4rem" })}><textarea value={props.cardFront} onChange={(event) => props.setCardFront(event.target.value)} className={s.input} rows={2} placeholder="Front" /><textarea value={props.cardBack} onChange={(event) => props.setCardBack(event.target.value)} className={s.input} rows={2} placeholder="Back" /><button type="button" className={s.button} disabled={!props.cardFront || !props.cardBack || props.saving === "card"} onClick={() => void props.mutate({ id: newCourseOperationId(), courseId: snapshot.course.id, baseRevision: snapshot.course.revision, type: "card.upsert", card: { id: `card_${crypto.randomUUID().replaceAll("-", "")}`, front: props.cardFront, back: props.cardBack, tags: [], lessonId: activeLesson.id } }, "card").then(props.onCardSaved)}><Plus size={13} /> Add card</button></div></details>}</section>;
}
