import { useMemo } from "react";
import {
	createLibrary,
	defineComponent,
	useIsStreaming,
	useStateField,
	useTriggerAction,
} from "@openuidev/react-lang";
import { z } from "zod";
import { CircleAlert, CircleCheck, Info, Lightbulb, NotebookPen } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { MarkdownBlock } from "../../components/MarkdownBlock";
import { MermaidRenderer } from "../../components/MermaidRenderer";
import { QuestionRenderer, type AnsweredQuestion } from "../../components/QuestionRenderer";
import { QuizRenderer } from "../../components/QuizRenderer";
import { FlashcardRenderer } from "../../components/FlashcardRenderer";
import { AnimatedScene } from "../../components/AnimatedScene";
import { initialSrsState, type FlashcardDeck } from "../srs";
import type { Quiz } from "../core";
import { StudyPlan } from "./study-plan";

const lifecycleSchema = z
	.enum(["ephemeral", "resumable", "workspace"])
	.default("ephemeral")
	.describe("How long this interaction should remain available");

const surfaceClass = css({
	marginBlock: "0.75rem",
	maxWidth: "100%",
	overflow: "hidden",
	borderRadius: "0.75rem",
	border: "1px solid var(--border)",
	background: "var(--background)",
});

const bodyClass = css({ padding: "1rem", sm: { padding: "1.25rem" } });

function formatAnswers(answers: AnsweredQuestion[]): string {
	if (answers.length === 1 && !answers[0]?.header) return answers[0]?.answer ?? "";
	return answers
		.map((answer) => `- ${answer.header ? `${answer.header}: ` : ""}${answer.question}: ${answer.answer}`)
		.join("\n");
}

export const Explanation = defineComponent({
	name: "Explanation",
	description: "A concise Markdown explanation. Use normal prose when no interactive structure is needed.",
	props: z.object({
		markdown: z.string().describe("Markdown explanation, capped at a focused section"),
		title: z.string().optional().describe("Optional short heading"),
	}),
	component: ({ props }) => (
		<section className={css({ maxWidth: "72ch" })}>
			{props.title ? (
				<h3 className={css({ marginBottom: "0.5rem", fontSize: "1rem", fontWeight: 650 })}>{props.title}</h3>
			) : null}
			<MarkdownBlock content={props.markdown} />
		</section>
	),
});

const CALLOUT_META = {
	info: { icon: Info, label: "Note", color: "var(--primary)" },
	hint: { icon: Lightbulb, label: "Hint", color: "#d97706" },
	check: { icon: CircleCheck, label: "Check", color: "#059669" },
	warning: { icon: CircleAlert, label: "Watch for", color: "var(--destructive)" },
} as const;

export const Callout = defineComponent({
	name: "Callout",
	description: "A compact note, hint, correctness check, or misconception warning.",
	props: z.object({
		markdown: z.string(),
		tone: z.enum(["info", "hint", "check", "warning"]).default("info"),
		title: z.string().optional(),
	}),
	component: ({ props }) => {
		const meta = CALLOUT_META[props.tone];
		const Icon = meta.icon;
		return (
			<aside
				className={css({
					marginBlock: "0.75rem",
					display: "flex",
					gap: "0.75rem",
					borderRadius: "0.625rem",
					background: "color-mix(in srgb, var(--muted) 45%, transparent)",
					padding: "0.875rem",
				})}
			>
				<Icon aria-hidden="true" size={17} className={css({ marginTop: "0.125rem", flexShrink: 0 })} style={{ color: meta.color }} />
				<div className={css({ minWidth: 0, maxWidth: "72ch" })}>
					<p className={css({ marginBottom: "0.25rem", fontSize: "0.75rem", fontWeight: 650 })}>
						{props.title ?? meta.label}
					</p>
					<MarkdownBlock content={props.markdown} />
				</div>
			</aside>
		);
	},
});

const questionFieldSchema = z.object({
	header: z.string().optional(),
	question: z.string(),
	type: z.enum(["choice", "text", "blanks", "classification", "matching"]).optional(),
	choices: z.array(z.string()).optional(),
	items: z.array(z.string()).optional(),
	multiSelect: z.boolean().optional(),
	allowText: z.boolean().optional(),
	blanks: z.array(z.object({ placeholder: z.string().optional(), hint: z.string().optional() })).optional(),
	requireReasons: z.boolean().optional(),
	correctMatches: z.array(z.string()).optional(),
	hint: z.string().optional(),
});

