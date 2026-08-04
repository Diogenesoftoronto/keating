import { ArrowRight, KeyRound, RadioTower } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { css } from "../../../styled-system/css";
import {
	NotOrganicAccessPromptDialog,
	promptNotOrganicAccess,
} from "../NotOrganicAccessPromptDialog";
import type { CoursesAccessState } from "../../courses/useCoursesAccess";

export function CoursesAccessGate({ state, onRetry }: { state: CoursesAccessState; onRetry: () => void }) {
	const navigate = useNavigate();
	if (state.status === "loading") {
		return <div className={css({ py: "8rem", textAlign: "center", color: "var(--ink-soft)" })}>Checking your course workspace…</div>;
	}
	return (
		<main className={css({ mx: "auto", maxW: "58rem", px: "1rem", py: { base: "3rem", md: "5rem" } })}>
			<section className={css({ display: "grid", overflow: "hidden", border: "2px solid var(--ink)", bg: "var(--card)", boxShadow: "7px 7px 0 var(--ink)", md: { gridTemplateColumns: "minmax(0, 1.1fr) minmax(18rem, 0.9fr)" } })}>
				<div className={css({ p: { base: "1.5rem", md: "2.5rem" } })}>
					<div className={css({ mb: "1.5rem", display: "inline-flex", alignItems: "center", gap: "0.5rem", border: "1px solid var(--course-green, #1e9b50)", bg: "var(--course-wash, #ddebdd)", px: "0.625rem", py: "0.375rem", fontFamily: "var(--mono-display)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--course-green-dark, #14743c)" })}>
						<KeyRound size={14} /> Not Organic workspace
					</div>
					<h1 className={css({ maxW: "15ch", fontFamily: "Georgia, serif", fontSize: { base: "2.25rem", md: "3.25rem" }, lineHeight: 1.02, letterSpacing: "-0.035em" })}>A course is learning you can return to.</h1>
					<p className={css({ mt: "1.25rem", maxW: "52ch", color: "var(--ink-soft)", lineHeight: 1.7 })}>
						Detailed lessons, source material, shared notes, Anki cards, peer work, and teacher review stay together in one durable room.
					</p>
					<div className={css({ mt: "2rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" })}>
						{state.status === "signed-out" ? (
							<button type="button" onClick={async () => { if (await promptNotOrganicAccess({ force: true })) onRetry(); }} className={css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", bg: "var(--ink)", px: "1rem", py: "0.75rem", fontWeight: 700, color: "var(--paper)", _hover: { bg: "var(--course-green-dark, #14743c)" } })}>
								Check account <ArrowRight size={16} />
							</button>
						) : (
							<button type="button" onClick={() => navigate({ to: "/pricing" })} className={css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", bg: "var(--ink)", px: "1rem", py: "0.75rem", fontWeight: 700, color: "var(--paper)" })}>
								See Not Organic access <ArrowRight size={16} />
							</button>
						)}
					</div>
					{state.status === "signed-out" && <p className={css({ mt: "1rem", fontSize: "0.78rem", color: "var(--destructive)" })}>{state.error}</p>}
				</div>
				<div className={css({ borderTop: "2px solid var(--ink)", bg: "var(--terminal, #0c1510)", p: "2rem", color: "var(--paper)", md: { borderTop: 0, borderLeft: "2px solid var(--ink)" } })}>
					<RadioTower size={28} color="var(--phosphor, #4be388)" />
					<p className={css({ mt: "1.25rem", fontFamily: "var(--mono-display)", fontSize: "0.72rem", lineHeight: 1.8, letterSpacing: "0.06em", color: "var(--phosphor, #4be388)" })}>
						BROWSER → AUTHENTICATED GATEWAY<br />
						GATEWAY → PEAR NETWORK<br />
						TEACHER ACCESS → CONSENTED<br />
						SOURCE DOCUMENTS → IMMUTABLE
					</p>
					<p className={css({ mt: "1.5rem", fontSize: "0.8rem", lineHeight: 1.6, color: "#b9c7bc" })}>The browser never receives a Pear signing key or provider token.</p>
				</div>
			</section>
			<NotOrganicAccessPromptDialog />
		</main>
	);
}
