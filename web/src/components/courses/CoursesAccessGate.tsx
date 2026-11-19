import { useState } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { KeatingBot } from "../KeatingBot";
import { usePostHog } from "@posthog/react";
import { Button, Card, Eyebrow, Loading, Note, Prose } from "../../design-system/kit";
import "../../pages/courses-mascot.css";
import {
	NotOrganicAccessPromptDialog,
	promptNotOrganicAccess,
} from "../NotOrganicAccessPromptDialog";
import { isNotOrganicFeatureEnabled } from "../../notorganic-provider";
import type { CoursesAccessState } from "../../courses/useCoursesAccess";

type CoursesAccessGateState = Exclude<CoursesAccessState, { status: "ready" }>;

export function CoursesAccessGate({ state, onRetry }: { state: CoursesAccessGateState; onRetry: () => void }) {
	const posthog = usePostHog();
	const [notice, setNotice] = useState("");

	// promptNotOrganicAccess resolves false both when the user declines and when
	// hosted access is switched off, so calling it while the feature is disabled
	// left this button doing nothing at all with no explanation.
	const checkAccount = async () => {
		if (!isNotOrganicFeatureEnabled()) {
			posthog?.capture("hosted_access_unavailable", {
				surface: "courses_gate",
				recovery: state.status === "loading" ? "loading" : state.recovery,
			});
			setNotice(
				"Hosted course workspaces aren't available yet — that access is still being built. Courses run today with your own API keys.",
			);
			return;
		}
		if (await promptNotOrganicAccess({ force: true })) onRetry();
	};

	return (
		<main className="courses-invitation">
			<Card as="section" className="courses-invitation-card" tone="hard">
				<KeatingBot variant="body" state={state.status === "loading" ? "loading" : "reading"} size={72} label="" />
				{state.status === "loading" ? (
					<Loading label="Checking your course workspace…" />
				) : (
					<>
						<Eyebrow>{state.recovery === "account" ? "Hosted course workspace" : "Course workspace"}</Eyebrow>
						<Prose><h1>A course is learning you can return to.</h1></Prose>
						<p>Detailed lessons, source material, shared notes, Anki cards, peer work, and teacher review stay together in one durable room.</p>
						<Note tone="warn" role="alert">{state.error}</Note>
						{state.recovery === "start-server" && <code>devenv tasks run keating:web</code>}
						{notice && <p role="status">{notice}</p>}
						{state.recovery === "account" ? (
							<Button variant="primary" onClick={() => void checkAccount()}>Check account <KeatingGlyph name="right" /></Button>
						) : (
							<Button variant="primary" onClick={onRetry}>Retry course access <KeatingGlyph name="right" /></Button>
						)}
						<details className="courses-gate-about">
							<summary>A place for your next question</summary>
							<p>Bring a subject you’re curious about. Keating helps you turn it into lessons, readings, and practice you can return to.</p>
						</details>
					</>
				)}
			</Card>
			{state.status === "unavailable" && state.recovery === "account" && <NotOrganicAccessPromptDialog />}
		</main>
	);
}
