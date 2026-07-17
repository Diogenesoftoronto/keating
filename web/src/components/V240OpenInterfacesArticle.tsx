import { css } from "../../styled-system/css";

const styles = {
	paragraph: css({ marginBottom: "1rem", maxWidth: "72ch", lineHeight: "1.65" }),
	lead: css({ marginBottom: "1.25rem", maxWidth: "72ch", fontSize: "1rem", lineHeight: "1.7" }),
	heading: css({ marginTop: "1.5rem", marginBottom: "0.625rem", fontSize: "1rem", fontWeight: "700" }),
	link: css({ color: "#d5604b", textDecoration: "underline", textUnderlineOffset: "0.15em" }),
	code: css({
		borderRadius: "0.25rem",
		background: "#1c211b",
		color: "#f1ece0",
		paddingInline: "0.25rem",
		fontSize: "0.875rem",
	}),
	codeBlock: css({
		marginBottom: "1rem",
		overflowX: "auto",
		borderRadius: "0.375rem",
		background: "#1c211b",
		padding: "0.75rem 1rem",
		color: "#f1ece0",
		fontSize: "0.8125rem",
		lineHeight: "1.6",
	}),
	note: css({
		marginBlock: "1.25rem",
		border: "1px solid var(--border)",
		borderRadius: "0.375rem",
		background: "color-mix(in srgb, var(--muted) 35%, transparent)",
		padding: "1rem",
	}),
	noteTitle: css({ marginBottom: "0.375rem", fontWeight: "700" }),
	noteText: css({ maxWidth: "72ch", fontSize: "0.875rem", lineHeight: "1.6", color: "var(--muted-foreground)" }),
	tableWrap: css({ marginBlock: "1rem 1.25rem", overflowX: "auto" }),
	table: css({ width: "100%", minWidth: "40rem", borderCollapse: "collapse", fontSize: "0.8125rem" }),
	tableCell: css({ borderBottom: "1px solid color-mix(in srgb, var(--border) 40%, transparent)", paddingBlock: "0.625rem", paddingRight: "1rem", verticalAlign: "top", lineHeight: "1.5" }),
	list: css({ marginBottom: "1rem", paddingLeft: "1.25rem", listStyleType: "disc", fontSize: "0.875rem", lineHeight: "1.6", "& > * + *": { marginTop: "0.5rem" } }),
};

function Code({ children }: { children: React.ReactNode }) {
	return <code className={styles.code}>{children}</code>;
}

function CodeBlock({ children }: { children: string }) {
	return <pre className={styles.codeBlock}>{children}</pre>;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" className={styles.link}>
			{children}
		</a>
	);
}

