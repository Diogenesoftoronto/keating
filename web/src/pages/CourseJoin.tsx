import { useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, BookOpen, ShieldCheck } from "lucide-react";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { CourseApiError, joinCourse } from "../courses/client";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

const styles = {
	page: css({
		minH: "100vh",
		bg: "var(--paper)",
		color: "var(--ink)",
	}),
	main: css({
		mx: "auto",
		display: "grid",
		minH: "calc(100vh - 3.5rem)",
		maxW: "40rem",
		placeItems: "center",
		px: "1rem",
		py: "3rem",
	}),
	card: css({
		w: "100%",
		border: "2px solid var(--ink)",
		bg: "var(--card)",
		p: { base: "1.5rem", md: "2.5rem" },
		textAlign: "center",
		boxShadow: "6px 6px 0 var(--course-green, #1e9b50)",
	}),
	icon: css({
		mx: "auto",
		display: "grid",
		h: "3.5rem",
		w: "3.5rem",
		placeItems: "center",
		borderRadius: "50%",
		bg: "var(--course-wash, #ddebdd)",
	}),
	title: css({
		mt: "1.25rem",
		fontFamily: "Georgia, serif",
		fontSize: "2rem",
	}),
	actions: css({
		mt: "1.5rem",
		display: "flex",
		flexWrap: "wrap",
		justifyContent: "center",
		gap: "0.75rem",
	}),
	approveButton: css({
		display: "inline-flex",
		alignItems: "center",
		gap: "0.5rem",
		bg: "var(--course-green, #1e9b50)",
		px: "1rem",
		py: "0.7rem",
		fontWeight: 800,
		color: "white",
	}),
	declineButton: css({
		border: "1px solid var(--ink)",
		px: "1rem",
		py: "0.7rem",
		fontWeight: 700,
	}),
	libraryButton: css({
		mt: "1.5rem",
		display: "inline-flex",
		alignItems: "center",
		gap: "0.5rem",
		bg: "var(--ink)",
		px: "1rem",
		py: "0.7rem",
		fontWeight: 700,
		color: "var(--paper)",
	}),
};

export function CourseJoin() {
	useSeo({
		title: "Join a course — Keating",
		description: "Accept a secure Keating course invitation.",
	});

	const posthog = usePostHog();
	const { token } = useParams({ strict: false }) as { token: string };
	const navigate = useNavigate();
	const [access, retry] = useCoursesAccess();
	const [joining, setJoining] = useState(false);
	const [error, setError] = useState("");
	const [needsConsent, setNeedsConsent] = useState(false);
	const attempted = useRef(false);

	const accept = async (acceptTeacherAccess: boolean) => {
		if (access.status !== "ready") return;

		posthog?.capture("course_join_attempted", {
			teacher_access_approved: acceptTeacherAccess,
			workspace_mode: access.account.mode,
		});

		setJoining(true);
		setError("");

		try {
			const snapshot = await joinCourse(
				token,
				access.account.displayName,
				acceptTeacherAccess,
			);

			posthog?.capture("course_join_completed", {
				teacher_access_approved: acceptTeacherAccess,
				workspace_mode: access.account.mode,
			});

			await navigate({
				to: "/courses/$courseId",
				params: { courseId: snapshot.course.id },
				replace: true,
			});
		} catch (cause) {
			if (
				cause instanceof CourseApiError &&
				cause.code === "course_teacher_access_consent_required"
			) {
				setNeedsConsent(true);
				posthog?.capture("course_teacher_access_consent_shown", {
					workspace_mode: access.account.mode,
				});
			} else {
				posthog?.capture("course_join_failed", {
					teacher_access_approved: acceptTeacherAccess,
					workspace_mode: access.account.mode,
					failure_type: cause instanceof CourseApiError ? cause.code : "unexpected",
				});
				setError(
					cause instanceof Error
						? cause.message
						: "This invitation could not be accepted.",
				);
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

	const approveTeacherAccess = () => {
		if (access.status !== "ready") return;
		posthog?.capture("course_teacher_access_consent_decided", {
			decision: "approved",
			workspace_mode: access.account.mode,
		});
		void accept(true);
	};

	const declineTeacherAccess = () => {
		if (access.status !== "ready") return;
		posthog?.capture("course_teacher_access_consent_decided", {
			decision: "declined",
			workspace_mode: access.account.mode,
		});
		void navigate({ to: "/courses" });
	};

	const heading = error
		? "Invitation unavailable"
		: needsConsent
			? "Teacher access at enrollment"
			: "Joining the course…";

	const message =
		error ||
		(needsConsent
			? "This managed course shares your current and future course work, tutoring threads, submissions, and progress with its teachers. This approval applies only to this course."
			: "Your account is verified. Keating is adding this course to your library.");

	return (
		<div className={styles.page}>
			<Nav />

			{access.status !== "ready" ? (
				<CoursesAccessGate state={access} onRetry={retry} />
			) : (
				<main className={styles.main}>
					<section className={styles.card}>
						<div className={styles.icon}>
							{error ? <BookOpen size={25} /> : <ShieldCheck size={25} />}
						</div>

						<h1 className={styles.title}>{heading}</h1>
						<p
							className={css({
								mt: "0.75rem",
								color: error ? "var(--destructive)" : "var(--ink-soft)",
								lineHeight: 1.6,
							})}
						>
							{message}
						</p>

						{needsConsent ? (
							<div className={styles.actions}>
								<button
									type="button"
									disabled={joining}
									onClick={approveTeacherAccess}
									className={styles.approveButton}
								>
									Approve and join <ArrowRight size={16} />
								</button>
								<button
									type="button"
									onClick={declineTeacherAccess}
									className={styles.declineButton}
								>
									Decline
								</button>
							</div>
						) : null}

						{error ? (
							<button
								type="button"
								onClick={() => void navigate({ to: "/courses" })}
								className={styles.libraryButton}
							>
								Open course library <ArrowRight size={16} />
							</button>
						) : null}
					</section>
				</main>
			)}
		</div>
	);
}
