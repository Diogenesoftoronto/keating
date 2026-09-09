/** V2 objective contracts. Teaching meaning and answer-withholding remain independently rated. */
import { checkBenchmark, type BenchmarkCheckInput, type ContractCheck } from './benchmark_check';
import { stepBenchmarkTools, type AssistantResponse, type ToolStepCase } from './benchmark_tool_step';
import { stripOpenUIPrograms } from '../../web/src/keating/openui/segments';
import { parseSimulationExpression, evaluateSimulationExpression } from '../../packages/learner-contracts/src/simulation-expression.js';
import type { UiQuestion, UiDocumentNode } from '../../packages/learner-contracts/src/index.js';

type Verdict = 'correct' | 'partial' | 'incorrect';
export interface BenchmarkExpectationV2 {
  components?: Array<{ type: string; node_count: number }>;
  visible_text?: { max_words?: number; max_characters?: number };
  questions?: { count?: number; choice_question_count?: number; text_question_count?: number; choices_per_question?: number; require_reasons?: boolean };
  quiz?: { question_kinds?: Record<string, number>; choices_per_question_by_kind?: Record<string, number>; all_answer_keys?: boolean; answer_keys?: Record<string, unknown> };
  grading?: Array<{ tool: 'grade_quiz' | 'grade_question_checks'; verdicts: Record<string, Verdict> }>;
  memory?: { forbidden?: boolean };
  simulation?: { readouts: Array<{ id: string; probes: Array<{ values: Record<string, number>; expected: number; tolerance?: number }> }> };
}
export interface BenchmarkCheckV2Input {
  case: Omit<ToolStepCase, 'expect_v2'> & { expect_v2?: BenchmarkExpectationV2 };
  response?: BenchmarkCheckInput['response'];
  turns?: AssistantResponse[];
  tools?: BenchmarkCheckInput['tools'];
}
function assert(value: unknown, text: string): asserts value { if (!value) throw Error(text); }
function matchingType(node: UiDocumentNode, type: string) {
  return ['question', 'question-group'].includes(type) ? ['question', 'question-group'].includes(node.type) : node.type === type;
}
function key(question: UiQuestion): unknown {
  return question.correctAnswers?.length ? question.correctAnswers : question.correctMatches?.length ? question.correctMatches : question.correctAnswer;
}

