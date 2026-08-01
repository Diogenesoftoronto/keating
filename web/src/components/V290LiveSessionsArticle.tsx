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

export function V290LiveSessionsArticle() {
	return (
		<>
			<p className={styles.lead}>
				Keating&apos;s mascot is a CRT monitor with a face. In 2.9 it stops being
				only a metaphor. Open the new <Code>/live</Code> page and the tutor is in
				the room with you: full-duplex voice over OpenAI Realtime or Gemini Live,
				a camera or screen-share feed it can look at, and a live transcript and
				tool feed running alongside the lesson.
			</p>

			<h3 id="live-surface" className={styles.heading}>
				A surface built for one screen
			</h3>
			<p className={styles.paragraph}>
				The live session is its own page, not a modal over the chat. The learner&apos;s
				camera or screen becomes the phosphor behind Keating&apos;s bezel; when he has
				nothing to look at, his face takes the screen back. A boot-style status row
				shows whether the session is listening or speaking, which vision lane is live,
				and how many frames have reached the model, all matching the boot sequence and
				landing hero so a live session never feels like a different product.
			</p>
			<p className={styles.paragraph}>
				The whole surface tears down with navigation. A live session holds the
				microphone, the camera, and a paid socket — leaving it running in a background
				tab was never an option, so leaving the page ends it immediately.
			</p>

			<h3 id="duplex-voice" className={styles.heading}>
				Duplex voice, with the same teacher either way
			</h3>
			<p className={styles.paragraph}>
				Both realtime providers Keating targets are now driven as full sessions
				through one <Code>startLiveSession</Code> contract. OpenAI Realtime and
				Gemini Live each get interruption and barge-in handling: a learner who cuts in
				no longer keeps hearing the sentence they just stopped. Tool calls run during
				the conversation under a shared lifecycle — requested, started, completed, or
				failed — and are emitted on a provider-neutral canonical event stream. The
				<Code>/live</Code> transcript, the persistence layer, and any alternate UI all
				consume that same stream, so what gets recorded does not depend on which
				provider was behind the socket.
			</p>

			<h3 id="vision" className={styles.heading}>
				Eyes on the work
			</h3>
			<p className={styles.paragraph}>
				A live session can capture from the camera or a shared screen. Keating
				doesn&apos;t pretend the two providers see video the same way: Gemini Live has
				a dedicated video lane capped at one frame per second, while GPT Realtime
				accepts still images as conversation items. One capture pipeline feeds both,
				and each provider supplies its own sink.
			</p>
			<p className={styles.paragraph}>
				Every candidate frame is a cost, so static ones are dropped. A normalized
				luma histogram is computed for each frame and compared to the last; only a
				meaningful change is sent. A frozen desk or an idle editor no longer burns
				tokens, but a page scroll or a hand entering frame still gets through. Frames
				are skipped while the tab is hidden, too.
			</p>

			<h3 id="conversation-seed" className={styles.heading}>
				A voice that remembers the lesson
			</h3>
			<p className={styles.paragraph}>
				A voice session opens a separate model connection. Without a seed, the tutor
				would reintroduce itself mid-lesson and forget what was just discussed in text.
				Keating now replays recent plain-text turns into the voice session — tool
				traffic and generative-UI payloads are dropped, since they mean nothing to a
				speech model and only waste the smaller audio context window — and adopts the
				real Keating system prompt as instructions. The voice is the same teacher, not
				a generic assistant that happens to share the microphone.
			</p>
			<div className={styles.note}>
				<div className={styles.noteTitle}>Budget, not a transcript dump</div>
				<p className={styles.noteText}>
					Replay walks the conversation backwards and keeps the newest turns within
					a turn and character budget. When the budget runs out it is the oldest
					turns that are dropped, so a long session does not silently discard what
					the learner just said.
				</p>
			</div>

			<h3 id="audio-thread" className={styles.heading}>
				The microphone moves off the main thread
			</h3>
			<p className={styles.paragraph}>
				The deprecated <Code>ScriptProcessorNode</Code> ran its callback on the main
				thread, so a React render or a tool executing during a live session showed up
				as dropped or glitched microphone audio. Keating now captures microphone audio
				on the audio rendering thread through an <Code>AudioWorklet</Code>, shipped
				as a source string and loaded from a blob URL so it works under any bundler.
				Browsers without AudioWorklet fall back to the old path rather than failing.
			</p>

			<h3 id="streaming-renders" className={styles.heading}>
				Renders that arrive while they are still being made
			</h3>
			<p className={styles.paragraph}>
				Image generation and animation authoring are no longer all-or-nothing. The
				OpenAI images endpoint streams progressive partial renders as SSE events, and
				Keating publishes each one to a window event so the in-flight tool card shows
				the newest frame as it resolves. Animation source arrives the same way: while
				the model writes an <Code>animate</Code> call, the authored HTML is pulled
				alive from the partial JSON argument text — even when it stops mid-escape-sequence —
				so the animation starts rendering before the tool call finishes.
			</p>
			<ul className={styles.list}>
				<li>
					Image progress is keyed by request id, so concurrent generations never
					overwrite each other.
				</li>
				<li>
					Animation updates are gated on a minimum growth step, so an iframe is not
					re-rendered on every token.
				</li>
			</ul>

			<h3 id="release-29-verification" className={styles.heading}>
				Release integrity
			</h3>
			<p className={styles.paragraph}>
				New unit tests pin the frame-capture histogram and dedup policy, the SSE
				image-stream parser, the partial-JSON string extractor, the live-history
				budget, the duplex input-mode resolver, and provider tier parity. The complete
				web suite, TypeScript check, production Vite and Nitro build, version
				synchronization, and regenerated NodePod snapshot form the release gate.
			</p>
		</>
	);
}
