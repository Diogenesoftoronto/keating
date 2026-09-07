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
import {
	QuestionRenderer,
	normalizeQuestionForm,
	type AnsweredQuestion,
} from "../../components/QuestionRenderer";
import { QuizRenderer } from "../../components/QuizRenderer";
import { LanguagePractice as LanguagePracticeRenderer } from "../../components/LanguagePractice";
import { ExamRenderer } from "../../components/ExamRenderer";
import { CodingChallenge as CodingChallengeRenderer } from "../../components/CodingChallenge";
import { MusicLab as MusicLabRenderer } from "../../components/MusicLab";
import { compileOpenUISourceToSharedDocument, MIN_EXAM_QUESTIONS, type UiDocumentNode } from "@keating/learner-contracts";
import { FlashcardRenderer } from "../../components/FlashcardRenderer";
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
	header: z.string().optional().describe("Short label for this question"),
	question: z.string().min(1).describe("Learner-facing prompt"),
	type: z.enum(["choice", "text", "blanks", "classification", "matching"]).optional().describe("Interaction format; defaults to choice"),
	choices: z.array(z.string().min(1)).min(1).optional().describe("Shared answer choices for choice, classification, or matching"),
	items: z.array(z.string().min(1)).min(1).optional().describe("Rows to classify or match"),
	multiSelect: z.boolean().optional().describe("Allow more than one choice answer"),
	allowText: z.boolean().optional().describe("Show an open response field; text questions enable this automatically"),
	blanks: z.array(z.object({ placeholder: z.string().optional(), hint: z.string().optional() })).optional().describe("Input metadata for blanks in prompt order"),
	requireReasons: z.boolean().optional().describe("Require a brief justification for each classification row; defaults to true"),
	itemLabel: z.string().optional().describe("Heading for classification or matching items"),
	choiceLabel: z.string().optional().describe("Heading for the shared choice bank"),
	reasonLabel: z.string().optional().describe("Heading for classification justifications"),
	uniqueMatches: z.boolean().optional().describe("Use each matching choice at most once; defaults to true"),
	correctMatches: z.array(z.string()).optional().describe("Correct matching choice for each item, in item order"),
	hint: z.string().optional().describe("Brief scaffold that does not reveal the answer"),
}).superRefine((field, context) => {
	const type = field.type ?? "choice";
	const promptBlankCount = field.question.match(/_{3,}|\{\{blank\}\}/g)?.length ?? 0;
	if (type === "choice" && !field.choices?.length && field.allowText !== true) {
		context.addIssue({ code: "custom", message: "Choice questions require choices or a text answer control." });
	}
	if (type === "blanks" && promptBlankCount === 0) {
		context.addIssue({ code: "custom", message: "Blank questions require ___ or {{blank}} placeholders in the prompt." });
	}
	if (type === "blanks" && field.blanks && field.blanks.length !== promptBlankCount) {
		context.addIssue({ code: "custom", message: "Blank metadata must match the number of prompt placeholders." });
	}
	if ((type === "classification" || type === "matching") && (!field.items?.length || !field.choices?.length)) {
		context.addIssue({ code: "custom", message: `${type} questions require complete item and choice pairs.` });
	}
	if (type === "matching" && field.correctMatches && field.correctMatches.length !== field.items?.length) {
		context.addIssue({ code: "custom", message: "Matching answer keys must contain one entry per item." });
	}
	if (type === "matching" && field.correctMatches?.some((answer) => !field.choices?.includes(answer))) {
		context.addIssue({ code: "custom", message: "Every matching answer-key entry must come from choices." });
	}
});

const questionPropsSchema = z.object({
	questions: z.array(questionFieldSchema).min(1).max(8),
	lifecycle: lifecycleSchema,
	topic: z.string().optional(),
	intro: z.string().optional(),
});

