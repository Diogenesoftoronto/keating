import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingStorage } from "../storage";
import {
	extractBrowserOutcomes,
	extractSessionTurnOutcomes,
	quizRecordsToOutcomes,
	benchmarkPerModel,
	perModelBreakdownToMarkdown,
	benchModelLabel,
	runBenchmarkSuite,
	benchmarkToMarkdown,
	DEFAULT_WEIGHTS,
	resolveTopic,
	generateQuiz,
	buildAuthoredQuestions,
	quizToMarkdown,
	quizAnswerKeyToMarkdown,
	type AuthoredQuestion,
	type QuizGradeVerdict,
	type QuizQuestionGrade,
	type BenchSessionSample,
	type BrowserLearnerOutcome,
} from "../core";
import { createTool, type KeatingToolsOptions, type OutcomeCollector } from "./shared";
import { parsePolicyFromStorage } from "./improvement";

export function createOutcomeCollector(
	storage: KeatingStorage,
	getSessionSamples?: KeatingToolsOptions["getSessionSamples"],
): OutcomeCollector {
	return async (): Promise<BrowserLearnerOutcome[]> => {
		const learnerState = await storage.getLearnerState();
		const samples = getSessionSamples
			? await getSessionSamples().catch(() => [] as BenchSessionSample[])
			: [];
		const modelBySessionId = new Map(
			samples.filter((sample) => sample.id).map((sample) => [sample.id, benchModelLabel(sample.model)]),
		);
		const quizRecords = await storage.getQuizResults().catch(() => []);
		return [
			...extractBrowserOutcomes(learnerState.feedbackHistory, learnerState.topicsExplored),
			...extractSessionTurnOutcomes(samples),
			...quizRecordsToOutcomes(quizRecords, modelBySessionId),
		];
	};
}

