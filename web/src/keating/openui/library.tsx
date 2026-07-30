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

/** Model-facing selection guide for every conversational and scored question format. */
export const keatingOpenUIQuestionTypeGuide = [
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

/** Canonical detailed plans with two nested levels, internal dependencies, and reciprocal plan links. */
export const keatingOpenUIStudyPlanExampleProgram = [
	'root = LearningSurface([corePlan, labPlan], "Linked DNS study plans", "Build the resolution model, then use it in an observability lab.", "workspace")',
	'corePlan = StudyPlan("dns-resolution-core", "DNS resolution: mechanism and reasoning", [',
	'  { id: "foundations", title: "1. Names, records, and authority", detail: "Build the vocabulary and ownership model needed to reason about every later lookup.", estimatedMinutes: 55, outcomes: ["Distinguish a domain name, host name, zone, and resource record", "Explain which server is authoritative for a name"], children: [',
	'    { id: "names-and-records", title: "Names and resource records", detail: "Connect human-readable names to typed DNS data.", estimatedMinutes: 30, children: [',
	'      { id: "map-name-to-address", title: "Explain name-to-address mapping", detail: "Write a three-sentence model of why names remain stable while service addresses can change.", estimatedMinutes: 10, outcomes: ["Use name, label, FQDN, and address precisely"] },',
	'      { id: "compare-record-types", title: "Compare A, AAAA, CNAME, and NS", detail: "Build a comparison table covering payload, owner, and common misuse for each record.", dependsOn: ["map-name-to-address"], estimatedMinutes: 20, outcomes: ["Choose the correct record type for four deployment scenarios"] }',
	'    ] },',
	'    { id: "zones-and-delegation", title: "Zones and delegated authority", detail: "Separate the DNS namespace from the administrative zones that serve it.", dependsOn: ["names-and-records"], estimatedMinutes: 25, children: [',
	'      { id: "locate-zone-cut", title: "Locate a zone cut", detail: "Mark the delegation boundary in an example hierarchy and identify the parent and child zones.", estimatedMinutes: 10 },',
	'      { id: "explain-glue-records", title: "Explain glue records", detail: "Use an in-bailiwick nameserver example to show why the parent sometimes supplies address data.", dependsOn: ["locate-zone-cut"], estimatedMinutes: 15, outcomes: ["Recognize when glue prevents a circular lookup"] }',
	'    ] }',
	'  ] },',
	'  { id: "resolution-path", title: "2. The recursive resolution path", detail: "Trace a cold and warm lookup through the client, recursive resolver, and authoritative hierarchy.", dependsOn: ["foundations"], estimatedMinutes: 65, outcomes: ["Narrate every query and referral in order", "Separate recursion from iteration"], children: [',
	'    { id: "client-to-resolver", title: "Client and recursive resolver", detail: "Follow the request from an application through the stub resolver to a recursive resolver.", estimatedMinutes: 30, children: [',
	'      { id: "trace-stub-query", title: "Trace the stub query", detail: "Annotate the question section, recursion-desired flag, and transport used by a sample request.", estimatedMinutes: 15 },',
	'      { id: "evaluate-cache-decision", title: "Evaluate the first cache decision", detail: "Given cache entries and remaining TTLs, decide whether the resolver can answer or must iterate.", dependsOn: ["trace-stub-query"], estimatedMinutes: 15 }',
	'    ] },',
	'    { id: "authoritative-iteration", title: "Root-to-authoritative iteration", detail: "Follow referrals until the resolver reaches the server that owns the requested data.", dependsOn: ["client-to-resolver"], estimatedMinutes: 35, children: [',
	'      { id: "trace-root-tld-referrals", title: "Trace root and TLD referrals", detail: "Draw the query sequence and label the authority and additional sections in each response.", estimatedMinutes: 20 },',
	'      { id: "assemble-final-answer", title: "Assemble the final answer", detail: "Show how a CNAME chain and terminal address record become one client response.", dependsOn: ["trace-root-tld-referrals"], estimatedMinutes: 15, outcomes: ["Predict the extra lookups introduced by a CNAME"] }',
	'    ] }',
	'  ] },',
	'  { id: "caching-correctness", title: "3. Caching, TTL, and correctness", detail: "Connect response caching to latency, load, negative answers, and bounded staleness.", dependsOn: ["resolution-path"], estimatedMinutes: 55, outcomes: ["Predict cache behavior at a specific time", "Explain the operational cost of very short and very long TTLs"], children: [',
	'    { id: "positive-cache-lifecycle", title: "Positive cache lifecycle", detail: "Model insertion, reuse, TTL countdown, expiry, and refresh.", estimatedMinutes: 30, children: [',
	'      { id: "calculate-remaining-ttl", title: "Calculate remaining TTL", detail: "Solve a timeline exercise with two clients querying the same resolver cache.", estimatedMinutes: 15 },',
	'      { id: "choose-ttl-for-change", title: "Choose a TTL for a planned change", detail: "Balance query volume against the maximum acceptable stale window for a migration.", dependsOn: ["calculate-remaining-ttl"], estimatedMinutes: 15 }',
	'    ] },',
	'    { id: "negative-caching", title: "Negative answers and stale state", detail: "Reason about cached NXDOMAIN responses and records changed before their prior TTL expires.", dependsOn: ["positive-cache-lifecycle"], estimatedMinutes: 25, children: [',
	'      { id: "interpret-negative-cache", title: "Interpret a cached NXDOMAIN", detail: "Use the zone SOA fields to estimate how long a negative result can persist.", estimatedMinutes: 10 },',
	'      { id: "plan-cache-safe-rollout", title: "Plan a cache-safe rollout", detail: "Sequence TTL reduction, record change, observation, and TTL restoration.", dependsOn: ["interpret-negative-cache"], estimatedMinutes: 15, outcomes: ["Produce a rollout timeline with explicit waiting periods"] }',
	'    ] }',
	'  ] },',
	'  { id: "diagnosis-transfer", title: "4. Diagnosis and transfer", detail: "Apply the model to failed lookups, then explain the reasoning in a reusable incident workflow.", dependsOn: ["caching-correctness"], estimatedMinutes: 65, outcomes: ["Locate a failure by layer rather than by guesswork", "Defend a diagnosis using command output"], children: [',
	'    { id: "failure-isolation", title: "Failure isolation", detail: "Distinguish client configuration, recursive resolver, delegation, authoritative data, and DNSSEC failures.", estimatedMinutes: 35, children: [',
	'      { id: "classify-response-codes", title: "Classify NOERROR, NXDOMAIN, and SERVFAIL", detail: "Map each response to the next evidence-gathering step without treating the codes as interchangeable.", estimatedMinutes: 15 },',
	'      { id: "read-dig-trace", title: "Read a dig +trace transcript", detail: "Identify the last healthy delegation and the first response that violates the expected path.", dependsOn: ["classify-response-codes"], estimatedMinutes: 20 }',
	'    ] },',
	'    { id: "transfer-checkpoint", title: "Transfer checkpoint", detail: "Turn the reasoning model into an operational explanation and a repeatable diagnostic sequence.", dependsOn: ["failure-isolation"], estimatedMinutes: 30, children: [',
	'      { id: "write-diagnostic-runbook", title: "Write a six-step diagnostic runbook", detail: "For each step, name the command, expected evidence, and branch taken when the evidence differs.", estimatedMinutes: 20 },',
	'      { id: "teach-resolution-back", title: "Teach the resolution path back", detail: "Explain a cold lookup and one failure mode without notes, then record the point that remained uncertain.", dependsOn: ["write-diagnostic-runbook"], estimatedMinutes: 10, outcomes: ["Give a complete two-minute explanation using correct system boundaries"] }',
	'    ] }',
	'  ] }',
	'], "workspace", "Move from vocabulary to mechanism, caching tradeoffs, and evidence-based diagnosis. Complete each activity, not just the section heading.", [{ planId: "dns-observability-lab", title: "DNS observability lab", relation: "follow-up", detail: "Apply the resolution model with packet captures, cache observations, controlled faults, and a recovery report." }])',
	'labPlan = StudyPlan("dns-observability-lab", "DNS observability lab", [',
	'  { id: "lab-baseline", title: "1. Capture a healthy baseline", detail: "Record the expected behavior before introducing a fault.", estimatedMinutes: 40, children: [{ id: "lab-capture-setup", title: "Prepare the capture", detail: "Choose the interface, filters, and test name.", children: [{ id: "lab-record-cold-query", title: "Record a cold query", detail: "Capture the complete request and response sequence after clearing only the lab cache.", estimatedMinutes: 20 }, { id: "lab-label-actors", title: "Label every DNS actor", detail: "Annotate the stub, recursive resolver, and authoritative endpoints in the capture.", dependsOn: ["lab-record-cold-query"], estimatedMinutes: 20 }] }] },',
	'  { id: "lab-cache-observation", title: "2. Observe cache behavior", detail: "Compare traffic and latency before and after the resolver has reusable data.", dependsOn: ["lab-baseline"], estimatedMinutes: 35, children: [{ id: "lab-cache-comparison", title: "Compare cold and warm queries", detail: "Use identical questions so cache state is the only intended variable.", children: [{ id: "lab-measure-latency", title: "Measure query latency", detail: "Record five cold and five warm timings and explain the distribution.", estimatedMinutes: 20 }, { id: "lab-confirm-missing-referrals", title: "Confirm referral traffic disappears", detail: "Show which upstream packets are absent during a valid cache hit.", dependsOn: ["lab-measure-latency"], estimatedMinutes: 15 }] }] },',
	'  { id: "lab-fault-injection", title: "3. Isolate a controlled failure", detail: "Introduce one reversible fault and predict its visible evidence before testing.", dependsOn: ["lab-cache-observation"], estimatedMinutes: 45, children: [{ id: "lab-fault-cycle", title: "Predict, inject, and diagnose", detail: "Keep all unrelated configuration fixed while testing one failure.", children: [{ id: "lab-write-prediction", title: "Write the failure prediction", detail: "Name the expected response code, last healthy layer, and confirming command output.", estimatedMinutes: 15 }, { id: "lab-diagnose-fault", title: "Diagnose without reading the answer key", detail: "Use the core plan runbook to locate the injected fault from observed evidence.", dependsOn: ["lab-write-prediction"], estimatedMinutes: 30 }] }] },',
	'  { id: "lab-recovery-report", title: "4. Verify recovery and report", detail: "Prove that the repair restored resolution without hiding stale cache state.", dependsOn: ["lab-fault-injection"], estimatedMinutes: 40, outcomes: ["Produce a compact before-and-after evidence table"], children: [{ id: "lab-recovery-proof", title: "Build the recovery proof", detail: "Repeat the same probes used for the baseline and fault.", children: [{ id: "lab-repeat-trace", title: "Repeat the trace after repair", detail: "Capture the restored delegation and final answer, preserving timestamps.", estimatedMinutes: 20 }, { id: "lab-write-incident-note", title: "Write the incident note", detail: "Summarize cause, evidence, repair, cache caveat, and one prevention step.", dependsOn: ["lab-repeat-trace"], estimatedMinutes: 20 }] }] }',
	'], "workspace", "Use a disposable DNS environment. Preserve each capture and command transcript so claims in the report remain inspectable.", [{ planId: "dns-resolution-core", title: "DNS resolution: mechanism and reasoning", relation: "prerequisite", detail: "Return to the mechanism plan when a packet or response code does not match your prediction." }])',
].join("\n");

/** Prompt fragment appended to every web-agent system prompt when OpenUI output is enabled. */
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
	"When the learner asks for a lesson plan, create a StudyPlan with at least four meaningful top-level coverage areas. Nest concrete subtopics or activities under each area, describe the intended work and outcomes, and use stable unique ids.",
	"Use at least two nested levels beneath every top-level area: area -> lesson or subtopic -> concrete activity, exercise, artifact, or checkpoint. A top-level item with only direct leaf children is too shallow.",
	"Use dependsOn ids to encode real prerequisite relationships. Keating derives the expandable dependency graph from those links, so do not emit a second ConceptMap containing the same plan dependencies.",
	"When the learning path is clearer as multiple plans, add relatedPlans entries with stable planId targets and prerequisite, follow-up, or related relations. Emit the linked StudyPlan documents with matching ids so the learner can navigate between them.",
	"Make the plan specific enough to teach from: include foundations, core mechanism or theory, guided application, misconceptions or failure modes, transfer, and review where they fit the subject. Do not generate a shallow checklist.",
	"```openui lifecycle=workspace id=dns-learning-path",
	keatingOpenUIStudyPlanExampleProgram,
	"```",
].join("\n\n");