const questionPropsSchema = z.object({
	questions: z.array(questionFieldSchema).min(1).max(8),
	lifecycle: lifecycleSchema,
	topic: z.string().optional(),
	intro: z.string().optional(),
});

function OpenUIQuestion({ props }: { props: z.infer<typeof questionPropsSchema> }) {
	const triggerAction = useTriggerAction();
	return (
		<QuestionRenderer
			data={{ intro: props.intro, topic: props.topic, questions: props.questions }}
			onSubmit={(answers) => {
				const message = formatAnswers(answers);
				void triggerAction(message, undefined, {
					type: "continue_conversation",
					params: { interaction: "question", topic: props.topic, answers },
				});
			}}
		/>
	);
}

export const Question = defineComponent({
	name: "Question",
	description: "One focused question or a short diagnostic worksheet. Submit answers back to the tutor.",
	props: questionPropsSchema,
	component: OpenUIQuestion,
});

const quizQuestionSchema = z.object({
	id: z.string(),
	type: z.enum(["multiple_choice", "short_answer", "true_false", "fill_in", "transfer", "slider", "dropdown", "multi_select"]),
	level: z.enum(["recall", "comprehension", "application", "analysis", "transfer"]),
	question: z.string(),
	options: z.array(z.string()).optional(),
	blanks: z.array(z.object({ placeholder: z.string().optional(), hint: z.string().optional() })).optional(),
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional(),
	correctAnswer: z.string(),
	correctAnswers: z.array(z.string()).optional(),
	explanation: z.string(),
	rubric: z.string().optional(),
	timeLimit: z.number().int().positive().optional(),
});

const quizPropsSchema = z.object({
	id: z.string(),
	topic: z.string(),
	questions: z.array(quizQuestionSchema).min(1).max(20),
	lifecycle: lifecycleSchema.default("resumable"),
});

function OpenUIQuiz({ props }: { props: z.infer<typeof quizPropsSchema> }) {
	const triggerAction = useTriggerAction();
	const quiz = useMemo<Quiz>(() => ({
		topic: props.topic,
		slug: props.id,
		generatedAt: new Date().toISOString(),
		questions: props.questions,
		totalPoints: props.questions.length,
		review: {
			status: "passed",
			issues: [],
			duplicatesRemoved: 0,
			maxQuestionChars: Math.max(0, ...props.questions.map((question) => question.question.length)),
			maxAnswerChars: Math.max(0, ...props.questions.map((question) => question.correctAnswer.length)),
			maxExplanationChars: Math.max(0, ...props.questions.map((question) => question.explanation.length)),
			maxRubricChars: Math.max(0, ...props.questions.map((question) => question.rubric?.length ?? 0)),
			maxOptionChars: Math.max(0, ...props.questions.flatMap((question) => question.options ?? []).map((option) => option.length)),
			limits: { questionChars: 320, answerChars: 500, explanationChars: 500, rubricChars: 220, optionChars: 220 },
		},
	}), [props]);

	return (
		<QuizRenderer
			quiz={quiz}
			onSubmit={(result) => {
				const detail = { quizId: quiz.slug, topic: quiz.topic, total: quiz.questions.length, ...result };
				void triggerAction(
					`I finished the quiz on ${quiz.topic}. Score: ${result.score}/${quiz.questions.length}. Please review my answers and guide what to study next.`,
					undefined,
					{ type: "continue_conversation", params: { interaction: "quiz", ...detail } },
				);
			}}
		/>
	);
}

export const QuizDocument = defineComponent({
	name: "Quiz",
	description: "A resumable assessment with objective and open-ended questions.",
	props: quizPropsSchema,
	component: OpenUIQuiz,
});

const flashcardSchema = z.object({
	id: z.string(),
	front: z.string(),
	back: z.string(),
	tags: z.array(z.string()).optional(),
});

const flashcardsPropsSchema = z.object({
	id: z.string(),
	topic: z.string(),
	title: z.string(),
	cards: z.array(flashcardSchema).min(1).max(40),
	lifecycle: lifecycleSchema.default("resumable"),
	description: z.string().optional(),
});