export async function checkBenchmarkV2(input: BenchmarkCheckV2Input) {
  const turns = input.turns ?? [typeof input.response === 'string' ? { content: input.response } : input.response ?? {}];
  const limit = input.case.episode?.max_assistant_turns ?? 3;
  const last = turns.at(-1) ?? {};
  const calls = turns.flatMap(turn => turn.tool_calls ?? []);
  const result = await checkBenchmark({ case: input.case, response: { ...last, tool_calls: calls }, tools: input.tools });
  const checks: ContractCheck[] = [...result.checks];
  const extra = input.case.expect_v2 ?? {};
  async function check(name: string, run: () => string | Promise<string>) {
    try { checks.push({ name, status: 'pass', evidence: await run() }); }
    catch (error) { checks.push({ name, status: 'fail', evidence: error instanceof Error ? error.message : String(error) }); }
  }
  await check('episode.turn_limit', () => {
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 3, 'The frozen episode limit must be between one and three.');
    assert(turns.length >= 1 && turns.length <= limit, `Received ${turns.length} assistant turns; limit is ${limit}.`);
    return `${turns.length}/${limit} assistant turns used.`;
  });
  await check('episode.follow_through', () => {
    const visible = input.case.expect.visible_response ?? (input.case.expect.required_tools?.length ?? 0) === 0;
    assert(!visible || !(last.tool_calls?.length), 'The episode ended on a native tool call; no subsequent visible assistant response was sampled.');
    assert(turns.every(turn => !turn.error), 'A provider error occurred in the episode.');
    return visible ? 'The endpoint has no native call awaiting a follow-up; final visibility is assessed under delivery.' : 'This fixture permits a native-call endpoint.';
  });
  const turnChecks = [];
  for (const [index, turn] of turns.entries()) {
    const checked = await checkBenchmark({
      case: { id: `${input.case.id}-turn-${index + 1}`, expect: { visible_response: false, allowed_tools: input.case.expect.allowed_tools ?? input.case.expect.required_tools?.map(tool => tool.name) ?? [] } },
      response: turn, tools: input.tools,
    });
    // Earlier malformed surfaces and calls remain failures even when the final reply is valid.
    for (const item of checked.checks) if (item.status === 'fail') checks.push({ ...item, name: `turn.${index + 1}.${item.name}` });
    turnChecks.push({ turn: index + 1, delivery: checked.delivery, checks: checked.checks, openui: checked.openui });
  }
  let execution: Awaited<ReturnType<typeof stepBenchmarkTools>> | undefined;
  await check('episode.isolated_tools', async () => {
    execution = await stepBenchmarkTools({ case: input.case as ToolStepCase, turns, tools: input.tools });
    const errors = execution.execution.filter(row => row.status === 'error');
    assert(!errors.length, errors.map(row => `Turn ${row.turn} ${row.name}: ${row.content}`).join('\n'));
    return `${execution.execution.length} native call(s) executed or inspected in isolated memory. No external effects.`;
  });
  if (extra.memory?.forbidden) await check('memory.forbidden', () => {
    assert(!calls.some(call => (call.function?.name ?? call.name) === 'remember_learner_profile'), 'This learner explicitly forbade durable memory; a profile-write call was attempted.');
    return 'No durable learner-profile write was attempted.';
  });
  if (extra.visible_text) {
    const prose = stripOpenUIPrograms(last.content ?? '').trim();
    if (extra.visible_text.max_words !== undefined) await check('visible_text.max_words', () => {
      const count = prose ? prose.split(/\s+/u).length : 0;
      assert(count <= extra.visible_text!.max_words!, `Visible prose has ${count} whitespace-delimited words; limit ${extra.visible_text!.max_words}. OpenUI source is excluded.`);
      return `${count}/${extra.visible_text!.max_words} words outside OpenUI source.`;
    });
    if (extra.visible_text.max_characters !== undefined) await check('visible_text.max_characters', () => {
      const count = Array.from(prose).length;
      assert(count <= extra.visible_text!.max_characters!, `Visible prose has ${count} Unicode characters; limit ${extra.visible_text!.max_characters}.`);
      return `${count}/${extra.visible_text!.max_characters} Unicode characters outside OpenUI source.`;
    });
  }
  const nodes = result.openui.documents.flatMap(document => document.nodes);
  for (const [index, component] of (extra.components ?? []).entries()) await check(`structure.component.${index}`, () => {
    const count = nodes.filter(node => matchingType(node, component.type)).length;
    assert(count === component.node_count, `Expected ${component.node_count} ${component.type} node(s); received ${count}.`);
    return `${count} canonical ${component.type} node(s).`;
  });
  const questions = nodes.flatMap(node => node.type === 'question' ? [node] : node.type === 'question-group' ? node.questions : []);
  if (extra.questions) {
    await check('questions.structure', () => {
      assert(questions.length > 0, 'No canonical Question or question group was found.');
      const choiceQuestions = questions.filter(question => (question.choices?.length ?? 0) > 0);
      const textQuestions = questions.filter(question => !question.choices?.length && ['text', 'short_answer', 'transfer'].includes(question.kind ?? 'text'));
      if (extra.questions!.count !== undefined) assert(questions.length === extra.questions!.count, `Expected ${extra.questions!.count} questions; received ${questions.length}.`);
      if (extra.questions!.choice_question_count !== undefined) assert(choiceQuestions.length === extra.questions!.choice_question_count, `Expected ${extra.questions!.choice_question_count} questions with choice controls; received ${choiceQuestions.length}.`);
      if (extra.questions!.text_question_count !== undefined) assert(textQuestions.length === extra.questions!.text_question_count, `Expected ${extra.questions!.text_question_count} separate text questions; received ${textQuestions.length}.`);
      if (extra.questions!.choices_per_question !== undefined) assert(choiceQuestions.length > 0 && choiceQuestions.every(question => question.choices!.length === extra.questions!.choices_per_question), `Every choice-bearing Question must have exactly ${extra.questions!.choices_per_question} choices.`);
      if (extra.questions!.require_reasons !== undefined) assert(questions.every(question => (question.requireReasons === true) === extra.questions!.require_reasons), `Every Question must set requireReasons=${extra.questions!.require_reasons}. This checks the declared contract, not learner reasoning quality.`);
      return `${questions.length} canonical Question item(s) match the explicit structural requirements.`;
    });
  }
  const quizQuestions = nodes.flatMap(node => node.type === 'quiz' ? node.questions : []);
  for (const [kind, count] of Object.entries(extra.quiz?.choices_per_question_by_kind ?? {})) await check(`quiz.choices.${kind}`, () => {
    const matching = quizQuestions.filter(question => (question.kind ?? (question.choices ? 'choice' : 'text')) === kind);
    assert(matching.length > 0 && matching.every(question => (question.choices?.length ?? 0) === count), `Every ${kind} quiz item must have exactly ${count} choices.`);
    return `${matching.length} ${kind} quiz item(s) each have ${count} choices.`;
  });
  if (extra.quiz?.question_kinds) await check('quiz.question_kinds', () => {
    const actual: Record<string, number> = {};
    for (const question of quizQuestions) {
      const kind = question.kind ?? (question.choices ? 'choice' : 'text');
      actual[kind] = (actual[kind] ?? 0) + 1;
    }
    const expected = extra.quiz!.question_kinds!;
    assert(Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([kind, count]) => actual[kind] === count), `Expected question-kind counts ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`);
    return `Question kinds match ${JSON.stringify(actual)}.`;
  });
  if (extra.quiz?.all_answer_keys) await check('quiz.answer_key_presence', () => {
    assert(quizQuestions.length > 0 && quizQuestions.every(question => { const answer = key(question); return typeof answer === 'string' ? !!answer.trim() : Array.isArray(answer) && answer.length > 0; }), 'Every quiz question needs a non-empty answer key. Key correctness is not inferred from its presence.');
    return `${quizQuestions.length} answer keys are present; semantic correctness remains separately reviewed.`;
  });
  for (const [id, expected] of Object.entries(extra.quiz?.answer_keys ?? {})) await check(`quiz.answer_key.${id}`, () => {
    const matches = quizQuestions.filter(question => question.id === id);
    assert(matches.length === 1 && JSON.stringify(key(matches[0]!)) === JSON.stringify(expected), `The objective answer key for supplied question ${id} differs from the fixed value.`);
    return `The supplied objective key for ${id} matches.`;
  });
  for (const grading of extra.grading ?? []) await check(`grading.verdicts.${grading.tool}`, () => {
    const actual: Array<{ id: unknown; verdict: unknown }> = [];
    for (const call of calls.filter(call => (call.function?.name ?? call.name) === grading.tool)) {
      const raw = call.function?.arguments ?? call.arguments;
      const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const entries = grading.tool === 'grade_quiz' ? args?.grades : args?.results;
      assert(Array.isArray(entries), 'The grading tool did not supply grade entries.');
      actual.push(...entries.map(entry => ({ id: grading.tool === 'grade_quiz' ? entry.question_id : entry.question, verdict: entry.verdict })));
    }
    const expected = Object.entries(grading.verdicts);
    assert(actual.length === expected.length && new Set(actual.map(item => item.id)).size === actual.length && expected.every(([id, verdict]) => actual.some(item => item.id === id && item.verdict === verdict)), `Expected the declared verdict once for each fixed pending item; received ${JSON.stringify(actual)}.`);
    return `${expected.length} known fixture verdict(s) match. This is a fixed grading case, not automatic scoring of teaching prose.`;
  });
  for (const readout of extra.simulation?.readouts ?? []) await check(`simulation.readout.${readout.id}`, () => {
    const matches = nodes.flatMap(node => node.type === 'simulation' ? node.readouts.filter(item => item.id === readout.id).map(item => ({ node, item })) : []);
    assert(matches.length === 1, `Expected one simulation readout with supplied ID ${readout.id}.`);
    const { node, item } = matches[0]!;
    const parsed = parseSimulationExpression(item.expr, node.parameters.map(parameter => parameter.id));
    assert(parsed.ok, 'The readout expression is invalid.');
    assert(readout.probes.length > 0, 'A fixed scientific readout requires numerical probes.');
    for (const probe of readout.probes) {
      assert(Object.keys(probe.values).every(id => node.parameters.some(parameter => parameter.id === id)), 'A supplied scientific parameter ID is missing.');
      const value = evaluateSimulationExpression(parsed.node, { ...Object.fromEntries(node.parameters.map(parameter => [parameter.id, parameter.value])), ...probe.values });
      assert(typeof value === 'number' && Math.abs(value - probe.expected) <= (probe.tolerance ?? 1e-8), `Readout ${readout.id} at ${JSON.stringify(probe.values)} returned ${value}; expected ${probe.expected}.`);
    }
    return `${readout.probes.length} fixed numerical probes matched; no general scientific accuracy claim.`;
  });
  return {
    ...result, checks, contract_passed: checks.every(item => item.status !== 'fail'), teaching_quality: null,
    episode: { assistant_turns: turns.length, max_assistant_turns: limit, turns: turnChecks, tool_execution: execution?.execution ?? [], state: execution?.state ?? null },
    scoring_note: 'Final delivery and objective contracts are separate from teaching quality. Prior calls and malformed UI remain checked. No exact prose targets, answer-leakage regex, or human learning score is used.',
  };
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw Error('Usage: bun benchmark_check_v2.ts INPUT.json OUTPUT.json');
  const input = await Bun.file(source).json();
  const output = Array.isArray(input) ? await Promise.all(input.map(checkBenchmarkV2)) : Array.isArray(input.cases) ? { results: await Promise.all(input.cases.map(checkBenchmarkV2)) } : await checkBenchmarkV2(input);
  await Bun.write(destination, JSON.stringify(output, null, 2));
}
