import { useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AppBar, Button, Card, DefinitionList, Loading, Note } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { KeatingBot } from "../components/KeatingBot";
import "./courses-mascot.css";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { CourseApiError, joinCourse } from "../courses/client";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

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

	return (
		<div className="courses-join">
			<AppBar title="Course invitation" back={{ label: "Courses", to: "/courses" }} />
			{access.status !== "ready" ? (
				<CoursesAccessGate state={access} onRetry={retry} />
			) : (
				<main className="courses-invitation">
					<CourseInvitationCard
						error={error}
						needsConsent={needsConsent}
						joining={joining}
						onApprove={approveTeacherAccess}
						onDecline={declineTeacherAccess}
						onOpenLibrary={() => void navigate({ to: "/courses" })}
					/>
				</main>
			)}
		</div>
	);
}

export function CourseInvitationCard({ error, needsConsent, joining, onApprove, onDecline, onOpenLibrary }: {
	error: string;
	needsConsent: boolean;
	joining: boolean;
	onApprove(): void;
	onDecline(): void;
	onOpenLibrary(): void;
}) {
	const heading = error ? "Invitation unavailable" : needsConsent ? "Teacher access at enrollment" : "Joining the course…";
	return (
		<Card as="section" tone="hard" className="courses-invitation-card" aria-labelledby="courses-invitation-title">
			<KeatingBot state="letter" size={64} label="" />
			<h1 className="k-halftone" id="courses-invitation-title">{heading}</h1>
			{error && <Note data-glyph-host tone="warn" role="alert">{error}</Note>}
			{needsConsent ? (
				<>
					<DefinitionList items={[
						{ term: "Who can see it", detail: "The teachers of this managed course." },
						{ term: "What they can see", detail: "Your current and future course work, tutoring threads, submissions, and progress." },
						{ term: "Scope", detail: "This approval applies only to this course." },
					]} />
					<div className="courses-invitation-actions">
						<Button variant="ghost" disabled={joining} onClick={onDecline}>Decline</Button>
						<Button variant="primary" busy={joining} onClick={onApprove}>
							Approve and join <KeatingGlyph name="right" />
						</Button>
					</div>
				</>
			) : !error && <Loading label="Your account is verified. Keating is adding this course to your library." />}
			{error && <Button variant="ghost" onClick={onOpenLibrary}>Open course library <KeatingGlyph name="right" /></Button>}
		</Card>
	);
}
