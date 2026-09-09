/** Static output contracts only. These checks never assign teaching-quality scores. */
import {
  compileOpenUISourceToSharedDocument,
  validateUiDocument,
  type UiDocument,
  type UiDocumentNode,
  type UiQuestion,
  type UiQuestionGroupResponse,
} from '../../packages/learner-contracts/src/index.js';
import { parseSimulationExpression, evaluateSimulationExpression } from '../../packages/learner-contracts/src/simulation-expression.js';
import { parseOpenUIMessageSegments } from '../../web/src/keating/openui/segments';
import { dispatchSharedUiAction, type SharedUiActionIntent } from '../../web/src/keating/openui/shared-actions';
import { createTool } from '../../web/src/keating/browser-tools/shared';
import { createAssessmentTools } from '../../web/src/keating/browser-tools/assessment';
import { createTeachingTools } from '../../web/src/keating/browser-tools/teaching';
import { buildGoal } from '../../web/src/keating/goals';
import type { KeatingStorage } from '../../web/src/keating/storage';
import { objectiveCredit } from '../../web/src/keating/openui/quiz-progress';
import { applyReview, initialSrsState } from '../../web/src/keating/srs';

const AT = '2026-09-07T12:00:00.000Z';
type CheckStatus = 'pass' | 'fail' | 'not_applicable';
export interface ContractCheck { name: string; status: CheckStatus; evidence: string }
export interface RequiredTool {
  name: string;
  count?: number;
  identifiers?: Record<string, unknown>;
  question_ids?: string[];
  questions?: string[];
}
export interface BenchmarkExpectation {
  visible_response?: boolean;
  allowed_tools?: string[];
  required_tools?: RequiredTool[];
  openui?: {
    surface_count?: number;
    components: Array<{ type: string; count?: number; mode?: string }>;
    retention?: string;
    exercise_actions?: boolean;
  };
}
export interface BenchmarkCheckInput {
  case: { id: string; expect: BenchmarkExpectation };
  response: string | {
    content?: string | null;
    tool_calls?: Array<{ id?: string; function?: { name: string; arguments: string | Record<string, unknown> }; name?: string; arguments?: string | Record<string, unknown> }>;
    error?: unknown;
    finish_reason?: string;
  };
  /** Exact frozen tool declarations passed to the model. If omitted, use the real local teaching/assessment registry. */
  tools?: Array<{ function: { name: string; parameters: { properties?: Record<string, unknown>; required?: string[] } } }>;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function assert(condition: unknown, evidence: string): asserts condition { if (!condition) throw Error(evidence); }
function sameMembers(actual: unknown[], expected: string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === expected.length && actual.every(value => expected.includes(value as string));
}

/** Inputs here come from fixed fixture expectations, never from the candidate's invented IDs. */
function isolatedTools(required: RequiredTool[]) {
  const mutations: Array<{ name: string; id?: string }> = [];
  const diagnostic = required.find(tool => tool.name === 'grade_question_checks');
  const pending = (diagnostic?.questions ?? []).map((question, index) => ({
    id: `benchmark-pending-${index}`, topic: diagnostic?.identifiers?.topic,
    question, grading: 'pending', createdAt: Date.parse(AT),
  }));
  const goalExpectation = required.find(tool => tool.name === 'update_goal_step');
  const goal = buildGoal({ title: 'Benchmark learner goal', steps: [{ title: 'Current step', kind: 'practice' }] });
  if (typeof goalExpectation?.identifiers?.goal_id === 'string') goal.id = goalExpectation.identifiers.goal_id;
  if (typeof goalExpectation?.identifiers?.step_id === 'string') goal.steps[0]!.id = goalExpectation.identifiers.step_id;
  const storage = {
    getQuestionChecks: async (topic: string) => pending.filter(row => row.topic === topic),
    gradeQuestionCheck: async (id: string) => {
      assert(pending.some(row => row.id === id), 'The diagnostic check does not exist in the fixture.');
      mutations.push({ name: 'grade_question_checks', id });
    },
    recordFeedback: async () => { mutations.push({ name: 'feedback' }); },
    rememberLearnerProfileBelief: async (belief: Record<string, unknown>) => {
      mutations.push({ name: 'remember_learner_profile' });
      return { ...belief, confidence: belief.source === 'explicit' ? 1 : Math.min(Number(belief.confidence ?? .65), .65) };
    },
    getGoal: async (id: string) => id === goal.id ? goal : undefined,
    saveGoal: async (value: typeof goal) => { mutations.push({ name: 'saveGoal', id: value.id }); return value; },
  } as unknown as KeatingStorage;
  return { tools: [...createAssessmentTools(storage, async () => []), ...createTeachingTools(storage)], mutations };
}

function answerQuestion(question: UiQuestion): UiQuestionGroupResponse {
  if (question.kind === 'ordering') return { questionId: question.id, type: 'order', items: [...(question.items ?? [])] };
  if (question.kind === 'classification' || question.kind === 'matching') return {
    questionId: question.id, type: 'rows', rows: (question.items ?? []).map((item, index) => ({
      item, optionId: question.choices?.[question.kind === 'matching' && question.uniqueMatches !== false ? index : 0]?.id ?? '',
      reason: 'A test learner supplied this reason.',
    })),
  };
  if (question.kind === 'blanks' || question.kind === 'fill_in') return {
    questionId: question.id, type: 'blanks', answers: (question.blanks?.length ? question.blanks : [{}]).map(() => 'A test answer'),
  };
  if (question.choices?.length) return { questionId: question.id, type: 'choice', optionIds: [question.choices[0]!.id] };
  return { questionId: question.id, type: 'text', answer: 'A test learner response.' };
}

/** Exercises real canonical actions; generated answers are plumbing probes, never reference teaching targets. */
function actionIntent(node: UiDocumentNode): SharedUiActionIntent | undefined {
  if (node.type === 'question-group') return { type: 'submit-question-group', nodeId: node.id, responses: node.questions.map(answerQuestion) };
  if (node.type === 'question') {
    const response = answerQuestion(node);
    if (response.type === 'choice') return { type: 'choose-option', nodeId: node.id, optionIds: response.optionIds };
    const answer = response.type === 'text' ? response.answer : response.type === 'blanks' ? response.answers : response.type === 'rows' ? response.rows : response.items;
    return { type: 'submit-answer', nodeId: node.id, answer };
  }
  if (node.type === 'quiz') {
    const partialCredits: Record<string, number> = {};
    const pendingGradeQuestionIds: string[] = [];
    const answers = node.questions.map(question => {
      const answer = question.correctAnswer ?? 'A test answer';
      const credit = objectiveCredit(question, answer);
      if (credit === undefined) pendingGradeQuestionIds.push(question.id);
      else partialCredits[question.id] = credit;
      return { questionId: question.id, answer };
    });
    return {
      type: 'complete-quiz', nodeId: node.id, resultId: `${node.id}-benchmark-result`, answers,
      score: Object.values(partialCredits).filter(credit => credit === 1).length,
      partialCreditPoints: Object.values(partialCredits).reduce((sum, credit) => sum + credit, 0), partialCredits,
      pendingGradeQuestionIds, skippedQuestionIds: [], flaggedQuestionIds: [],
      timing: { totalMs: 60000, perQuestionMs: Object.fromEntries(node.questions.map(question => [question.id, 60000 / node.questions.length])) },
    };
  }
  if (node.type === 'deck') return {
    type: 'complete-deck', nodeId: node.id,
    ratings: node.cards.map(card => {
      const outcome = applyReview(initialSrsState(Date.parse(AT)), 2, Date.parse(AT));
      return { cardId: card.id, rating: 2, appliedIntervalDays: outcome.appliedIntervalDays, easeAfter: outcome.next.ease };
    }), summary: { reviewed: node.cards.length, lapses: 0 },
  };
  if (node.type === 'notes') return { type: 'update-notes', nodeId: node.id, value: 'A test learner note.' };
  if (node.type === 'study-plan' && node.items?.[0]) return { type: 'complete-plan-item', nodeId: node.id, itemId: node.items[0].id, completed: true };
  return undefined;
}

function nodeCount(node: UiDocumentNode): number {
  if (node.type === 'quiz' || node.type === 'question-group') return node.questions.length;
  if (node.type === 'deck') return node.cards.length;
  if (node.type === 'study-plan') return node.items?.length ?? 0;
  return 1;
}
function matchesType(node: UiDocumentNode, type: string): boolean {
  return type === 'question' || type === 'question-group'
    ? node.type === 'question' || node.type === 'question-group'
    : node.type === type;
}

export async function checkBenchmark(input: BenchmarkCheckInput) {
  const expectation = input.case.expect;
  const response = typeof input.response === 'string' ? { content: input.response } : input.response;
  const content = typeof response?.content === 'string' ? response.content : '';
  const calls = Array.isArray(response?.tool_calls) ? response.tool_calls : [];
  const required = expectation.required_tools ?? [];
  const checks: ContractCheck[] = [];
  async function check(name: string, fn: () => string | Promise<string>) {
    try { checks.push({ name, status: 'pass', evidence: await fn() }); }
    catch (error) { checks.push({ name, status: 'fail', evidence: message(error) }); }
  }
  function na(name: string, evidence: string) { checks.push({ name, status: 'not_applicable', evidence }); }
  const visibleRequired = expectation.visible_response ?? required.length === 0;
  const delivered = !response?.error && (visibleRequired ? !!content.trim() : !!content.trim() || calls.length > 0);
  const delivery = {
    status: (delivered ? 'pass' : 'fail') as CheckStatus,
    evidence: response?.error ? `Provider returned an error: ${message(response.error)}` : delivered
      ? visibleRequired ? 'Visible response received.' : 'Visible response or native call received.'
      : visibleRequired ? 'This case requires a visible response; none was returned.' : 'Neither a visible response nor a native call was returned.',
    characters: content.length, tool_calls: calls.length, finish_reason: response?.finish_reason ?? null,
  };
  const isolated = isolatedTools(required);
  const parsedCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];
  const allowed = new Set(expectation.allowed_tools ?? required.map(tool => tool.name));
  await check('tools.allowed', () => {
    const unexpected = calls.map(call => call.function?.name ?? call.name ?? '(unnamed)').filter(name => !allowed.has(name));
    assert(!unexpected.length, `Unexpected native calls: ${unexpected.join(', ')}.`);
    return `${calls.length} native call(s); all are permitted for this case.`;
  });
  if (!calls.length) na('tools.arguments', 'No native calls returned.');
  for (const [index, call] of calls.entries()) await check(`tools.arguments.${index}`, async () => {
    const name = call.function?.name ?? call.name ?? '';
    const raw = call.function?.arguments ?? call.arguments;
    const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
    assert(args && typeof args === 'object' && !Array.isArray(args), `${name} arguments must be a JSON object.`);
    const local = isolated.tools.find(tool => tool.name === name);
    const exported = input.tools?.find(tool => tool.function.name === name)?.function.parameters;
    if (input.tools) assert(exported, `${name} was not exposed to the model in the frozen tool context.`);
    const schema = (exported ?? local?.parameters) as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    assert(schema, `${name} has no available application schema.`);
    const validator = createTool(name, 'Offline benchmark argument validation', schema.properties ?? {}, async () => 'Validated.', schema.required ?? []);
    await validator.execute(call.id ?? `benchmark-call-${index}`, args);
    parsedCalls.push({ name, args, id: call.id ?? `benchmark-call-${index}` });
    return `${name} arguments pass the actual application schema validator.`;
  });
  for (const requiredTool of required) await check(`tools.required.${requiredTool.name}`, () => {
    const matching = calls.filter(call => (call.function?.name ?? call.name) === requiredTool.name);
    assert(matching.length === (requiredTool.count ?? 1), `Expected ${requiredTool.count ?? 1} ${requiredTool.name} call(s); received ${matching.length}.`);
    return `Required ${requiredTool.name} call count matched.`;
  });
  for (const [index, call] of parsedCalls.entries()) {
    const expected = required.find(tool => tool.name === call.name);
    if (expected) await check(`tools.identifiers.${index}`, () => {
      for (const [key, value] of Object.entries(expected.identifiers ?? {})) {
        assert(JSON.stringify(call.args[key]) === JSON.stringify(value), `${call.name} must use the actual supplied ${key}.`);
      }
      if (expected.question_ids) {
        const grades = Array.isArray(call.args.grades) ? call.args.grades as Array<Record<string, unknown>> : [];
        assert(sameMembers(grades.map(grade => grade.question_id), expected.question_ids), 'Grade every pending open-ended question ID exactly once, excluding objective or unrelated questions.');
        assert(grades.every(grade => ['correct', 'partial', 'incorrect'].includes(grade.verdict as string)), 'Each grade needs an explicit valid verdict; silent compatibility normalization is not a successful benchmark grade.');
      }
      if (expected.questions) {
        const results = Array.isArray(call.args.results) ? call.args.results as Array<Record<string, unknown>> : [];
        assert(sameMembers(results.map(result => result.question), expected.questions), 'Grade the actual pending diagnostic questions exactly once.');
        assert(results.every(result => ['correct', 'partial', 'incorrect'].includes(result.verdict as string)), 'Each pending diagnostic result needs a valid verdict.');
      }
      return 'All declared identifiers and pending-item membership match the fixture; verdict meaning remains unscored.';
    });
    const safe = ['feedback', 'remember_learner_profile', 'set_learner_goal', 'grade_quiz', 'grade_question_checks', 'update_goal_step'];
    if (!allowed.has(call.name) || !safe.includes(call.name) || !isolated.tools.some(tool => tool.name === call.name)) {
      na(`tools.execution.${index}`, 'Only allowlisted teaching and assessment tools execute against isolated fixture storage.');
      continue;
    }
    if ((call.name === 'grade_question_checks' && !expected?.questions) || (call.name === 'update_goal_step' && (!expected?.identifiers?.goal_id || !expected?.identifiers?.step_id))) {
      na(`tools.execution.${index}`, 'No complete fixed storage fixture exists for this optional call; argument validation only.');
      continue;
    }
    await check(`tools.execution.${index}`, async () => {
      const before = isolated.mutations.length;
      const tool = isolated.tools.find(tool => tool.name === call.name)!;
      await tool.execute(call.id, call.args);
      if (call.name === 'grade_question_checks') {
        const touched = isolated.mutations.slice(before).map(mutation => mutation.id);
        assert(touched.length === expected!.questions!.length && new Set(touched).size === touched.length, 'The tool did not update every distinct pending diagnostic check.');
      }
      return `${call.name} executed in isolated memory; ${isolated.mutations.length - before} storage mutation(s). No external delivery or persistence is implied.`;
    });
  }

