import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, BookOpen, ShieldCheck } from "lucide-react";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { CourseApiError, joinCourse } from "../courses/client";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

export function CourseJoin() {
	useSeo({ title: "Join a course — Keating", description: "Accept a secure Keating course invitation." });
	const { token } = useParams({ strict: false }) as { token: string };
	const navigate = useNavigate();
	const [access, retry] = useCoursesAccess();
	const [joining, setJoining] = useState(false);
	const [error, setError] = useState("");
	const [needsConsent, setNeedsConsent] = useState(false);
	const attempted = useRef(false);

	const accept = async (acceptTeacherAccess: boolean) => {
		if (access.status !== "ready") return;
		setJoining(true);
		setError("");
		try {
			const snapshot = await joinCourse(token, access.account.displayName, acceptTeacherAccess);
			await navigate({ to: "/courses/$courseId", params: { courseId: snapshot.course.id }, replace: true });
		} catch (cause) {
			if (cause instanceof CourseApiError && cause.code === "course_teacher_access_consent_required") {
				setNeedsConsent(true);
			} else {
				setError(cause instanceof Error ? cause.message : "This invitation could not be accepted.");
			}
		} finally {
			setJoining(false);
		}
	};

	useEffect(() => {
		if (access.status !== "ready" || attempted.current) return;
		attempted.current = true;
		void accept(false);
	}, [access.status]);

	return <div className={css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" })}><Nav />{access.status !== "ready" ? <CoursesAccessGate state={access} onRetry={retry} /> : <main className={css({ mx: "auto", display: "grid", minH: "calc(100vh - 3.5rem)", maxW: "40rem", placeItems: "center", px: "1rem", py: "3rem" })}><section className={css({ w: "100%", border: "2px solid var(--ink)", bg: "var(--card)", p: { base: "1.5rem", md: "2.5rem" }, textAlign: "center", boxShadow: "6px 6px 0 var(--course-green, #1e9b50)" })}><div className={css({ mx: "auto", display: "grid", h: "3.5rem", w: "3.5rem", placeItems: "center", borderRadius: "50%", bg: "var(--course-wash, #ddebdd)" })}>{error ? <BookOpen size={25} /> : <ShieldCheck size={25} />}</div><h1 className={css({ mt: "1.25rem", fontFamily: "Georgia, serif", fontSize: "2rem" })}>{error ? "Invitation unavailable" : needsConsent ? "Teacher access at enrollment" : "Joining the course…"}</h1><p className={css({ mt: "0.75rem", color: error ? "var(--destructive)" : "var(--ink-soft)", lineHeight: 1.6 })}>{error || (needsConsent ? "This managed course shares your current and future course work, tutoring threads, submissions, and progress with its teachers. This approval applies only to this course." : "Your account is verified. Keating is adding this course to your library.")}</p>{needsConsent && <div className={css({ mt: "1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.75rem" })}><button type="button" disabled={joining} onClick={() => void accept(true)} className={css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", bg: "var(--course-green, #1e9b50)", px: "1rem", py: "0.7rem", fontWeight: 800, color: "white" })}>Approve and join <ArrowRight size={16} /></button><button type="button" onClick={() => navigate({ to: "/courses" })} className={css({ border: "1px solid var(--ink)", px: "1rem", py: "0.7rem", fontWeight: 700 })}>Decline</button></div>}{error && <button type="button" onClick={() => navigate({ to: "/courses" })} className={css({ mt: "1.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", bg: "var(--ink)", px: "1rem", py: "0.7rem", fontWeight: 700, color: "var(--paper)" })}>Open course library <ArrowRight size={16} /></button>}</section></main>}</div>;
}
