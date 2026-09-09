import { useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { KeatingBot } from "../KeatingBot";
import { usePostHog } from "@posthog/react";
import { css } from "../../../styled-system/css";
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

	if (state.status === "loading") {
		return <main className={css({ py: "5rem", textAlign: "center", color: "var(--ink-soft)" })}>
			<KeatingBot variant="body" state="loading" size={144} label="" />
			<p role="status">Checking your course workspace…</p>
		</main>;
	}
	return (
		<main className={css({ mx: "auto", maxW: "58rem", px: "1rem", py: { base: "3rem", md: "5rem" } })}>
			<section className={css({ display: "grid", overflow: "hidden", border: "2px solid var(--ink)", bg: "var(--card)", boxShadow: "7px 7px 0 var(--ink)", md: { gridTemplateColumns: "minmax(0, 1.1fr) minmax(18rem, 0.9fr)" } })}>
				<div className={css({ p: { base: "1.5rem", md: "2.5rem" } })}>
					<div className={css({ mb: "1.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", border: "1px solid var(--course-green, #1e9b50)", bg: "var(--course-wash, #ddebdd)", px: "0.625rem", py: "0.375rem", fontFamily: "var(--mono-display)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--course-green-dark, #14743c)" })}>
						<KeyRound size={14} /> {state.recovery === "account" ? "Hosted course workspace" : "Course workspace"}
					</div>
					<h1 className={css({ maxW: "15ch", fontFamily: "Georgia, serif", fontSize: { base: "2.25rem", md: "3.25rem" }, lineHeight: 1.02, letterSpacing: "-0.035em" })}>A course is learning you can return to.</h1>
					<p className={css({ mt: "1.25rem", maxW: "52ch", color: "var(--ink-soft)", lineHeight: 1.7 })}>
						Detailed lessons, source material, shared notes, Anki cards, peer work, and teacher review stay together in one durable room.
					</p>
					<div className={css({ mt: "2rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" })}>
						{state.recovery === "account" ? (
							<button type="button" onClick={() => { void checkAccount(); }} className={css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", bg: "var(--ink)", px: "1rem", py: "0.75rem", fontWeight: 700, color: "var(--paper)", _hover: { bg: "var(--course-green-dark, #14743c)" } })}>
								Check account <ArrowRight size={16} />
							</button>
						) : (
							<button type="button" onClick={onRetry} className={css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", bg: "var(--ink)", px: "1rem", py: "0.75rem", fontWeight: 700, color: "var(--paper)" })}>
								Retry course access <ArrowRight size={16} />
							</button>
						)}
					</div>
					<p role="alert" className={css({ mt: "1rem", fontSize: "0.78rem", color: "var(--destructive)" })}>{state.error}</p>
					{notice ? (
						<p role="status" className={css({ mt: "0.75rem", maxW: "52ch", fontSize: "0.78rem", lineHeight: 1.6, color: "var(--ink-soft)" })}>{notice}</p>
					) : null}
					{state.recovery === "start-server" ? (
						<code className={css({ mt: "0.75rem", display: "block", overflowX: "auto", bg: "var(--ink)", px: "0.75rem", py: "0.625rem", fontFamily: "var(--mono-body)", fontSize: "0.75rem", color: "var(--paper)", whiteSpace: "nowrap" })}>
							devenv tasks run keating:web
						</code>
					) : null}
				</div>
				<div className={css({ borderTop: "2px solid var(--ink)", bg: "var(--terminal, #0c1510)", p: "2rem", color: "var(--paper)", md: { borderTop: 0, borderLeft: "2px solid var(--ink)" } })}>
					<div className={css({ textAlign: "center" })}><KeatingBot variant="body" state="reading" size={192} label="" /></div>
					<p className={css({ mt: "1.25rem", fontFamily: "var(--mono-display)", fontSize: "0.72rem", lineHeight: 1.8, letterSpacing: "0.06em", color: "var(--phosphor, #4be388)" })}>
						A PLACE FOR YOUR NEXT QUESTION
					</p>
					<p className={css({ mt: "1.5rem", fontSize: "0.8rem", lineHeight: 1.6, color: "#b9c7bc" })}>Bring a subject you’re curious about. Keating helps you turn it into lessons, readings, and practice you can return to.</p>
				</div>
			</section>
			{state.recovery === "account" && <NotOrganicAccessPromptDialog />}
		</main>
	);
}