function OpenUIQuestion({ props }: { props: z.infer<typeof questionPropsSchema> }) {
	const triggerAction = useTriggerAction();
	const data = normalizeQuestionForm({
		intro: props.intro,
		topic: props.topic,
		questions: props.questions,
	});
	if (!data) return null;
	return (
		<QuestionRenderer
			data={data}
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
	description: "A conversational check using choice, open text, blanks, classification, or matching. Use Quiz for scored assessments.",
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
	timeLimit: z.number().optional(),
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

const examPropsSchema = z.object({
	id: z.string(),
	topic: z.string(),
	questions: z.array(quizQuestionSchema).min(MIN_EXAM_QUESTIONS, "Exams require at least 20 questions.").max(32),
	lifecycle: lifecycleSchema.default("resumable"),
	examTimeLimit: z.number().int().positive().max(86_400).default(1800).describe("Whole-exam time in seconds, independent of per-question timeLimit"),
});

function OpenUIExam({ props }: { props: z.infer<typeof examPropsSchema> }) {
	const triggerAction = useTriggerAction();
	const streaming = useIsStreaming();
	const node = useMemo(() => compileOpenUISourceToSharedDocument(
		`root = LearningSurface([exam], "", "", "resumable")\nexam = Exam(${JSON.stringify(props)})`,
		{ documentId: "exam-preview" },
	).nodes[0] as Extract<UiDocumentNode, { type: "quiz" }>, [props]);
	return <ExamRenderer node={node} disabled={streaming} onAction={(event) => {
		void triggerAction(event.humanFriendlyMessage, undefined, { type: "continue_conversation", params: { interaction: "quiz", mode: "exam", ...event.intent } });
		return true;
	}} />;
}

export const ExamDocument = defineComponent({
	name: "Exam",
	description: "An examination with at least 20 questions, one overall deadline, question navigation, flags, final review, and grading after submission. Use Quiz for short retrieval rounds.",
	props: examPropsSchema,
	component: OpenUIExam,
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

// Work the learner does away from the conversation. Key order here IS the
// positional argument order, and must stay in step with POSITIONAL_FIELDS in
// @keating/learner-contracts.
const taskItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	detail: z.string().optional(),
});

function TaskCard({ badge, title, brief, criteria, items, itemsLabel, footer }: { badge: string; title: string; brief: string; criteria?: string[]; items?: z.infer<typeof taskItemSchema>[]; itemsLabel: string; footer?: string }) {
	return (
		<section className={surfaceClass}>
			<header className={css({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.5rem", borderBottom: "1px solid var(--border)", padding: "0.875rem 1rem" })}>
				<span className={css({ borderRadius: "999px", background: "var(--muted)", paddingInline: "0.5rem", paddingBlock: "0.125rem", fontSize: "0.6875rem", fontWeight: 650, color: "var(--muted-foreground)" })}>{badge}</span>
				<h2 className={css({ flex: 1, fontSize: "1rem", fontWeight: 700 })}>{title}</h2>
				{footer ? <span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{footer}</span> : null}
			</header>
			<div className={bodyClass}>
				<p className={css({ maxWidth: "72ch", fontSize: "0.875rem", lineHeight: "1.6" })}>{brief}</p>
				{criteria?.length ? (
					<div className={css({ display: "grid", gap: "0.25rem" })}>
						<span className={css({ fontSize: "0.75rem", fontWeight: 650, color: "var(--muted-foreground)" })}>Judged on</span>
						<ul className={css({ display: "grid", gap: "0.125rem", margin: 0, paddingLeft: "1.125rem", fontSize: "0.8125rem" })}>
							{criteria.map((entry) => <li key={entry}>{entry}</li>)}
						</ul>
					</div>
				) : null}
				{items?.length ? (
					<div className={css({ display: "grid", gap: "0.25rem" })}>
						<span className={css({ fontSize: "0.75rem", fontWeight: 650, color: "var(--muted-foreground)" })}>{itemsLabel}</span>
						<ul className={css({ display: "grid", gap: "0.25rem", margin: 0, paddingLeft: "1.125rem", fontSize: "0.8125rem" })}>
							{items.map((item) => <li key={item.id}><strong>{item.title}</strong>{item.detail ? <span className={css({ display: "block", color: "var(--muted-foreground)" })}>{item.detail}</span> : null}</li>)}
						</ul>
					</div>
				) : null}
			</div>
		</section>
	);
}

const assignmentPropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	brief: z.string(),
	criteria: z.array(z.string()).optional(),
	lifecycle: lifecycleSchema.default("workspace"),
	estimatedMinutes: z.number().optional(),
	steps: z.array(taskItemSchema).optional(),
	dueAt: z.string().optional(),
	availableFrom: z.string().optional(),
});

export const Assignment = defineComponent({
	name: "Assignment",
	description: "One deliverable the learner produces away from the conversation, then submits for judgement. Author a concrete brief and explicit success criteria.",
	props: assignmentPropsSchema,
	component: ({ props }: { props: z.infer<typeof assignmentPropsSchema> }) => (
		<TaskCard badge="Assignment" title={props.title} brief={props.brief} criteria={props.criteria} items={props.steps} itemsLabel="Steps" footer={props.estimatedMinutes ? `~${props.estimatedMinutes} min` : undefined} />
	),
});

const practicePropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	brief: z.string(),
	exercises: z.array(taskItemSchema).min(1),
	lifecycle: lifecycleSchema.default("workspace"),
	estimatedMinutes: z.number().optional(),
	dueAt: z.string().optional(),
	availableFrom: z.string().optional(),
});

export const Practice = defineComponent({
	name: "Practice",
	description: "A set of discrete exercises the learner works through offline, checking each one off. Use for repetition that builds fluency, not for a single deliverable.",
	props: practicePropsSchema,
	component: ({ props }: { props: z.infer<typeof practicePropsSchema> }) => (
		<TaskCard badge="Practice" title={props.title} brief={props.brief} items={props.exercises} itemsLabel="Exercises" footer={props.estimatedMinutes ? `~${props.estimatedMinutes} min` : undefined} />
	),
});

const draftPropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	prompt: z.string(),
	rubric: z.array(z.string()).optional(),
	lifecycle: lifecycleSchema.default("workspace"),
	targetWords: z.number().optional(),
	round: z.number().optional(),
	dueAt: z.string().optional(),
	availableFrom: z.string().optional(),
});

