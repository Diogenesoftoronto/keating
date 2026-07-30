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

export function V280InspectableTutorArticle() {
	return (
		<>
			<p className={styles.lead}>
				Keating 2.8 closes a gap between having workspace tools and knowing
				when to use them. When source access is live, the tutor is now told what
				it can inspect, where Keating&apos;s code lives, and that a question about
				its own behavior should begin with evidence. This release also separates
				whether reasoning is available from whether its disclosure starts open,
				so transparency no longer means surrendering control of the transcript.
			</p>

			<h3 id="runtime-can-read" className={styles.heading}>
				The tutor knows when it can read its own implementation
			</h3>
			<p className={styles.paragraph}>
				Registering a tool schema was not enough. A model could technically
				discover <Code>workspace_inspect</Code> and still answer from memory,
				claim that it could not see the code, or ask the learner to paste a file
				that was already mounted. Keating now adds a runtime-derived workspace
				section to the system prompt whenever a real inspection adapter is
				connected.
			</p>
			<p className={styles.paragraph}>
				The guidance is deliberately operational: inspect before guessing about
				a bug or runtime behavior, batch related reads, and do not deny access
				that exists in the current session. It sits outside the evolvable persona
				prompt, so restoring an older session or optimized teaching prompt cannot
				accidentally erase the live capability notice.
			</p>

			<h3 id="tools-match-runtime" className={styles.heading}>
				The instructions follow the tools that are actually connected
			</h3>
			<p className={styles.paragraph}>
				The workspace paragraph is assembled from the current runtime rather
				than hard-coded into every session. It advertises inspection whenever
				that operation is available, command execution only when the adapter can
				execute, and precise changes only when an editing path is connected.
				Offline sessions receive no fictional workspace promise.
			</p>
			<p className={styles.paragraph}>
				Keating rebuilds the system prompt when the runtime finishes booting or
				changes, alongside the runtime-filtered tool set introduced in 2.7. The
				capability marker is replaced rather than appended repeatedly, which
				keeps long-lived and restored sessions accurate without accumulating
				duplicate instructions.
			</p>

			<h3 id="nodepod-source-paths" className={styles.heading}>
				NodePod inspection now reaches the files it describes
			</h3>
			<p className={styles.paragraph}>
				In the browser sandbox, Keating&apos;s bundled source snapshot is mounted
				at <Code>/workspace</Code>. The prompt points the model toward the useful
				areas—<Code>/workspace/src/core</Code>,{" "}
				<Code>/workspace/pi/prompts</Code>, and{" "}
				<Code>/workspace/web/src/keating</Code>—and the composed inspection tool
				now normalizes relative paths into that mounted tree.
			</p>
			<ul className={styles.list}>
				<li>
					Directory requests route to the NodePod <Code>fs.list</Code>{" "}
					operation, which is now implemented by the runtime.
				</li>
				<li>
					Source reads route through <Code>fs.read</Code> with explicit UTF-8
					decoding, so TypeScript arrives as readable text.
				</li>
				<li>
					Diff requests use the sandbox&apos;s existing source-diff path instead
					of pretending the browser mount is a remote host filesystem.
				</li>
			</ul>
			<p className={styles.paragraph}>
				The generated NodePod boot snapshot is refreshed with the same changes,
				so the code the model can inspect and the runtime executing those tools
				stay in sync.
			</p>

			<h3 id="reasoning-controls" className={styles.heading}>
				Reasoning is available without opening itself
			</h3>
			<p className={styles.paragraph}>
				Reasoning remains visible by default as a disclosure inside assistant
				messages, but a streaming response no longer forces that disclosure
				open. The ordinary transcript therefore starts compact while preserving
				a clear <Code>Reasoning</Code> control for learners who want to inspect
				it.
			</p>
			<p className={styles.paragraph}>
				A separate persisted setting, <strong>Open reasoning automatically</strong>,
				lets learners choose the opposite default. When enabled, each reasoning
				disclosure starts expanded; when disabled, it starts collapsed and can
				still be opened manually. Turning off <strong>Show reasoning</strong>{" "}
				hides the disclosure entirely and disables the dependent auto-open
				toggle, keeping visibility and initial expansion as two explicit choices.
			</p>
			<div className={styles.note}>
				<div className={styles.noteTitle}>Display is not reasoning effort</div>
				<p className={styles.noteText}>
					Neither interface toggle changes how much the selected model thinks.
					The separate Reasoning Level setting continues to control model
					effort; these settings control only what the transcript shows and
					whether it begins expanded.
				</p>
			</div>

			<h3 id="reasoning-storybook" className={styles.heading}>
				The disclosure states are inspectable in Storybook
			</h3>
			<p className={styles.paragraph}>
				The canonical <Code>just storybook</Code> workshop now includes dedicated
				reasoning stories for all three behaviors: available and collapsed,
				opened by the learner, and initially expanded by preference. Interaction
				assertions exercise the native disclosure state and confirm that the
				reasoning body becomes visible when expected.
			</p>

			<h3 id="release-28-verification" className={styles.heading}>
				Release integrity
			</h3>
			<p className={styles.paragraph}>
				Focused settings and chat tests pin the new default and persistence
				rules. Workspace contract tests verify that NodePod listings, reads, and
				diffs reach the correct VFS operations, while capability tests pin the
				runtime-only prompt and its duplicate-removal behavior. The complete web
				suite, TypeScript check, production Vite and Nitro build, live Storybook
				index, version synchronization, and generated NodePod snapshot form the
				release gate.
			</p>
		</>
	);
}
