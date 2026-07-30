import { css } from "../../styled-system/css";

const styles = {
	lead: css({
		marginBottom: "1.25rem",
		maxWidth: "72ch",
		fontSize: "1rem",
		lineHeight: "1.7",
	}),
	paragraph: css({
		marginBottom: "1rem",
		maxWidth: "72ch",
		lineHeight: "1.65",
	}),
	heading: css({
		marginTop: "1.5rem",
		marginBottom: "0.625rem",
		fontSize: "1rem",
		fontWeight: "700",
	}),
	code: css({
		borderRadius: "0.25rem",
		background: "#1c211b",
		color: "#f1ece0",
		paddingInline: "0.25rem",
		fontSize: "0.875rem",
	}),
	list: css({
		marginBottom: "1rem",
		maxWidth: "72ch",
		paddingLeft: "1.25rem",
		listStyleType: "disc",
		fontSize: "0.875rem",
		lineHeight: "1.65",
		"& > * + *": { marginTop: "0.5rem" },
	}),
	note: css({
		marginBlock: "1.25rem",
		maxWidth: "72ch",
		border: "1px solid var(--border)",
		borderRadius: "0.375rem",
		background: "color-mix(in srgb, var(--muted) 35%, transparent)",
		padding: "1rem",
	}),
	noteTitle: css({ marginBottom: "0.375rem", fontWeight: "700" }),
	noteText: css({
		fontSize: "0.875rem",
		lineHeight: "1.6",
		color: "var(--muted-foreground)",
	}),
};

function Code({ children }: { children: React.ReactNode }) {
	return <code className={styles.code}>{children}</code>;
}