function OpenUIFlashcards({ props }: { props: z.infer<typeof flashcardsPropsSchema> }) {
	const triggerAction = useTriggerAction();
	const deck = useMemo<FlashcardDeck>(() => {
		const now = Date.now();
		return {
			id: props.id,
			topic: props.topic,
			slug: props.id,
			title: props.title,
			description: props.description,
			createdAt: now,
			updatedAt: now,
			cards: props.cards.map((card) => ({ ...card, createdAt: now, updatedAt: now, srs: initialSrsState(now) })),
		};
	}, [props]);
	return (
		<FlashcardRenderer
			deck={deck}
			showMeta
			onComplete={(summary) => {
				void triggerAction(
					`I reviewed ${summary.reviewed} flashcards on ${deck.topic}${summary.lapses ? ` with ${summary.lapses} difficult recall${summary.lapses === 1 ? "" : "s"}` : ""}.`,
					undefined,
					{ type: "continue_conversation", params: { interaction: "flashcards", deckId: deck.id, ...summary } },
				);
			}}
		/>
	);
}

export const Flashcards = defineComponent({
	name: "Flashcards",
	description: "A resumable spaced-repetition deck. Use for retrieval practice, not initial explanation.",
	props: flashcardsPropsSchema,
	component: OpenUIFlashcards,
});

export const ConceptMap = defineComponent({
	name: "ConceptMap",
	description: "A Mermaid concept map. Keep labels concise and relationships explicit.",
	props: z.object({
		code: z.string().describe("Mermaid source without a Markdown fence"),
		lifecycle: lifecycleSchema.default("workspace"),
		title: z.string().optional(),
	}),
	component: ({ props }) => (
		<figure className={surfaceClass}>
			{props.title ? <figcaption className={css({ borderBottom: "1px solid var(--border)", padding: "0.75rem 1rem", fontSize: "0.875rem", fontWeight: 650 })}>{props.title}</figcaption> : null}
			<div className={bodyClass}><MermaidRenderer content={props.code} /></div>
		</figure>
	),
});

export const LearningImage = defineComponent({
	name: "LearningImage",
	description: "A generated or sourced learning image with meaningful alternative text.",
	props: z.object({
		src: z.string(),
		alt: z.string().min(1),
		lifecycle: lifecycleSchema.default("workspace"),
		title: z.string().optional(),
		caption: z.string().optional(),
	}),
	component: ({ props }) => (
		<figure className={surfaceClass}>
			<img src={props.src} alt={props.alt} loading="lazy" className={css({ display: "block", width: "100%", background: "var(--muted)", objectFit: "contain" })} />
			{props.title || props.caption ? (
				<figcaption className={css({ display: "grid", gap: "0.125rem", borderTop: "1px solid var(--border)", padding: "0.625rem 0.75rem" })}>
					{props.title ? <span className={css({ fontSize: "0.8125rem", fontWeight: 600 })}>{props.title}</span> : null}
					{props.caption ? <span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{props.caption}</span> : null}
				</figcaption>
			) : null}
		</figure>
	),
});

export const LearningAnimation = defineComponent({
	name: "LearningAnimation",
	description: "A sandboxed Hyperframes animation authored as a complete HTML document.",
	props: z.object({
		topic: z.string(),
		html: z.string(),
		lifecycle: lifecycleSchema.default("workspace"),
		summary: z.string().optional(),
	}),
	component: ({ props }) => <AnimatedScene payload={{ kind: "hyperframes", topic: props.topic, summary: props.summary, body: props.html }} />,
});

const sharedNotesPropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	lifecycle: lifecycleSchema.default("workspace"),
	initialValue: z.string().optional(),
	placeholder: z.string().optional(),
});