export function V240OpenInterfacesArticle() {
	return (
		<>
			<p className={styles.lead}>
				Keating 2.4 changes the unit of collaboration between a learner and a model. A teaching move can now arrive as a streamed, typed interface that both participants can inspect and act on, while ordinary explanation remains ordinary prose. The model gets more freedom over composition, but less reason to spend turns calling tools just to put a question or a study plan on screen.
			</p>

			<h3 id="understanding-bottleneck" className={styles.heading}>Understanding is a product constraint</h3>
			<p className={styles.paragraph}>
				In <ExternalLink href="https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck.html">Understanding is the new bottleneck</ExternalLink>, Geoffrey Litt argues that understanding matters because it lets a human participate in the next creative loop, not only approve the last one. Explanations, retrieval checks, manipulable micro-worlds, and shared spaces can keep the human close enough to the work to form the next idea.
			</p>
			<p className={styles.paragraph}>
				Rebecca Sutter&apos;s <ExternalLink href="https://rlsutter.substack.com/p/understanding-needs-permission">Understanding needs permission</ExternalLink> adds the constraint Keating cannot ignore: a speed regulator only works when a person is allowed to use it. A product cannot grant organizational permission, but it can reduce the cost of stopping to inspect, answer, revise, and resume. In 2.4, those actions move into the main teaching surface instead of living behind extra commands and tool-call ceremony.
			</p>

			<h3 id="ui-as-protocol" className={styles.heading}>The interface is now part of the teaching protocol</h3>
			<p className={styles.paragraph}>
				The web agent receives a generated grammar for Keating&apos;s curated OpenUI library. During a response it can mix Markdown with fenced OpenUI documents, and the browser can begin rendering a document before the whole response has finished. The library contains explanations, callouts, questions, quizzes, flashcards, study plans, concept maps, images, animations, and shared notes, all composed inside one <Code>LearningSurface</Code> root.
			</p>
			<p className={styles.paragraph}>
				This is deliberately not a request for every sentence to become a widget. The prompt tells the model to use Markdown when prose is enough and OpenUI when manipulating or responding to a component materially improves understanding. Each interactive document also declares a lifecycle: <Code>ephemeral</Code> for the current moment, <Code>resumable</Code> for unfinished work in a session, or <Code>workspace</Code> for a learner-owned artifact.
			</p>

			<h3 id="context-without-ceremony" className={styles.heading}>Learner context without an opening round of tool calls</h3>
			<p className={styles.paragraph}>
				Previously, the default prompt could encourage the model to call learner-state, timeline, due-review, and goal tools at the start of a conversation. That repeated work the host already knew how to do, consumed model turns, and risked recording the same session start twice. Session-start hooks now load a derived learner summary, active goals, due reviews, and the available capability catalog before the first model turn.
			</p>
			<p className={styles.paragraph}>
				The model can still request deeper history through the optional <Code>learner-details</Code> capability and its single <Code>inspect_learning_context</Code> operation. The difference is intent: detailed inspection is available when the compact context is insufficient, not treated as a mandatory greeting ritual.
			</p>
			<p className={styles.paragraph}>
				That context can now improve during ordinary teaching. When a learner reveals a motivation, preferred communication style, recurring friction, or an approach that clearly helps, the tutor can record a cautious learner-context update instead of waiting for a settings form. The prompt treats those observations as revisable evidence rather than personality labels, so personalization can become more specific without becoming overconfident.
			</p>

			<h3 id="structured-learner-responses" className={styles.heading}>A clean answer for the learner, structured evidence for the tutor</h3>
			<p className={styles.paragraph}>
				Question submission now has two representations with one source of truth. The tutor receives a typed envelope containing the complete answers, document metadata, form state, and any grading instruction. The transcript renders a concise review card with the learner&apos;s answer and relevant result summary. Transport JSON and internal instructions stay out of the visible conversation, so a learner returning later sees what they actually submitted instead of protocol noise.
			</p>
			<div className={styles.note}>
				<div className={styles.noteTitle}>The old ask-user path is now compatibility code</div>
				<p className={styles.noteText}>
					The default web model no longer receives <Code>ask_user_question</Code>. New conversational checks use the streamed OpenUI Question component. Historical sessions and older tool-produced cards still render, which lets the interaction contract migrate without making prior learning records unreadable.
				</p>
			</div>

			<h3 id="tools-hooks-capabilities" className={styles.heading}>Tools now describe effects, not every visible component</h3>
			<p className={styles.paragraph}>
				OpenUI did not remove Keating&apos;s deterministic pedagogy engine. It changed which responsibilities deserve model-visible schemas. The 2.4 boundary looks like this:
			</p>
			<div className={styles.tableWrap}>
				<table className={styles.table}>
					<thead>
						<tr>
							<th className={styles.tableCell}>Concern</th>
							<th className={styles.tableCell}>Owner</th>
							<th className={styles.tableCell}>Examples</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td className={styles.tableCell}>Learner-facing composition</td>
							<td className={styles.tableCell}>Markdown and OpenUI</td>
							<td className={styles.tableCell}>Explanations, checks, plans, maps, shared notes</td>
						</tr>
						<tr>
							<td className={styles.tableCell}>Deterministic host reactions</td>
							<td className={styles.tableCell}>Lifecycle hooks</td>
							<td className={styles.tableCell}>Context hydration, evidence, persistence, idle notices</td>
						</tr>
						<tr>
							<td className={styles.tableCell}>Durable or external effects</td>
							<td className={styles.tableCell}>Model-visible tools</td>
							<td className={styles.tableCell}>Grading, artifact generation, evaluation, workspace execution</td>
						</tr>
						<tr>
							<td className={styles.tableCell}>Optional specialist work</td>
							<td className={styles.tableCell}>Capability bundles</td>
							<td className={styles.tableCell}>Learner details, media, workspace, improvement, voice</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p className={styles.paragraph}>
				The baseline is now ten teaching tools, down from fifteen, and optional schemas are activated only when needed. Workspace work is presented through three consolidated operations, and teaching improvement through two. The older granular implementations remain internal adapters, preserving their tested behavior without making the model choose among a long list of narrowly different calls. The former 2,490-line browser-tools module was also split by responsibility, leaving a small assembly facade over teaching, assessment, media, improvement, and workspace modules.
			</p>

			<h3 id="streaming-artifacts" className={styles.heading}>Lesson plans and concept maps stopped being tools</h3>
			<p className={styles.paragraph}>
				In the first 2.4 cut the baseline still exposed <Code>plan</Code>, <Code>map</Code>, and <Code>verify</Code> as one-shot teaching tools. A model had to call each one with enough authored content to clear a minimum-length gate or the call came back with a refusal and the artifact never appeared. In practice models kept forgetting to author the body, and the rendered lesson plan or concept map arrived empty far too often.
			</p>
			<p className={styles.paragraph}>
				Those three tools are gone from the web agent runtime. The model now streams a <Code>StudyPlan</Code> for a learner-owned plan, a <Code>ConceptMap</Code> for a Mermaid diagram, and an <Code>Explanation</Code> or <Code>SharedNotes</Code> for free-form scratch — all composed inside one <Code>LearningSurface</Code> as the response streams. The browser begins rendering each component as soon as its enclosing fence closes, so the learner sees the plan grow and can correct a step mid-stream instead of waiting for a one-shot tool result that might never come. Default lifecycle is <Code>workspace</Code>, so a plan or map survives across turns and across sessions for the same topic.
			</p>
			<p className={styles.paragraph}>
				The CLI still ships <Code>keating plan &lt;topic&gt;</Code>, <Code>keating map &lt;topic&gt;</Code>, and <Code>keating verify &lt;topic&gt;</Code> as deterministic file artifacts. They use the same underlying planner and Mermaid generator, and they remain the right tool when a learner or a pipeline wants a checked-in <Code>.md</Code> or <Code>.mmd</Code> rather than a live chat surface. The split is intentional: streaming for teaching in the chat, deterministic files for offline use.
			</p>
			<div className={styles.note}>
				<div className={styles.noteTitle}>Concept-map labels now actually render</div>
				<p className={styles.noteText}>
					A separate bug made every Mermaid node look empty even when the source was correct. <Code>htmlLabels: true</Code> tells Mermaid to render node labels through <Code>&lt;foreignObject&gt;</Code> wrappers, but the SVG sanitizer was stripping every <Code>&lt;foreignObject&gt;</Code> it found — which left rectangles with no inner content. <Code>&lt;foreignObject&gt;</Code> is now permitted by the sanitizer (Mermaid is the only SVG source and does not place script-capable content inside it), <Code>htmlLabels</Code> is on, and <Code>&lt;br/&gt;</Code> markers inside label text produce real line breaks. Concept maps with multi-line labels now read the way the model writes them.
				</p>
			</div>

			<h3 id="runtime-boundaries" className={styles.heading}>Choose the runtime boundary instead of inheriting one</h3>
			<p className={styles.paragraph}>
				The browser agent can now run against four explicit runtime families: its built-in browser and NodePod sandbox, Keating Cloud, a generic external HTTP runtime, or the machine hosting Keating itself. Capability activation refreshes the model&apos;s tool schemas after a runtime comes online, so late-bound execution features become reliable without advertising unavailable tools at session start.
			</p>
          <CodeBlock>{`keating web 3000 --host \\
  --allow-local-exec --root=/path/to/project`}</CodeBlock>
			<div className={styles.note}>
				<div className={styles.noteTitle}>Host mode is deliberately not called a sandbox</div>
				<p className={styles.noteText}>
					The host provider executes against the local project with the current user&apos;s authority. It therefore requires the explicit <Code>--allow-local-exec</Code> acknowledgement and should only be enabled for trusted sessions. Browser and NodePod isolation, Keating Cloud, and external endpoints retain their own boundaries; selecting host mode does not make local execution safe by renaming it.
				</p>
			</div>
			<p className={styles.paragraph}>
				<Code>keating web --help</Code> now documents every runtime option with copyable examples, the external <Code>POST /api/agent-runtime/execute</Code> contract, authentication environment variables, resource settings, and the difference between hosted execution and sandboxed execution. The web Help surface presents the same choices interactively, so the security boundary is visible where a learner or operator actually selects it.
			</p>

			<h3 id="navigable-learning-history" className={styles.heading}>A learning history you can actually navigate</h3>
			<p className={styles.paragraph}>
				The Usage page is no longer only a collection of totals. Recent sessions, deepest dives, curriculum bars, and active days now lead back to the exact saved conversation. Session rows expose the model, provider, token usage, and thinking level without putting every field in the default reading path. The result is progressive disclosure: the overview stays calm, but the underlying record remains one click away.
			</p>
			<p className={styles.paragraph}>
				The charts follow the same contract. Topic categories, model share, feedback signals, daily activity, and self-evolution scores can be selected with a pointer or keyboard to reveal their underlying sessions, evidence, or policy run. Evolution details show field-level before and after values, numeric deltas, accepted candidate steps, and decision reasons. If the stored policies cannot establish a trustworthy diff, Keating renders an explicit error page instead of turning missing evidence into an empty success state.
			</p>

			<h3 id="training-evidence-package" className={styles.heading}>Training data is now an evidence package, not a pile of strings</h3>
			<p className={styles.paragraph}>
				Training export now produces one self-describing ZIP. Its canonical JSONL records preserve full conversational context, tutor persona, source provenance, session and model metadata, thinking level, quality state, rewards, and the signals used to derive them. A manifest records counts, warnings, settings, and a deterministic source-group split; a dataset card explains the intended workflow; and a generated JSON Schema lets downstream jobs validate the same contract Keating validates at export time.
			</p>
			<p className={styles.paragraph}>
				Compatibility files remain available for ChatML and Alpaca supervised training, plus reward, KTO, DPO, and GRPO-style post-training pipelines when the required evidence exists. Low-quality responses remain in the canonical and preference records where they are useful negative evidence, but are excluded from supervised fine-tuning files. Deduplication and group-aware train and validation assignment reduce leakage, while Zod schemas replace hand-built JSON fragments at the archive boundary.
			</p>

			<h3 id="recoverable-teaching-turns" className={styles.heading}>A teaching turn should survive interruption</h3>
			<p className={styles.paragraph}>
				Keating now treats an interrupted generation as recoverable session state. Partial output is persisted before the agent lifecycle closes, and the chat can offer a retry or continuation path instead of silently discarding the work. Suggested prompts and focused retry controls make the next action legible on both desktop and narrow screens.
			</p>
			<p className={styles.paragraph}>
				When more than one answer is worth considering, response comparison keeps the alternatives attached to the learner&apos;s actual prompt and records the explicit preference as training evidence. Comparisons now happen for one percent of eligible responses by default, and narrow screens show one response at a time behind an explicit alternative switcher instead of squeezing two essays into columns. That closes a loop across the release: a learner can inspect what happened, choose the response that helped, and later export that choice without pretending the preference was an automatically inferred fact.
			</p>

			<h3 id="mobile-voice" className={styles.heading}>Voice belongs in the composer</h3>
			<p className={styles.paragraph}>
				Voice is no longer a tiny microphone action pretending every speech provider behaves the same way. On mobile, the composer can become a press-and-hold surface for dictation, return the transcript to text for review, and switch back to the keyboard without losing the draft. Providers with duplex support can instead open a full-height realtime conversation with a live transcript, explicit connection state, and an escape route to speech-to-text when a live session cannot start.
			</p>
			<p className={styles.paragraph}>
				The Keating mascot now carries the waiting state in both text and voice. That motion is intentionally small: it makes latency feel inhabited without turning the product into an imitation of Kimi, Claude, or DeepSeek. The surrounding paper-and-ink materials, compact terminal type, and pedagogical status copy remain Keating&apos;s own visual language.
			</p>

			<h3 id="storage-authority" className={styles.heading}>Storage needs one authority at a time</h3>
			<p className={styles.paragraph}>
				Keating&apos;s browser data is now organized by lifetime and authority. Tiny bootstrap preferences that must exist before React or IndexedDB hydration may remain in <Code>localStorage</Code>. Durable app records, including provider definitions and provider-scoped keys, go through the selected storage backend. Learning evidence, goals, reviews, quizzes, and artifacts remain in the versioned learning-record database and portable archive boundary.
			</p>
			<p className={styles.paragraph}>
				The IndexedDB layers now close stale connections on <Code>versionchange</Code>, report blocked upgrades, reconcile required stores and indexes, and keep record-schema normalization separate from database layout versions. A future server backend must implement the same interface and own offline synchronization itself; feature code must not quietly dual-write a server and the browser and hope they converge.
			</p>

			<h3 id="provider-setup" className={styles.heading}>Provider setup should survive an imperfect provider</h3>
			<p className={styles.paragraph}>
				Saving a custom provider no longer depends on its model-list endpoint working. Discovery is advisory: if <Code>/models</Code> returns an error or an empty list, Keating saves the provider, explains what happened, and lets the learner enter the model manually. Custom models can carry an API key, while a provider-scoped key is reused by every model assigned to that provider instead of being copied into several records.
			</p>
			<p className={styles.paragraph}>
				Thinking Machines Inkling now has copyable defaults for its Anthropic Messages-compatible endpoint and model identifier. The Proxy settings surface also explains the real architecture: browser calls use Keating&apos;s same-origin <Code>/api/chat-proxy</Code> bridge automatically when CORS requires it. There is no mystery proxy daemon or separate URL that a learner has to invent.
			</p>

			<h3 id="calmer-learning-surfaces" className={styles.heading}>More information, fewer boxes</h3>
			<p className={styles.paragraph}>
				The ask and quiz flows now use reducer-owned form state, tighter internal spacing, and transitions for non-urgent navigation. Tool results open in their structured visualizer by default, and deeply nested values wrap within the available width instead of forcing a horizontal excavation. The shared blank-template parser also removes a small but risky split between the two assessment renderers.
			</p>
			<p className={styles.paragraph}>
				Usage and Benchmark now share the application navigation, page width, learning-insights header, metric treatment, and responsive filters. Mobile chat text is 11px with an 18px line height and real gutters on both sides. These are modest choices, but together they let a learner read the work rather than the containers around it.
			</p>

			<h3 id="two-terminal-paths" className={styles.heading}>A second terminal host without abandoning Pi</h3>
			<p className={styles.paragraph}>
				The new <Code>keating tui</Code> command runs a separate OpenTUI host over the same Pi RPC runtime. Provider configuration, prompts, skills, extensions, sessions, and the deterministic engine stay on the existing path. <Code>keating shell</Code> remains unchanged, and <Code>/shell</Code> switches from the alternate host into the classic Pi interface.
			</p>
			<p className={styles.paragraph}>
				That portability has an honest boundary. OpenTUI streams the shared transcript, prompts, follow-ups, notifications, status, and editor text, but it does not yet render the web&apos;s semantic OpenUI documents or every Pi modal primitive. When an extension requests a modal surface the host cannot represent, Keating explains the limitation and points the learner to <Code>/shell</Code> instead of approximating the interaction and losing information.
			</p>

			<h3 id="compatibility-not-complete" className={styles.heading}>Compatibility is preserved; the migration is not finished</h3>
			<p className={styles.paragraph}>
				OpenUI is now a real streaming path, but it is not yet the only path. The remaining seams are:
			</p>
			<ul className={styles.list}>
				<li>Legacy quiz, deck, goal, image, and animation tools still produce their established artifacts when durable behavior has not moved to OpenUI actions.</li>
				<li>Resumable and workspace OpenUI component state still needs domain-specific session and artifact adapters on top of the clarified storage authority model.</li>
				<li>OpenUI assessments still need to join the web app&apos;s existing interaction registry so one active check can become the same focused, sticky learning surface used by legacy questions and quizzes.</li>
				<li>Long-running tool results still move from a pending indicator to a completed result. Progress streaming remains to be added for image generation, animation, evaluation, and workspace execution.</li>
				<li>The terminal needs renderers for the same semantic document model before web and OpenTUI can claim component parity.</li>
				<li>Verification is still an upstream prompt instruction. The natural next step is a hook that derives a <Code>StudyPlan</Code>&apos;s verification checklist from its own items — so self-check rides along with the plan rather than depending on the model to remember it.</li>
			</ul>
			<p className={styles.paragraph}>
				Those are migration seams, not reasons to hide the new architecture. Keeping the legacy renderer and adapters in place lets Keating change the live collaboration model while preserving old transcripts, Pi extensions, and the deterministic artifact contracts below the interface.
			</p>

			<h3 id="why-2-4" className={styles.heading}>Why 2.4 instead of 3.0?</h3>
			<p className={styles.paragraph}>
				This is a large release, but release size and semantic-versioning impact are different questions. Keating 2.4 follows the 2.3.1 maintenance release and marks a broader additive transition. The new web protocol and terminal host are additive. The classic Pi shell still works, historical transcripts still render, and existing deterministic implementations remain behind compatibility adapters. That makes 2.4 an appropriate version while the old contracts continue to function.
			</p>
			<p className={styles.paragraph}>
				A future removal of legacy transcript support, a breaking Pi extension contract, or a required switch to the new semantic document model would be a stronger case for 3.0. For now, 2.4 marks the point where Keating starts treating the learner&apos;s understanding, and their ability to participate in the next turn, as an interface responsibility.
			</p>
		</>
	);
}