export function V270TeachingContinuityArticle() {
	return (
		<>
			<p className={styles.lead}>
				Keating 2.7 makes the structure behind a teaching session explicit
				without making the learner manage it. The model knows the complete
				vocabulary of questions it can ask, receives the learner&apos;s actual
				evidence before teaching, and can move through tools and linked study
				plans without setup turns. The interface, meanwhile, waits for complete
				controls, records what happened, and stays usable on a phone.
			</p>

			<h3 id="question-language" className={styles.heading}>
				The model now knows the whole question language
			</h3>
			<p className={styles.paragraph}>
				A type union in a generated schema was technically discoverable, but it
				did not tell a model why one format was better than another. The OpenUI
				prompt now includes a proper question catalogue and tells the tutor to
				choose from the learning operation rather than defaulting to multiple
				choice.
			</p>
			<ul className={styles.list}>
				<li>
					Conversational <Code>Question</Code> documents can use{" "}
					<Code>choice</Code>, <Code>text</Code>, <Code>blanks</Code>,{" "}
					<Code>classification</Code>, or <Code>matching</Code>.
				</li>
				<li>
					Scored <Code>Quiz</Code> documents can use{" "}
					<Code>multiple_choice</Code>, <Code>multi_select</Code>,{" "}
					<Code>true_false</Code>, <Code>fill_in</Code>,{" "}
					<Code>short_answer</Code>, <Code>transfer</Code>,{" "}
					<Code>slider</Code>, or <Code>dropdown</Code>.
				</li>
				<li>
					The prompt explains the different field names and control options,
					including labels, reasons, free-text alternatives, unique matches,
					and keyed matching feedback.
				</li>
			</ul>
			<p className={styles.paragraph}>
				A parser-validated sampler demonstrates every conversational format in
				one document. It is explicitly described as a grammar reference rather
				than a reason to produce a long form: real lessons should use the
				smallest set of questions that tests distinct kinds of thinking.
			</p>

			<h3 id="complete-interactions" className={styles.heading}>
				A control appears only when it is complete
			</h3>
			<p className={styles.paragraph}>
				The OpenUI parser is intentionally forgiving and can close unfinished
				input. That is useful after a response has arrived, but dangerous during
				streaming: a half-written question could become an empty form before its
				choices or answer field existed. Keating now commits only complete
				top-level statements while the fence is still streaming. The raw tail is
				retained for the next chunk, and the renderer mounts the control only
				when there is a complete program to show.
			</p>
			<p className={styles.paragraph}>
				Document revisions are part of the render identity as well, so updated
				workspace documents do not reuse stale component state. Together these
				changes preserve the speed of streamed interfaces without exposing a
				partial form to the learner.
			</p>

			<h3 id="linked-study-plans" className={styles.heading}>
				Study plans have depth, and they can lead to another plan
			</h3>
			<p className={styles.paragraph}>
				The canonical plan is now deliberately more substantial. Every
				top-level area must contain at least two levels beneath it: an area
				becomes lessons or subtopics, and those become concrete activities,
				exercises, artifacts, or checkpoints. The example includes outcomes,
				time estimates, and prerequisite identifiers at each useful level
				instead of treating a title as a lesson.
			</p>
			<p className={styles.paragraph}>
				A <Code>StudyPlan</Code> can also declare prerequisite, follow-up, and
				related plans through stable <Code>planId</Code> targets. Linked plans
				render as real anchors, reciprocal links can take the learner back to the
				foundational plan, and two hierarchy levels open by default so the added
				detail is visible rather than buried. Progress and the dependency graph
				still derive from the same plan structure.
			</p>

			<h3 id="complete-learner-context" className={styles.heading}>
				The tutor starts with evidence, not a summary of a summary
			</h3>
			<p className={styles.paragraph}>
				Session startup now loads the complete durable learner record before the
				first model turn: learner state and session history, every goal and
				curriculum step, raw quiz and question-check records, card reviews, and
				current flashcard decks with their SRS state. Nothing is silently cut to
				a top-N list.
			</p>
			<p className={styles.paragraph}>
				The same payload computes explicit coverage gaps: missing profile-belief
				categories, topics without performance or retention evidence, ungraded
				questions, empty curricula, and cards without review evidence. The
				prompt tells the model that absence is uncertainty, not a diagnosis and
				not permission to open every session with an interview.
			</p>

			<h3 id="tools-without-ceremony" className={styles.heading}>
				Available tools are available from the first turn
			</h3>
			<p className={styles.paragraph}>
				The capability-activation tool and its automatic continuation are gone.
				Keating now filters the complete registered tool set against the live
				runtime before the model responds. Media, improvement, voice, and the
				workspace operations appear when their backing environment exists; an
				offline backend does not advertise unusable schemas.
			</p>
			<p className={styles.paragraph}>
				Ordinary trusted text interactions no longer stop behind a generic
				confirmation modal. The security boundary is enforced where it carries
				information: unknown tools are rejected, code execution and destructive
				actions cannot originate from untrusted web content, and voice cannot
				invoke code execution, destructive work, or secret-bearing arguments.
				This removes approval theatre while keeping unsafe provenance
				fail-closed.
			</p>

			<h3 id="durable-quiz-evidence" className={styles.heading}>
				Quiz evidence now says what was actually measured
			</h3>
			<p className={styles.paragraph}>
				The old confidence-weighted score combined correctness with a slider the
				learner had to move for every answer. Keating 2.7 removes that slider and
				names the metric directly: partial-credit points. Objective correctness
				and partial credit remain visible, while open-ended answers stay pending
				until the model grades their meaning.
			</p>
			<p className={styles.paragraph}>
				Each attempt now has one stable result identifier and persists the full
				answer map, per-question credit, total and per-question timing, flagged
				questions, and pending open-ended ids. Later grading merges into that
				same record, clears the corresponding pending ids, and refreshes the
				derived learner profile. Reward and mastery evidence normalize objective
				and model-graded answers together rather than dropping the delayed
				verdict.
			</p>
			<div className={styles.note}>
				<div className={styles.noteTitle}>Old records remain readable</div>
				<p className={styles.noteText}>
					Legacy confidence and weighted-score fields are discarded when old
					quiz records are loaded. Existing objective scores remain the fallback
					when a partial-credit total was not stored.
				</p>
			</div>

			<h3 id="mobile-component-workshop" className={styles.heading}>
				The assessment surface is built for fingers as well as pointers
			</h3>
			<p className={styles.paragraph}>
				Quiz choices, navigation, bookmarks, retry actions, blank inputs, and
				result disclosures now use mobile-safe touch targets. Long topics and
				answers wrap instead of forcing the card wider than the viewport, action
				rows can share or take the full width, and the sticky active quiz is
				scrollable and dismissible on a short screen. Failed turns now offer a
				full-width <Code>Retry response</Code> action on mobile.
			</p>
			<p className={styles.paragraph}>
				Storybook now has live cases for open text questions, submitted
				multi-question forms, mobile quiz sessions, result cards, recovery
				alerts, and linked two-level study plans. A canonical{" "}
				<Code>just storybook</Code> command launches the component workshop, so
				these states can be exercised without reconstructing them in the full
				chat application.
			</p>

			<h3 id="release-27-verification" className={styles.heading}>
				Release integrity
			</h3>
			<p className={styles.paragraph}>
				The browser sandbox snapshot is regenerated from the same source used by
				the web app, and the historical Open Interfaces article now describes
				the complete-context, immediately available tool model accurately. The
				2.6 release note also uses “partial-credit points” rather than preserving
				the retired weighted-score name.
			</p>
			<p className={styles.paragraph}>
				The release gate covers root and web tests, version synchronization,
				TypeScript validation, production Vite and Nitro builds, Storybook, the
				generated NodePod files, and package-manifest verification. Focused tests
				also pin the question catalogue, partial-stream boundary, linked-plan
				anchors, permission policy, complete startup context, durable quiz
				grading, and learner-evidence calculations.
			</p>
		</>
	);
}