export const Draft = defineComponent({
	name: "Draft",
	description: "Long-form writing against a prompt and rubric, revised over numbered rounds. Increment round when asking for a revision of earlier work.",
	props: draftPropsSchema,
	component: ({ props }: { props: z.infer<typeof draftPropsSchema> }) => (
		<TaskCard badge="Draft" title={props.title} brief={props.prompt} criteria={props.rubric} itemsLabel="Steps" footer={props.round ? `Round ${props.round}` : undefined} />
	),
});

const fieldworkPropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	objective: z.string(),
	protocol: z.array(taskItemSchema).min(1),
	lifecycle: lifecycleSchema.default("workspace"),
	estimatedMinutes: z.number().optional(),
	dueAt: z.string().optional(),
	availableFrom: z.string().optional(),
});

export const Fieldwork = defineComponent({
	name: "Fieldwork",
	description: "Sends the learner to gather evidence from the world against a collection protocol, then record findings. Use when the material is only convincing from real data.",
	props: fieldworkPropsSchema,
	component: ({ props }: { props: z.infer<typeof fieldworkPropsSchema> }) => (
		<TaskCard badge="Fieldwork" title={props.title} brief={props.objective} items={props.protocol} itemsLabel="Collection protocol" footer={props.estimatedMinutes ? `~${props.estimatedMinutes} min` : undefined} />
	),
});

const simulationPropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	parameters: z.array(z.object({
		id: z.string(),
		label: z.string(),
		unit: z.string().optional(),
		min: z.number(),
		max: z.number(),
		step: z.number().optional(),
		value: z.number(),
	})).min(1).max(8),
	readouts: z.array(z.object({
		id: z.string(),
		label: z.string(),
		unit: z.string().optional(),
		expr: z.string(),
		precision: z.number().optional(),
		emphasis: z.boolean().optional(),
	})).min(1).max(8),
	lifecycle: lifecycleSchema.default("workspace"),
	brief: z.string().optional(),
});