function OpenUISharedNotes({ props }: { props: z.infer<typeof sharedNotesPropsSchema> }) {
	const notes = useStateField<string>(props.id, props.initialValue ?? "");
	const isStreaming = useIsStreaming();
	return (
		<section className={surfaceClass}>
			<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderBottom: "1px solid var(--border)", padding: "0.75rem 1rem", fontSize: "0.875rem", fontWeight: 650 })} htmlFor={`openui-notes-${props.id}`}>
				<NotebookPen aria-hidden="true" size={16} className={css({ color: "var(--primary)" })} />
				{props.title}
			</label>
			<textarea
				id={`openui-notes-${props.id}`}
				value={notes.value}
				disabled={isStreaming}
				onChange={(event) => notes.setValue(event.currentTarget.value)}
				placeholder={props.placeholder ?? "Capture what you understand, what remains unclear, or what you want to test."}
				className={css({ minHeight: "8rem", width: "100%", resize: "vertical", background: "transparent", padding: "0.875rem 1rem", fontSize: "0.875rem", lineHeight: "1.5", outline: "none", _focus: { boxShadow: "inset 0 0 0 2px var(--primary)" }, _disabled: { cursor: "not-allowed", opacity: 0.6 }, "&::placeholder": { color: "var(--muted-foreground)" } })}
			/>
		</section>
	);
}

export const SharedNotes = defineComponent({
	name: "SharedNotes",
	description: "A persistent learner-owned notes area for a shared workspace.",
	props: sharedNotesPropsSchema,
	component: OpenUISharedNotes,
});

const learningBlock = z.union([
	Explanation.ref,
	Callout.ref,
	Question.ref,
	QuizDocument.ref,
	Flashcards.ref,
	StudyPlan.ref,
	ConceptMap.ref,
	LearningImage.ref,
	LearningAnimation.ref,
	SharedNotes.ref,
]);