export function createAssessmentTools(storage: KeatingStorage, collectRealOutcomes: OutcomeCollector): AgentTool[] {
	return [
		createTool(
			"bench",
			"Run a learner-feedback benchmark against the current teaching policy. Uses explicit feedback and inferred learner-turn signals.",
			{
				topic: { type: "string", description: "Optional topic to focus the benchmark on" }
			},
			async (params) => {
				const topic = params.topic as string | undefined;
				const teacherPolicy = parsePolicyFromStorage(await storage.getActivePolicy());
				const realOutcomes = await collectRealOutcomes();

				const result = runBenchmarkSuite(teacherPolicy, topic, 20260401, 3, DEFAULT_WEIGHTS, realOutcomes);
				const perModel = benchmarkPerModel(teacherPolicy, realOutcomes, topic);
				const perModelReport = perModelBreakdownToMarkdown(perModel);
				const report = perModelReport
					? `${benchmarkToMarkdown(result).trimEnd()}\n\n${perModelReport}\n`
					: benchmarkToMarkdown(result);

				const saved = await storage.saveBenchmark(
					result.overallScore,
					report,
					topic,
					JSON.stringify({ ...result.trace, perModel }, null, 2)
				);

				return `[artifact://benchmark/${saved.id}]\n\n**Overall Score:** ${result.overallScore.toFixed(2)}/100\n\n${report}`;
			}
		),

		// evolve - Evolve teaching policy via MAP-Elites
			createTool(
				"quiz",
				"Build a retrieval-practice quiz AFTER the learner has gone through the lesson — it is a separate artifact, never auto-paired with the plan. You MUST pass `questions` you author yourself, grounded in the specific material the learner covered — for EVERY topic. Each question needs a real prompt, the correct answer, an explanation, and (for multiple-choice) plausible distractors. There is no template: calling this without 2+ valid questions is rejected with an instruction to author them. Choose concise character limits before generating; the engine clamps unsafe values and records them in quiz.review. Pass adaptive=true for adaptive branching, or reframes=[\"eli5\",\"debug\"] to pre-generate reframes. After calling this tool, do NOT repeat the quiz questions in your response — the interactive quiz UI renders them directly. Simply say 'Quiz ready' and wait.",
				{
					topic: { type: "string", description: "The topic to generate quiz questions for" },
					questions: {
						type: "array",
						minItems: 2,
						description: "REQUIRED. Pass a `questions` array authored from the real lesson material. Provide 4-10 for a good quiz. When 2+ valid questions are given, they fully replace the generic templates.",
						items: {
							type: "object",
							properties: {
								question: { type: "string", description: "The actual question prompt. For fill_in with multiple blanks, use ___ or {{blank}} as placeholders in the text." },
								type: { type: "string", enum: ["multiple_choice", "short_answer", "true_false", "fill_in", "transfer"], description: "Defaults to multiple_choice when options are given, otherwise short_answer. Use 'fill_in' for blanks: supply 'blanks' array for multi-blank questions (each blank is an ___) or just 'correctAnswer' for a single blank." },
								level: { type: "string", enum: ["recall", "comprehension", "application", "analysis", "transfer"], description: "Bloom level. Aim for a spread from recall to transfer." },
								options: { type: "array", items: { type: "string" }, description: "For multiple_choice: 3-4 plausible options. Include the correct answer; it is added automatically if missing." },
								blanks: { type: "array", items: { type: "object", properties: { placeholder: { type: "string" }, hint: { type: "string" } } }, description: "For fill_in with multiple blanks: one entry per ___ placeholder in the question text. The learner gets an input for each blank." },
								correctAnswer: { type: "string", description: "The correct answer (must match one option for multiple_choice). For multi-blank fill_in, use pipe-separated answers: '2x|2' or supply correctAnswers array." },
								correctAnswers: { type: "array", items: { type: "string" }, description: "Array of correct answers for multi-blank fill_in questions, one per blank in order." },
								explanation: { type: "string", description: "Why the answer is correct — the teaching moment." },
								rubric: { type: "string", description: "For open-ended questions: how to award partial credit. A sensible default is supplied if omitted." },
							},
							required: ["question", "correctAnswer", "explanation"],
							additionalProperties: false,
						},
					},
					adaptive: { type: "boolean", description: "Enable adaptive branching with fallback questions (default false)" },
					reframes: { type: "array", items: { type: "string" }, description: "Reframe modes to pre-generate, e.g. [\"eli5\", \"debug\", \"cooking\"]" },
					limits: {
						type: "object",
						description: "Optional concise output limits chosen for this quiz. Values are clamped to safe ranges.",
						properties: {
							question_chars: { type: "number", description: "Maximum characters per question, clamped to 80-320." },
							answer_chars: { type: "number", description: "Maximum characters per answer, clamped to 80-500." },
							explanation_chars: { type: "number", description: "Maximum characters per explanation, clamped to 80-500." },
							rubric_chars: { type: "number", description: "Maximum characters per rubric, clamped to 60-220." },
							option_chars: { type: "number", description: "Maximum characters per multiple-choice option, clamped to 40-220." },
						},
						additionalProperties: false,
					},
				},
				async (params) => {
					const topic = (params.topic as string) || "";
					if (!topic) throw new Error("Topic required.");

					const reframeModes = Array.isArray(params.reframes)
						? params.reframes.filter((r): r is string => typeof r === "string")
						: undefined;
					const rawLimits = params.limits && typeof params.limits === "object"
						? params.limits as Record<string, unknown>
						: undefined;
					const authored = Array.isArray(params.questions)
						? (params.questions as unknown[])
							.filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
							.map((q) => ({
								question: typeof q.question === "string" ? q.question : "",
								type: typeof q.type === "string" ? q.type as AuthoredQuestion["type"] : undefined,
								level: typeof q.level === "string" ? q.level as AuthoredQuestion["level"] : undefined,
								options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : undefined,
								blanks: Array.isArray(q.blanks)
									? q.blanks
										.filter((blank): blank is Record<string, unknown> => !!blank && typeof blank === "object")
										.map((blank) => ({
											placeholder: typeof blank.placeholder === "string" ? blank.placeholder : undefined,
											hint: typeof blank.hint === "string" ? blank.hint : undefined,
										}))
									: undefined,
								correctAnswer: typeof q.correctAnswer === "string" ? q.correctAnswer : "",
								correctAnswers: Array.isArray(q.correctAnswers) ? q.correctAnswers.filter((a): a is string => typeof a === "string") : undefined,
								explanation: typeof q.explanation === "string" ? q.explanation : "",
								rubric: typeof q.rubric === "string" ? q.rubric : undefined,
							}))
						: [];
					// No templates. The agent must author the questions itself, grounded in the
					// lesson the learner just went through. A quiz is built only AFTER the lesson
					// — it is a separate artifact, never auto-paired with the plan.
					const validAuthored = buildAuthoredQuestions(resolveTopic(topic), authored);
					if (validAuthored.length < 2) {
						throw new Error("Author the quiz yourself. Pass a `questions` array (4-10 items), each grounded in the specific lesson the learner just completed, with a real prompt, correctAnswer, explanation, and (for multiple-choice) plausible distractors. Build the quiz only after the learner has gone through the lesson — it is a separate artifact, not a companion to the plan. No template fallback exists.");
					}
					const quiz = generateQuiz(topic, 42, {
						adaptive: params.adaptive === true,
						reframes: reframeModes,
						authored,
						limits: rawLimits ? {
							questionChars: Number(rawLimits.question_chars),
							answerChars: Number(rawLimits.answer_chars),
							explanationChars: Number(rawLimits.explanation_chars),
							rubricChars: Number(rawLimits.rubric_chars),
							optionChars: Number(rawLimits.option_chars),
						} : undefined,
					});
					const md = quizToMarkdown(quiz);
					const answers = quizAnswerKeyToMarkdown(quiz);

					const saved = await storage.saveLessonPlan(topic, md, { type: "quiz", questionCount: quiz.questions.length });

					return `[artifact://plan/${saved.id}]\n\n${md}\n---\n${answers}\n\n<keating-quiz json=${JSON.stringify(JSON.stringify(quiz))} />`;
				},
				["topic", "questions"],
			),

		// feedback - Record learner feedback
		createTool(
			"feedback",
			"Record a learner feedback signal for a topic. Call this after teaching to track session outcomes. signal must be 'up', 'down', or 'confused'.",
			{
				signal: { type: "string", enum: ["up", "down", "confused"], description: "Feedback signal: up, down, or confused" },
				topic: { type: "string", description: "The topic the feedback is about (defaults to 'general')" }
			},
			async (params) => {
				const signalParam = (params.signal as string) || "";
				const signalMap: Record<string, "thumbs-up" | "thumbs-down" | "confused"> = {
					up: "thumbs-up",
					down: "thumbs-down",
					confused: "confused",
				};
				const signal = signalMap[signalParam];
				if (!signal) {
					return "signal must be 'up', 'down', or 'confused'.";
				}

				const topic = (params.topic as string) || "general";
				await storage.recordFeedback(topic, signal);

				return `Recorded ${signal} feedback for "${topic}".`;
			},
			["signal"],
		),

		// grade_quiz - Record the teacher's judgment of open-ended answers
		createTool(
			"grade_quiz",
			"Grade a learner's open-ended quiz answers (short_answer, transfer, free-text fill_in) AFTER they submit. Open-ended answers are never auto-graded by string match — you judge them by meaning, treating the reference answer as one acceptable answer rather than the only one. Pass the `result_id` from the <keating-quiz-result> payload in the submission message, plus a `grades` entry per open-ended question. Your verdicts flow back and update that result card. Objective questions (multiple_choice, true_false, multi_select, slider, dropdown, multi-blank fill_in) are already auto-graded — do not include them.",
			{
				result_id: { type: "string", description: "The `id` field from the <keating-quiz-result> payload of the submission you are grading." },
				grades: {
					type: "array",
					description: "One entry per open-ended question you are judging.",
					items: {
						type: "object",
						properties: {
							question_id: { type: "string", description: "The question's id." },
								verdict: {
									type: "string",
									enum: ["correct", "partial", "incorrect"],
									description: "Your judgment of the learner's answer by meaning. Invalid values are normalized to partial for backward compatibility.",
									"x-keating-normalize-invalid-enum": true,
								},
							note: { type: "string", description: "Short feedback shown to the learner (what was right/wrong)." },
						},
						required: ["question_id", "verdict"],
						additionalProperties: false,
						"x-keating-drop-invalid-item": true,
					},
				},
			},
			async (params) => {
				const resultId = typeof params.result_id === "string" ? params.result_id : "";
				if (!resultId) {
					throw new Error("result_id is required — pass the `id` from the <keating-quiz-result> payload of the submission you are grading.");
				}
				const validVerdicts: QuizGradeVerdict[] = ["correct", "partial", "incorrect"];
				const grades: QuizQuestionGrade[] = (Array.isArray(params.grades) ? params.grades : [])
					.filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
					.map((g) => ({
						questionId: typeof g.question_id === "string" ? g.question_id : "",
						verdict: validVerdicts.includes(g.verdict as QuizGradeVerdict) ? (g.verdict as QuizGradeVerdict) : "partial",
						note: typeof g.note === "string" ? g.note : undefined,
					}))
					.filter((g) => g.questionId);
				if (grades.length === 0) {
					throw new Error("Pass a non-empty `grades` array — one entry per open-ended question, each with question_id and verdict (correct|partial|incorrect).");
				}
				const payload = { resultId, grades };
				return `Recorded ${grades.length} open-ended grade(s).\n\n<keating-quiz-grade json=${JSON.stringify(JSON.stringify(payload))} />`;
			},
			["result_id", "grades"],
		),

		// policy - Show current teaching policy
		createTool(
			"ask_user_question",
			"Ask the learner one or more questions as an interactive form (choices, multi-select, free text, fill-in-the-blank, classification table, or matching worksheet). The learner fills it in and their answers are sent back automatically. Use to check understanding, gather goals/preferences, or branch the lesson. Pass `questions` for a multi-field form, or the single-question fields for a quick one-off.",
			{
				topic: { type: "string", description: "Optional topic this diagnostic checks; use the current lesson topic so the result updates the learner profile." },
				question: { type: "string", description: "A single question to ask (use `questions` for a multi-field form). For fill-in-the-blank, use ___ or {{blank}} as placeholders." },
				choices: { type: "array", items: { type: "string" }, description: "Optional answer choices. For classification questions, these are categories/slots; for matching questions, these are the answer-bank entries." },
				items: { type: "array", items: { type: "string" }, description: "Rows to classify or prompts to match when type is 'classification' or 'matching'." },
				multi_select: { type: "boolean", description: "Allow selecting multiple choices for the single question (default false)" },
				allow_text: { type: "boolean", description: "Allow free-text input (default: true if no choices, false if choices provided)" },
				type: { type: "string", enum: ["choice", "text", "blanks", "classification", "matching"], description: "Question type. 'choice' = multiple choice, 'text' = free text, 'blanks' = fill-in-the-blank, 'classification' = classify each item into one category, 'matching' = match each item to one answer-bank entry." },
				blanks: { type: "array", items: { type: "object", properties: { placeholder: { type: "string" }, hint: { type: "string" } } }, description: "Define blanks for fill-in-the-blank questions. Each entry corresponds to one ___ placeholder in the question text." },
				require_reasons: { type: "boolean", description: "For classification questions, require a short justification per row (default true)." },
				unique_matches: { type: "boolean", description: "For matching questions, prevent reusing an answer-bank choice (default true)." },
				correct_matches: { type: "array", items: { type: "string" }, description: "Optional answer key for matching questions, one correct choice per item in order. Enables red/green feedback after submission." },
				item_label: { type: "string", description: "Column label for classification items (default 'Item')." },
				choice_label: { type: "string", description: "Column label for classification choices or matching answer bank (default 'Choice')." },
				reason_label: { type: "string", description: "Column label for classification justifications (default 'Justification')." },
				hint: { type: "string", description: "Optional hint shown below the single question" },
				intro: { type: "string", description: "Optional intro text shown above the form" },
				questions: {
					type: "array",
					description: "Multiple questions to ask at once, each with its own header and input format",
					items: {
						type: "object",
						properties: {
							header: { type: "string", description: "Short label/chip shown above the question (e.g. 'Goal', 'Approach')" },
							question: { type: "string", description: "The question text. For blanks type, use ___ or {{blank}} as placeholders" },
							choices: { type: "array", items: { type: "string" }, description: "Optional answer choices. For classification questions, these are categories/slots; for matching questions, answer-bank entries." },
							items: { type: "array", items: { type: "string" }, description: "Rows to classify or prompts to match when type is 'classification' or 'matching'." },
							multi_select: { type: "boolean", description: "Allow selecting multiple choices (default false)" },
							allow_text: { type: "boolean", description: "Allow free-text input (default: true if no choices)" },
							type: { type: "string", enum: ["choice", "text", "blanks", "classification", "matching"], description: "Question type: choice, text, blanks, classification, or matching" },
							blanks: { type: "array", items: { type: "object", properties: { placeholder: { type: "string" }, hint: { type: "string" } } }, description: "Blank definitions for fill-in-the-blank, one per ___ placeholder" },
							require_reasons: { type: "boolean", description: "For classification questions, require a short justification per row (default true)." },
							unique_matches: { type: "boolean", description: "For matching questions, prevent reusing an answer-bank choice (default true)." },
							correct_matches: { type: "array", items: { type: "string" }, description: "Optional answer key for matching questions, one correct choice per item in order." },
							item_label: { type: "string", description: "Column label for classification items." },
							choice_label: { type: "string", description: "Column label for classification choices or matching answer bank." },
							reason_label: { type: "string", description: "Column label for classification justifications." },
							hint: { type: "string", description: "Optional hint shown below this question" },
						},
					},
				},
			},
			async (params) => {
				const toStringArray = (value: unknown): string[] | undefined =>
					Array.isArray(value)
						? value.filter((c): c is string => typeof c === "string")
						: undefined;

				type FormField = {
					header?: string;
					question: string;
					type?: string;
					choices?: string[];
					items?: string[];
					multi_select: boolean;
					allow_text: boolean;
					require_reasons?: boolean;
					unique_matches?: boolean;
					correct_matches?: string[];
					item_label?: string;
					choice_label?: string;
					reason_label?: string;
					hint?: string;
				};

				const buildField = (raw: Record<string, unknown>): FormField | null => {
					const question = String(raw.question ?? "");
					if (!question) return null;
					const choices = toStringArray(raw.choices);
					const items = toStringArray(raw.items);
					const correctMatches = toStringArray(raw.correct_matches);
					const hasChoices = !!choices && choices.length > 0;
					const type = typeof raw.type === "string" ? raw.type : undefined;
					if ((type === "classification" || type === "matching") && (!items || items.length === 0 || !hasChoices)) {
						return null;
					}
					return {
						header: raw.header ? String(raw.header) : undefined,
						question,
						type,
						choices: hasChoices ? choices : undefined,
						items: items && items.length > 0 ? items : undefined,
						multi_select: raw.multi_select === true,
						allow_text:
							type === "classification" || type === "matching"
								? false
								: typeof raw.allow_text === "boolean" ? raw.allow_text : !hasChoices,
						require_reasons:
							typeof raw.require_reasons === "boolean" ? raw.require_reasons : undefined,
						unique_matches:
							typeof raw.unique_matches === "boolean" ? raw.unique_matches : undefined,
						correct_matches:
							correctMatches && correctMatches.length > 0 ? correctMatches : undefined,
						item_label: raw.item_label ? String(raw.item_label) : undefined,
						choice_label: raw.choice_label ? String(raw.choice_label) : undefined,
						reason_label: raw.reason_label ? String(raw.reason_label) : undefined,
						hint: raw.hint ? String(raw.hint) : undefined,
					};
				};

				const fields: FormField[] = [];
				if (Array.isArray(params.questions)) {
					for (const item of params.questions) {
						if (item && typeof item === "object") {
							const field = buildField(item as Record<string, unknown>);
							if (field) fields.push(field);
						}
					}
				}
				if (fields.length === 0) {
					const single = buildField(params);
					if (single) fields.push(single);
				}
				if (fields.length === 0) return "Error: at least one question is required.";

				const intro = params.intro ? String(params.intro) : undefined;
				const topic = typeof params.topic === "string" && params.topic.trim() ? params.topic.trim() : undefined;
				const payload = JSON.stringify({ intro, topic, questions: fields });
				const summary = fields.map((f) => f.question).join(" | ");
				return `[question] Asking learner: ${summary}\n\n<keating-question json=${JSON.stringify(payload)} />`;
			}
		),

		createTool(
			"grade_question_checks",
			"Grade pending ask_user_question responses after reading them in the conversation. Use this only for actual comprehension checks, not preference or goal questions. A partial verdict means the core idea is incomplete or contains a recoverable misconception.",
			{
				topic: { type: "string", description: "Topic used when the questions were asked." },
				results: {
					type: "array",
					description: "One verdict for each pending response being graded.",
					items: {
						type: "object",
						properties: {
							question: { type: "string", description: "The exact question text from the learner response." },
							verdict: { type: "string", enum: ["correct", "partial", "incorrect"], description: "Meaning-based assessment of the learner's answer." },
							misconception: { type: "string", description: "Optional concise misconception supported by the answer." },
						},
					},
				},
			},
			async (params) => {
				const topic = String(params.topic ?? "").trim();
				const results = Array.isArray(params.results) ? params.results : [];
				if (!topic || results.length === 0) return "Error: topic and at least one result are required.";
				const pending = (await storage.getQuestionChecks(topic))
					.filter((check) => check.grading === "pending")
					.sort((left, right) => right.createdAt - left.createdAt);
				let graded = 0;
				for (const result of results) {
					if (!result || typeof result !== "object") continue;
					const item = result as Record<string, unknown>;
					const question = String(item.question ?? "").trim();
					const verdict = item.verdict;
					if (!question || (verdict !== "correct" && verdict !== "partial" && verdict !== "incorrect")) continue;
					const check = pending.find((candidate) => candidate.question === question);
					if (!check) continue;
					const score = verdict === "correct" ? 1 : verdict === "partial" ? 0.5 : 0;
					await storage.gradeQuestionCheck(check.id, {
						score,
						misconception: typeof item.misconception === "string" ? item.misconception : undefined,
					});
					graded += 1;
				}
				return graded > 0
					? `Recorded ${graded} graded diagnostic check${graded === 1 ? "" : "s"} for "${topic}".`
					: `No pending diagnostic checks matched the supplied questions for "${topic}".`;
			},
			["topic", "results"],
		),

		// set_learner_goal - Capture a long-horizon goal and scaffold a tracked curriculum
	];
}
