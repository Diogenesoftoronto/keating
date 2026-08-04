import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Clock3, Plus, Users } from "lucide-react";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { createCourse, listCourses, starterCourse } from "../courses/client";
import type { CourseListItem } from "../courses/contracts";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

function CourseLibrary({ displayName }: { displayName: string }) {
	const navigate = useNavigate();
	const [courses, setCourses] = useState<CourseListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		listCourses()
			.then((items) => { if (!cancelled) setCourses(items); })
			.catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Courses could not be loaded."); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, []);

	const createStarter = async () => {
		setCreating(true);
		setError("");
		try {
			const snapshot = await createCourse({ ...starterCourse, displayName });
			await navigate({ to: "/courses/$courseId", params: { courseId: snapshot.course.id } });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "The course could not be created.");
		} finally {
			setCreating(false);
		}
	};

	return (
		<main className={css({ mx: "auto", maxW: "72rem", px: "1rem", py: { base: "2rem", md: "3rem" } })}>
			<header className={css({ display: "flex", flexDir: { base: "column", sm: "row" }, alignItems: { sm: "end" }, justifyContent: "space-between", gap: "1.5rem", borderBottom: "2px solid var(--ink)", pb: "1.5rem" })}>
				<div>
					<p className={css({ fontFamily: "var(--mono-display)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--course-green-dark, #14743c)" })}>Course library</p>
					<h1 className={css({ mt: "0.35rem", fontFamily: "Georgia, serif", fontSize: { base: "2.4rem", md: "3.5rem" }, lineHeight: 1 })}>Learning with a spine.</h1>
					<p className={css({ mt: "0.8rem", maxW: "54ch", color: "var(--ink-soft)", lineHeight: 1.6 })}>Lesson plans that carry their readings, practice, peers, and progress with them.</p>
				</div>
				<button type="button" onClick={() => void createStarter()} disabled={creating} className={css({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", border: "2px solid var(--ink)", bg: "var(--course-green, #1e9b50)", px: "1rem", py: "0.75rem", fontWeight: 800, color: "white", boxShadow: "4px 4px 0 var(--ink)", _hover: { transform: "translate(1px, 1px)", boxShadow: "3px 3px 0 var(--ink)" }, _disabled: { opacity: 0.6 } })}>
					<Plus size={17} /> {creating ? "Creating…" : "New course"}
				</button>
			</header>

			{error && <p role="alert" className={css({ mt: "1rem", borderLeft: "4px solid var(--destructive)", bg: "color-mix(in srgb, var(--destructive) 7%, var(--card))", p: "0.75rem", color: "var(--destructive)" })}>{error}</p>}
			{loading ? (
				<p className={css({ py: "5rem", textAlign: "center", color: "var(--ink-soft)" })}>Opening your library…</p>
			) : courses.length === 0 ? (
				<section className={css({ mt: "2rem", display: "grid", border: "2px solid var(--ink)", bg: "var(--card)", md: { gridTemplateColumns: "1fr 1fr" } })}>
					<div className={css({ p: { base: "1.5rem", md: "2.5rem" } })}>
						<BookOpen size={30} />
						<h2 className={css({ mt: "1.25rem", fontFamily: "Georgia, serif", fontSize: "2rem" })}>Build the first room.</h2>
						<p className={css({ mt: "0.75rem", color: "var(--ink-soft)", lineHeight: 1.65 })}>Start with a worked causal inference course, then replace its lessons with your own. Sharing and live co-work are ready from the first lesson.</p>
						<button type="button" onClick={() => void createStarter()} disabled={creating} className={css({ mt: "1.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", bg: "var(--ink)", px: "1rem", py: "0.75rem", fontWeight: 700, color: "var(--paper)" })}>Create starter course <ArrowRight size={16} /></button>
					</div>
					<div className={css({ borderTop: "2px solid var(--ink)", bg: "var(--course-wash, #ddebdd)", p: { base: "1.5rem", md: "2.5rem" }, md: { borderTop: 0, borderLeft: "2px solid var(--ink)" } })}>
						<p className={css({ fontFamily: "var(--mono-display)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em" })}>STARTER CONTENTS</p>
						<ul className={css({ mt: "1.25rem", display: "grid", gap: "1rem", color: "var(--ink-soft)" })}>
							<li>03 detailed lessons</li><li>01 worked exercise</li><li>Shared notes and discussion</li><li>Teacher consent workflow</li><li>QR and link invitations</li>
						</ul>
					</div>
				</section>
			) : (
				<section aria-label="Your courses" className={css({ mt: "2rem", display: "grid", gap: "1rem", md: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, xl: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } })}>
					{courses.map((course) => (
						<Link key={course.id} to="/courses/$courseId" params={{ courseId: course.id }} className={css({ display: "flex", minH: "15rem", flexDir: "column", border: "2px solid var(--ink)", bg: "var(--card)", p: "1.25rem", color: "inherit", textDecoration: "none", boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink) 25%, transparent)", _hover: { borderColor: "var(--course-green-dark, #14743c)", transform: "translateY(-2px)" } })}>
							<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}><span className={css({ bg: "var(--course-wash, #ddebdd)", px: "0.5rem", py: "0.25rem", fontFamily: "var(--mono-display)", fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", color: "var(--course-green-dark, #14743c)" })}>{course.role}</span><ArrowRight size={17} /></div>
							<h2 className={css({ mt: "1.25rem", fontFamily: "Georgia, serif", fontSize: "1.6rem", lineHeight: 1.15 })}>{course.title}</h2>
							<p className={css({ mt: "0.65rem", color: "var(--ink-soft)", lineHeight: 1.5, lineClamp: 3 })}>{course.description || "A shared course in progress."}</p>
							<div className={css({ mt: "auto", display: "flex", flexWrap: "wrap", gap: "0.9rem", pt: "1.5rem", fontSize: "0.75rem", color: "var(--ink-soft)" })}><span className={css({ display: "inline-flex", alignItems: "center", gap: "0.3rem" })}><BookOpen size={14} /> {course.lessonCount} lessons</span><span className={css({ display: "inline-flex", alignItems: "center", gap: "0.3rem" })}><Users size={14} /> {course.memberCount}</span><span className={css({ display: "inline-flex", alignItems: "center", gap: "0.3rem" })}><Clock3 size={14} /> {course.completedLessons} done</span></div>
						</Link>
					))}
				</section>
			)}
		</main>
	);
}

export function Courses() {
	useSeo({ title: "Courses — Keating", description: "Durable, shareable lesson plans for peers, students, and teachers." });
	const [access, retry] = useCoursesAccess();
	return <div className={css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" })}><Nav />{access.status === "ready" ? <CourseLibrary displayName={access.account.displayName} /> : <CoursesAccessGate state={access} onRetry={retry} />}</div>;
}