export const LearningSurface = defineComponent({
	name: "LearningSurface",
	description: "Root container for one coherent learning interaction. Avoid wrapping unrelated content together.",
	props: z.object({
		content: z.array(learningBlock).min(1).max(20),
		title: z.string().optional(),
		description: z.string().optional(),
		lifecycle: lifecycleSchema,
	}),
	component: ({ props, renderNode }) => (
		<section className={surfaceClass} data-openui-lifecycle={props.lifecycle}>
			{props.title || props.description ? (
				<header className={css({ borderBottom: "1px solid var(--border)", padding: "0.875rem 1rem" })}>
					{props.title ? <h2 className={css({ fontSize: "1rem", fontWeight: 700 })}>{props.title}</h2> : null}
					{props.description ? <p className={css({ marginTop: "0.25rem", maxWidth: "72ch", fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>{props.description}</p> : null}
				</header>
			) : null}
			<div className={bodyClass}>{renderNode(props.content)}</div>
		</section>
	),
});

export const keatingOpenUILibrary = createLibrary({
	id: "keating-learning-v1",
	root: "LearningSurface",
	components: [
		LearningSurface,
		Explanation,
		Callout,
		Question,
		QuizDocument,
		Flashcards,
		StudyPlan,
		ConceptMap,
		LearningImage,
		LearningAnimation,
		SharedNotes,
	],
	componentGroups: [
		{ name: "Teaching", components: ["Explanation", "Callout", "Question", "Quiz", "Flashcards"] },
		{ name: "Workspace", components: ["StudyPlan", "ConceptMap", "LearningImage", "LearningAnimation", "SharedNotes"] },
	],
});

const openUILibraryPrompt = keatingOpenUILibrary.prompt({
	inlineMode: true,
	toolCalls: false,
	bindings: true,
	preamble: "Use OpenUI only when manipulating or responding to the component materially helps the learner understand and participate.",
	additionalRules: [
		"Wrap every OpenUI program in an openui Markdown fence.",
		"Add lifecycle=ephemeral|resumable|workspace and a stable id=<document-id> to the opening fence.",
		"Use ordinary Markdown for prose that does not need interaction.",
		"Prefer OpenUI components over tool calls when the only purpose is to render learner-facing interaction.",
		"Use Question for conversational checks and forms; submitted answers return as structured interaction data with a reviewable learner summary.",
		"Use durable quiz, deck, goal, media, or workspace tools only when their persistence or external side effect is required, and never duplicate their content in OpenUI.",
		"Questions are ephemeral by default, quizzes and flashcards are resumable, and authored artifacts are workspace documents.",
		"Never repeat the same question, quiz, or flashcard content outside its component.",
	],
});

/** Canonical, parser-valid pattern models can imitate when learner input should guide the next turn. */
export const keatingOpenUIQuestionExampleProgram = [
	'root = LearningSurface([check], "Check your model", "Your answer determines what we unpack next.", "ephemeral")',
	'check = Question([{ question: "Why can a repeated DNS lookup be faster?", type: "choice", choices: ["A cached record can be reused until its TTL expires", "The browser permanently memorizes every address", "The second request skips DNS entirely"], allowText: true, hint: "Choose the mechanism, or write your own explanation." }], "ephemeral", "DNS caching", "Pick the closest explanation.")',
].join("\n");

/** Canonical detailed plan with nested coverage areas and explicit prerequisite links. */
export const keatingOpenUIStudyPlanExampleProgram = [
	'root = LearningSurface([plan], "DNS learning path", "A structured route from names to resilient resolution.", "workspace")',
	'plan = StudyPlan("dns-learning-path", "DNS resolution", [{ id: "foundations", title: "1. Foundations", detail: "Establish the vocabulary used throughout the resolution path.", estimatedMinutes: 20, outcomes: ["Distinguish names, addresses, zones, and records"], children: [{ id: "names-addresses", title: "Names and addresses", detail: "Explain why stable names are mapped to changing network locations." }, { id: "record-types", title: "Core record types", detail: "Compare A, AAAA, CNAME, and NS records.", dependsOn: ["names-addresses"] }] }, { id: "resolution", title: "2. Resolution path", detail: "Trace one lookup through every responsible system.", dependsOn: ["foundations"], estimatedMinutes: 35, children: [{ id: "recursive-resolver", title: "Recursive resolver", detail: "Follow the client request and resolver cache check." }, { id: "authoritative-chain", title: "Root to authoritative", detail: "Trace referrals from root through TLD to the authoritative server.", dependsOn: ["recursive-resolver"] }] }, { id: "caching", title: "3. Caching and TTL", detail: "Connect performance gains to freshness tradeoffs.", dependsOn: ["resolution"], estimatedMinutes: 25, children: [{ id: "cache-lifecycle", title: "Cache lifecycle", detail: "Predict when a cached answer is reused or refreshed." }] }, { id: "failure-modes", title: "4. Failure modes", detail: "Diagnose stale records, propagation delays, and resolver failures.", dependsOn: ["caching"], estimatedMinutes: 30, outcomes: ["Use dig output to locate the failing layer"], children: [{ id: "diagnostic-trace", title: "Diagnostic trace", detail: "Interpret a failed lookup one delegation at a time." }] }], "workspace", "Cover the mechanism, performance tradeoffs, and practical diagnosis. Each area builds on the one before it.")',
].join("\n");

/** Prompt fragment appended to every web-agent system prompt when OpenUI output is enabled. */
export const keatingOpenUIPrompt = [
	openUILibraryPrompt,
	"## Canonical Question interaction",
	"Whenever the next useful teaching step depends on the learner's understanding, prediction, preference, or choice, render one focused OpenUI Question instead of asking only in prose.",
	"Use this pattern after a compact explanation, at a genuine decision point, or for a Socratic check. Adapt the topic, wording, choices, and hint to the conversation; do not copy the subject matter mechanically.",
	"After emitting the Question, stop and wait for the learner's submitted answer. Do not answer it yourself, continue the lesson past it, or repeat it outside the component.",
	"```openui lifecycle=ephemeral id=dns-caching-check",
	keatingOpenUIQuestionExampleProgram,
	"```",
	"## Canonical detailed lesson plan",
	"When the learner asks for a lesson plan, create a StudyPlan with at least four meaningful top-level coverage areas. Nest concrete subtopics or activities under each area, describe the intended work and outcomes, and use stable unique ids.",
	"Use dependsOn ids to encode real prerequisite relationships. Keating derives the expandable dependency graph from those links, so do not emit a second ConceptMap containing the same plan dependencies.",
	"Make the plan specific enough to teach from: include foundations, core mechanism or theory, guided application, misconceptions or failure modes, transfer, and review where they fit the subject. Do not generate a shallow checklist.",
	"```openui lifecycle=workspace id=dns-learning-path",
	keatingOpenUIStudyPlanExampleProgram,
	"```",
].join("\n\n");