export const Simulation = defineComponent({
	name: "Simulation",
	description: "A model the learner manipulates directly, recomputed locally with no turn spent. Declare numeric parameters and readouts whose expr is arithmetic over those parameter ids. Use when a relationship is more convincing moved than described.",
	props: simulationPropsSchema,
	component: ({ props }: { props: z.infer<typeof simulationPropsSchema> }) => (
		<section className={surfaceClass}>
			<header className={css({ borderBottom: "1px solid var(--border)", padding: "0.875rem 1rem" })}>
				<h2 className={css({ fontSize: "1rem", fontWeight: 700 })}>{props.title}</h2>
				{props.brief ? <p className={css({ marginTop: "0.25rem", maxWidth: "72ch", fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>{props.brief}</p> : null}
			</header>
			<div className={bodyClass}>
				{props.parameters.map((parameter) => (
					<div key={parameter.id} className={css({ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem" })}>
						<span>{parameter.label}</span>
						<span className={css({ fontVariantNumeric: "tabular-nums" })}>{parameter.value}{parameter.unit ? ` ${parameter.unit}` : ""}</span>
					</div>
				))}
				{props.readouts.map((readout) => (
					<div key={readout.id} className={css({ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: "0.375rem", fontSize: "0.8125rem", fontWeight: readout.emphasis ? 700 : 400 })}>
						<span>{readout.label}</span>
						<span className={css({ color: "var(--muted-foreground)" })}>computed</span>
					</div>
				))}
			</div>
		</section>
	),
});

const codeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())]);
const codingChallengePropsSchema = z.object({
	id: z.string(), title: z.string(), prompt: z.string(), language: z.enum(["javascript", "typescript"]),
	starterCode: z.string(), entrypoint: z.string().describe("Name of the pure function the learner implements, for example twoSum."),
	tests: z.array(z.object({ id: z.string(), label: z.string(), args: z.array(codeValueSchema), expected: codeValueSchema })).min(1).max(24),
	lifecycle: lifecycleSchema.default("workspace"), hint: z.string().optional(),
});

export const CodingChallenge = defineComponent({
	name: "CodingChallenge",
	description: "A small JavaScript or TypeScript function exercise with an editable starter and executable sample tests. Each test supplies JSON args and expected output. No imports, DOM, network, or external packages. Runs happen only when the learner presses Run tests, with a three-second limit. Sample results are formative feedback, not a formal grade.",
	props: codingChallengePropsSchema,
	component: ({ props }) => {
		const node = compileOpenUISourceToSharedDocument(`root = LearningSurface([lab])\nlab = CodingChallenge(${JSON.stringify(props)})`, { documentId: props.id }).nodes[0] as Extract<UiDocumentNode, { type: "coding-challenge" }>;
		return <CodingChallengeRenderer node={node} />;
	},
});

const musicLabPropsSchema = z.object({
	id: z.string(), title: z.string(), code: z.string(), lifecycle: lifecycleSchema.default("workspace"), brief: z.string().optional(),
	controls: simulationPropsSchema.shape.parameters.element.array().max(8).optional(), visualization: z.enum(["pianoroll", "scope"]).optional(),
});
export const MusicLab = defineComponent({
	name: "MusicLab",
	description: "An interactive Strudel instrument with live numeric sliders, a real pianoroll or audio scope, and optional code editor. Reference controls.<id> in code, e.g. setcpm(controls.tempo / 4) or freq(controls.frequency). Use pianoroll for rhythm/pitch and scope for timbre. Prefer built-in sine, triangle, sawtooth or square synths with modest gain. No external samples or network. Include useful controls and a short listening experiment in brief; playback is explicit.",
	props: musicLabPropsSchema,
	component: ({ props }) => {
		const node = compileOpenUISourceToSharedDocument(`root = LearningSurface([lab])\nlab = MusicLab(${JSON.stringify(props)})`, { documentId: props.id }).nodes[0] as Extract<UiDocumentNode, { type: "music-lab" }>;
		return <MusicLabRenderer node={node} />;
	},
});

const languageRoundBase = { id: z.string(), prompt: z.string(), hint: z.string().optional() };
const languageAudioFields = { text: z.string(), referenceAudioUrl: z.string().optional(), audioCreditUrl: z.string().optional() };
const languagePracticePropsSchema = z.object({
    id: z.string(), title: z.string(), language: z.string(), lifecycle: lifecycleSchema.default("resumable"),
    rounds: z.array(z.discriminatedUnion("kind", [
        z.object({ ...languageRoundBase, kind: z.literal("translation"), text: z.string(), acceptedAnswers: z.array(z.string()).min(1).max(16) }),
        z.object({ ...languageRoundBase, kind: z.literal("word-order"), tokens: z.array(z.object({ id: z.string(), label: z.string() })).min(1).max(24), correctOrder: z.array(z.string()).min(1).max(24) }),
        z.object({ ...languageRoundBase, ...languageAudioFields, kind: z.literal("listening"), acceptedAnswers: z.array(z.string()).min(1).max(16) }),
        z.object({ ...languageRoundBase, ...languageAudioFields, kind: z.literal("pronunciation") }),
    ])).min(1).max(16),
});
function OpenUILanguagePractice({ props }: { props: z.infer<typeof languagePracticePropsSchema> }) {
    const streaming = useIsStreaming();
    const triggerAction = useTriggerAction();
    const node = useMemo(() => compileOpenUISourceToSharedDocument(`root = LearningSurface([practice])\npractice = LanguagePractice(${JSON.stringify(props)})`, { documentId: props.id }).nodes[0] as Extract<UiDocumentNode, { type: "language-practice" }>, [props]);
    return <LanguagePracticeRenderer node={node} disabled={streaming} onAction={(event) => {
        void triggerAction(event.humanFriendlyMessage, undefined, { type: "continue_conversation", params: { interaction: "language-practice", ...event.intent } });
        return true;
    }} />;
}
export const LanguagePracticeDocument = defineComponent({
    name: "LanguagePractice",
    description: "Optional short language rounds: translation, tap-to-order words, listening, and listen-record-compare pronunciation. Use acceptedAnswers for objective text rounds and token IDs with correctOrder for word ordering. Audio rounds use referenceAudioUrl when provided, otherwise the learner's configured voice provider. Use audioCreditUrl for source attribution. Pronunciation records practice only, never a fabricated accuracy score. Microphone recordings remain local.",
    props: languagePracticePropsSchema,
    component: OpenUILanguagePractice,
});

const learningBlock = z.union([
	Explanation.ref,
	Callout.ref,
	Question.ref,
	QuizDocument.ref,
	ExamDocument.ref,
	LanguagePracticeDocument.ref,
	Flashcards.ref,
	StudyPlan.ref,
	ConceptMap.ref,
	LearningImage.ref,
	SharedNotes.ref,
	Assignment.ref,
	Practice.ref,
	Draft.ref,
	Fieldwork.ref,
	Simulation.ref,
	CodingChallenge.ref,
	MusicLab.ref,
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
		ExamDocument,
		LanguagePracticeDocument,
		Flashcards,
		StudyPlan,
		ConceptMap,
		LearningImage,
		SharedNotes,
		Assignment,
		Practice,
		Draft,
		Fieldwork,
		Simulation,
		CodingChallenge,
		MusicLab,
	],
	componentGroups: [
		{ name: "Teaching", components: ["Explanation", "Callout", "Question", "Quiz", "Exam", "Flashcards", "LanguagePractice"] },
		{ name: "Workspace", components: ["StudyPlan", "ConceptMap", "LearningImage", "SharedNotes"] },
		{ name: "Work away from the chat", components: ["Assignment", "Practice", "Draft", "Fieldwork"] },
		{ name: "Manipulable", components: ["Simulation", "CodingChallenge", "MusicLab"] },
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
		"Create quizzes and flashcards only with OpenUI Quiz and Flashcards, using resumable lifecycle for persistence. Use native tools for grading, goals, media, and workspace side effects; never call legacy quiz or deck creation tools.",
		"Questions are ephemeral by default, quizzes and flashcards are resumable, and authored artifacts are workspace documents.",
		"Never repeat the same question, quiz, or flashcard content outside its component.",
	],
});

/** Canonical, parser-valid pattern models can imitate when learner input should guide the next turn. */
export const keatingOpenUIQuestionExampleProgram = [
	'root = LearningSurface([check], "Check your model", "Your answer determines what we unpack next.", "ephemeral")',
	'check = Question([{ question: "Why can a repeated DNS lookup be faster?", type: "choice", choices: ["A cached record can be reused until its TTL expires", "The browser permanently memorizes every address", "The second request skips DNS entirely"], allowText: true, hint: "Choose the mechanism, or write your own explanation." }], "ephemeral", "DNS caching", "Pick the closest explanation.")',
].join("\n");

/** Model-facing selection guide for every conversational and scored question format. */
export const keatingOpenUIQuestionTypeGuide = [
	"## Exams",
	"Use Exam(id, topic, questions, lifecycle, examTimeLimit) for a full timed test with at least 20 distinct, substantive questions (maximum 32). Exams with fewer than 20 questions are invalid. It uses the same question definitions as Quiz, with one overall countdown (1800 seconds by default), free question navigation, flags, and a final review before submission. It does not reveal correctness while the exam is running. Open-ended answers remain pending until the teacher grades them. examTimeLimit is the total exam duration, never the per-question budget.",
	"",
	"## Quiz timing",
	"Quizzes are timed by default: each question allows 120 seconds, because a retrieval check the learner can sit on indefinitely stops being retrieval. Running out of time advances to the next question and keeps whatever they had written — it never ends the quiz.",
	"Override it when the default is wrong for the material: `timeLimit` on the Quiz sets the per-question default, and `timeLimit` on a single question overrides that. Use `0` at either level for an untimed question or quiz — do that whenever the question rewards thinking rather than recall, such as a transfer or short-answer prompt where a clock would just produce a worse answer.",
	"## Question type catalog",
	"`Question` and `Quiz` use different type names. Never put a Quiz type such as `short_answer` into Question, or a Question type such as `text` into Quiz.",
	"Choose the format from the learning operation, not from habit. Do not default to choice when the learner should construct, organize, or connect an answer.",
	"",
	"Conversational `Question` types:",
	'- `choice`: choose one or several supplied alternatives. Set `multiSelect: true` when several choices may be selected. Set `allowText: true` when a learner-authored alternative is genuinely useful.',
	'- `text`: explain reasoning, make a prediction, reflect, state a preference, or produce an answer that should be reviewed by the tutor. An open response field is added automatically.',
	'- `blanks`: retrieve exact terms, values, syntax, or ordered parts inside a meaningful sentence. Put `___` or `{{blank}}` in the prompt and optionally provide one `blanks` entry per input.',
	'- `classification`: assign several `items` to shared `choices`. Use `requireReasons: true` when the classification reasoning matters. Optional `itemLabel`, `choiceLabel`, and `reasonLabel` make the worksheet clearer.',
	'- `matching`: pair several `items` with shared `choices`. `uniqueMatches` defaults to true. Add `correctMatches` in item order only when immediate objective feedback is appropriate.',
	'- `ordering`: arrange `items` into a sequence. The learner drags the rows, or moves them with per-row up and down controls. Use it when the order *is* the understanding — a process, a proof, a causal chain, a sort — and supply `correctAnswers` as the correct sequence when objective feedback is appropriate. An arrangement is scored whole: a near-miss sequence is still wrong, so do not use it where several orders are defensible.',
	"",
	"Scored `Quiz` types:",
	'- `multiple_choice`: one correct option; `multi_select`: several correct options; `true_false`: evaluate one precise claim.',
	'- `fill_in`: retrieve exact missing parts; `short_answer`: explain within the taught context; `transfer`: apply the idea in a new context.',
	'- `slider`: choose a bounded numeric value; `dropdown`: make a compact single selection from options.',
	"Question uses `choices`; Quiz uses `options`. Quiz questions require `correctAnswer` and `explanation`; use `correctAnswers` for multi-select or multi-blank answers. Prefer Question when the tutor should interpret the response conversationally.",
].join("\n");

/** Parser-valid sampler showing every Question renderer type and its type-specific fields. */
export const keatingOpenUIQuestionVarietyExampleProgram = [
	'root = LearningSurface([diagnostic], "DNS diagnostic sampler", "Each prompt uses a format suited to a different kind of thinking.", "ephemeral")',
	'diagnostic = Question([',
	'  { header: "Prediction", question: "Which result most strongly suggests the resolver reused cached data?", type: "choice", choices: ["Lower latency with no upstream referral traffic", "A different browser tab was used", "The query name contains fewer labels"], allowText: true, hint: "Look for evidence about both time and network work." },',
	'  { header: "Reasoning", question: "Explain why a cached answer can be fast and still become stale.", type: "text", hint: "Connect reuse to the remaining TTL." },',
	'  { header: "Recall", question: "A cached record can be reused until its ___ reaches zero.", type: "blanks", blanks: [{ placeholder: "term", hint: "three letters" }] },',
	'  { header: "Sort", question: "Classify each observation by the layer it most directly tests.", type: "classification", items: ["The stub sends no query", "The recursive resolver returns SERVFAIL", "The authoritative server lacks the record"], choices: ["client", "resolver", "authoritative"], requireReasons: true, itemLabel: "Observation", choiceLabel: "Layer", reasonLabel: "Evidence" },',
	'  { header: "Match", question: "Match each response code to its closest meaning.", type: "matching", items: ["NOERROR", "NXDOMAIN", "SERVFAIL"], choices: ["The name does not exist", "The server could not complete resolution", "The response completed without that error"], uniqueMatches: true, correctMatches: ["The response completed without that error", "The name does not exist", "The server could not complete resolution"], itemLabel: "Response code", choiceLabel: "Meaning" }',
	'], "ephemeral", "DNS diagnosis", "Answer each prompt in its intended format.")',
].join("\n");

/** Compact parser-valid plans showing nesting, prerequisites, and reciprocal links. */
export const keatingOpenUIStudyPlanExampleProgram = [
	"root = LearningSurface([corePlan, labPlan], \"DNS: understand, then investigate\", \"A compact path from a model to a practical test.\", \"workspace\")",
	"corePlan = StudyPlan(\"dns-resolution-core\", \"DNS resolution\", [",
	"  { id: \"model\", title: \"Explain a lookup\", detail: \"Trace one request from the client to an authoritative answer.\", estimatedMinutes: 15, outcomes: [\"Distinguish the client, resolver, and authoritative server\"], children: [",
	"    { id: \"trace\", title: \"Draw the path\", detail: \"Label each participant and explain what it contributes.\", estimatedMinutes: 10 },",
	"    { id: \"predict\", title: \"Predict a repeated lookup\", detail: \"Predict which requests disappear while a cached record is valid, and justify why.\", dependsOn: [\"trace\"], estimatedMinutes: 5 }",
	"  ] },",
	"  { id: \"transfer\", title: \"Reason about a changed record\", detail: \"Explain why two clients might temporarily see different addresses after a record changes. State what evidence would distinguish your explanation from an alternative.\", dependsOn: [\"model\"], estimatedMinutes: 10, outcomes: [\"Connect cached state and TTL to a real deployment\"] }",
	"], \"workspace\", \"Expand a step only when the learner needs more support.\", [{ planId: \"dns-observability-lab\", title: \"Observe a real lookup\", relation: \"follow-up\" }])",
	"labPlan = StudyPlan(\"dns-observability-lab\", \"Observe a real lookup\", [",
	"  { id: \"compare\", title: \"Compare two lookups\", detail: \"In a disposable lab, predict and inspect cold and warm DNS traffic. Record what changed and what remained the same.\", estimatedMinutes: 20, outcomes: [\"Support a caching claim with observed traffic rather than latency alone\"] },",
	"  { id: \"explain-evidence\", title: \"Explain the evidence\", detail: \"Compare observations with your prediction. Name an alternative explanation and a check that would distinguish it.\", dependsOn: [\"compare\"], estimatedMinutes: 10 }",
	"], \"workspace\", \"Keep the observations so your claims can be checked.\", [{ planId: \"dns-resolution-core\", title: \"DNS resolution\", relation: \"prerequisite\" }])",
].join("\n");

export const keatingOpenUIPrompt = [
	openUILibraryPrompt,
	keatingOpenUIQuestionTypeGuide,
	"## Canonical Question interaction",
	"Whenever the next useful teaching step depends on the learner's understanding, prediction, preference, or choice, render one focused OpenUI Question instead of asking only in prose.",
	"Use this pattern after a compact explanation, at a genuine decision point, or for a Socratic check. Choose the Question type that matches the cognitive task, then adapt the topic, wording, controls, and hint to the conversation.",
	"After emitting the Question, stop and wait for the learner's submitted answer. Do not answer it yourself, continue the lesson past it, or repeat it outside the component.",
	"```openui lifecycle=ephemeral id=dns-caching-check",
	keatingOpenUIQuestionExampleProgram,
	"```",
	"## Question variety example",
	"This sampler demonstrates the grammar. In a real lesson, use the smallest number of questions needed and include multiple formats only when each one tests a distinct operation.",
	"```openui lifecycle=ephemeral id=dns-question-variety",
	keatingOpenUIQuestionVarietyExampleProgram,
	"```",
	"## Canonical detailed lesson plan",
	"When the learner asks for a lesson plan, match the number of areas and depth to the learner's goal, prior knowledge, and available time. Describe concrete work and outcomes with stable unique ids.",
	"Use nesting only when it makes the work easier to follow. A focused goal may need a few direct activities; a longer curriculum may need areas, lessons, and exercises. No fixed section count or nesting depth is required.",
	"Use dependsOn ids to encode real prerequisite relationships. Keating derives the expandable dependency graph from those links, so do not emit a second ConceptMap containing the same plan dependencies.",
	"When the learning path is clearer as multiple plans, add relatedPlans entries with stable planId targets and prerequisite, follow-up, or related relations. Emit the linked StudyPlan documents with matching ids so the learner can navigate between them.",
	"Include foundations, guided application, misconceptions, transfer, and review where useful. Every item should tell the learner what to do and what it will help them understand; omit sections that do not serve the goal.",
	"```openui lifecycle=workspace id=dns-learning-path",
	keatingOpenUIStudyPlanExampleProgram,
	"```",
	"## Work away from the conversation",
	"When the learning objective benefits from work beyond the chat, offer one of these concrete tasks. All four are `lifecycle=\"workspace\"` so the learner can leave and come back, and all four are authored by you from the actual material — never a generic template.",
	"- `Assignment`: one deliverable, done once. Author a brief concrete enough to start from without asking you a question, and criteria that name what a good answer does rather than restating the task. Use when you want to see them produce something whole.",
	"- `Practice`: several discrete exercises for fluency through repetition. Each exercise is checked off on its own, so make them individually completable and genuinely distinct — five variations that drill the same operation from different angles, not one task split into five steps.",
	"- `Draft`: long-form writing revised across rounds. Set `targetWords` to shape the scope and `round` to 1 for a first pass. When you ask for a revision, emit a new Draft with the round incremented and a rubric that reflects what their last draft actually got wrong.",
	"- `Fieldwork`: sends them to gather evidence from the world. Use it when the material only becomes convincing from real data — real base rates, real measurements, real observations. The protocol items are the collection steps; keep them small enough to actually do.",
	"## Manipulable models",
	"When a relationship is more convincing moved than described, stream a `Simulation` instead of explaining it. The learner drags a parameter and the readouts recompute instantly with no turn spent, so they can try twenty variations while their attention is still on the question.",
	"`expr` is arithmetic only: `+ - * / % ^`, parentheses, numeric literals, and the parameter ids you declared on the same node. There are no function calls, no `Math.`, no conditionals, and no identifiers you did not declare — a readout that reaches for anything else is dropped. Build percentages and ratios from the arithmetic you have.",
	"Set `emphasis: true` on the single number the learner is meant to watch, and write a `brief` that tells them what to predict first and which parameter to move. When a prediction will reveal their current model, ask with a `Question` and wait before presenting the simulation. Then invite them to compare what happens with what they expected; do not assume their prediction was wrong.",
	"Choose parameter ranges so the interesting behaviour is reachable — if the lesson is that a rare condition breaks intuition, the prevalence slider must reach genuinely rare values.",
	"Set `dueAt` (and `availableFrom` when the work should not open yet) as ISO instants to schedule a task. Scheduling is advisory — a late submission is still accepted, because refusing one helps nobody\'s learning — so use a due date to create a rhythm, not a penalty.",
	"Offer one at a time, when the learner has enough background to attempt it or explicitly asks for the task. Do not bundle a task with a plan or a quiz, and do not repeat the brief in your prose — the card carries it. When they submit, respond to the actual work: judge it against the criteria you set, say what is genuinely strong, and name the single most useful thing to change.",
].join("\n\n");