  const documents: UiDocument[] = [];
  const surfaces: Array<{ id: string; complete: boolean; format: string; compiled: boolean; error?: string }> = [];
  const segments = parseOpenUIMessageSegments(content, input.case.id);
  const uiSegments = segments.filter(segment => segment.type === 'openui');
  const markupPresent = /<openui\b|<openui-|```openui\b/i.test(content);
  if (!uiSegments.length && !markupPresent && !expectation.openui) na('openui.compile', 'This response contains no OpenUI surface.');
  else await check('openui.compile', () => {
    assert(uiSegments.length > 0, 'No OpenUI surface was recognized by the actual message parser.');
    for (const segment of uiSegments) {
      const surface = { id: segment.metadata.id, complete: segment.complete, format: segment.format, compiled: false } as typeof surfaces[number];
      surfaces.push(surface);
      try {
        assert(segment.complete, 'The OpenUI fence is incomplete.');
        const document = segment.format === 'source'
          ? compileOpenUISourceToSharedDocument(segment.program, { documentId: segment.metadata.id, createdAt: AT, updatedAt: AT })
          : segment.document;
        assert(validateUiDocument(document), 'The compiled canonical OpenUI document is invalid.');
        documents.push(document); surface.compiled = true;
      } catch (error) { surface.error = message(error); }
    }
    assert(surfaces.every(surface => surface.compiled), surfaces.filter(surface => !surface.compiled).map(surface => surface.error).join(' '));
    return `${documents.length} complete surface(s) compiled through the current canonical contract.`;
  });
  if (expectation.openui) {
    await check('openui.surface_count', () => {
      const wanted = expectation.openui!.surface_count ?? 1;
      assert(uiSegments.length === wanted, `Expected ${wanted} OpenUI surface(s); received ${uiSegments.length}.`);
      return `${wanted} recognized surface(s).`;
    });
    for (const [index, component] of expectation.openui.components.entries()) await check(`openui.component.${index}`, () => {
      const nodes = documents.flatMap(document => document.nodes).filter(node => matchesType(node, component.type));
      assert(nodes.length > 0, `No compiled ${component.type} activity was found.`);
      if (component.count !== undefined) {
        const count = nodes.reduce((sum, node) => sum + nodeCount(node), 0);
        assert(count === component.count, `Expected ${component.count} ${component.type} item(s); received ${count}.`);
      }
      if (component.mode) assert(nodes.every(node => node.type === 'quiz' && (component.mode === 'quiz' ? node.mode !== 'exam' : node.mode === component.mode)), `Requested mode is ${component.mode}.`);
      if (component.mode === 'exam') assert(nodes.every(node => node.type === 'quiz' && node.questions.length >= 20), 'An exam requires at least twenty questions.');
      return `${component.type} type${component.count !== undefined ? ` and ${component.count} item count` : ''}${component.mode ? `, ${component.mode} mode` : ''} matched.`;
    });
    if (expectation.openui.retention) await check('openui.retention', () => {
      assert(documents.length > 0 && documents.every(document => document.retention === expectation.openui!.retention), `Every requested surface must use ${expectation.openui!.retention} retention.`);
      return `All compiled surfaces use ${expectation.openui!.retention} retention.`;
    });
  }
  const actionResults: Array<Record<string, unknown>> = [];
  if (!expectation.openui?.exercise_actions) na('openui.actions', 'Canonical action execution was not requested for this case.');
  else if (!documents.length) checks.push({ name: 'openui.actions', status: 'fail', evidence: 'No compiled document is available for the requested action probe.' });
  else for (const document of documents) for (const node of document.nodes) {
    if (!expectation.openui.components.some(component => matchesType(node, component.type))) continue;
    if (node.type === 'simulation') {
      await check(`openui.simulation.${node.id}`, () => {
        assert(node.parameters.length && node.readouts.length, 'A simulation needs a parameter and computed readout.');
        for (const readout of node.readouts) {
          const parsed = parseSimulationExpression(readout.expr, node.parameters.map(parameter => parameter.id));
          assert(parsed.ok, `The ${readout.id} readout expression does not parse.`);
          // Probe each control's bounds with the other controls at their defaults, plus all-low/all-high.
          const defaults = Object.fromEntries(node.parameters.map(parameter => [parameter.id, parameter.value]));
          const probes = ['min', 'max'].flatMap(edge => [
            Object.fromEntries(node.parameters.map(parameter => [parameter.id, parameter[edge as 'min' | 'max']])),
            ...node.parameters.map(parameter => ({ ...defaults, [parameter.id]: parameter[edge as 'min' | 'max'] })),
          ]);
          for (const values of probes) assert(evaluateSimulationExpression(parsed.node, values) !== undefined, `The ${readout.id} readout is non-finite at a tested boundary.`);
        }
        return 'Every readout is finite at the declared boundary probes; mathematical meaning is unscored.';
      });
      continue;
    }
    const intent = actionIntent(node);
    if (!intent) { na(`openui.action.${node.id}`, `No canonical action probe is defined for this ${node.type} node.`); continue; }
    await check(`openui.action.${node.id}`, () => {
      const memory = new Map<string, string>();
      const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
      const dispatched = dispatchSharedUiAction(storage, document, intent, AT);
      assert(dispatched.result.status === 'completed' || dispatched.result.status === 'accepted', `Canonical action returned ${dispatched.result.status}.`);
      const replayed = dispatchSharedUiAction(storage, document, intent, AT);
      assert(replayed.replayed && replayed.journal.receipts.length === dispatched.journal.receipts.length, 'Replaying the same canonical submission was not idempotent.');
      actionResults.push({ document_id: document.id, node_id: node.id, type: intent.type, action: dispatched.action, receipt: dispatched.receipt, replayed: true });
      return `${intent.type} dispatched and replayed idempotently in isolated memory. This is not browser or learner-outcome evidence.`;
    });
  }
  return {
    id: input.case.id, delivery, contract_passed: checks.every(result => result.status !== 'fail'),
    checks, openui: { surfaces, documents, actions: actionResults },
    teaching_quality: null,
    scoring_note: 'Delivery, output contracts, and teaching quality are separate. No prose matching, question-count heuristic, or inferred learner-outcome score is applied.',
  };
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw Error('Usage: bun benchmark_check.ts INPUT.json OUTPUT.json');
  const input = await Bun.file(source).json();
  if (Array.isArray(input)) await Bun.write(destination, JSON.stringify(await Promise.all(input.map(checkBenchmark)), null, 2));
  else if (Array.isArray(input.cases)) await Bun.write(destination, JSON.stringify({ results: await Promise.all(input.cases.map(checkBenchmark)) }, null, 2));
  else await Bun.write(destination, JSON.stringify(await checkBenchmark(input), null, 2));
}
