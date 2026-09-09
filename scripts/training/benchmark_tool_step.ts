/** Bounded real tool handlers over an isolated, deterministic storage adapter. */
import { createAssessmentTools } from '../../web/src/keating/browser-tools/assessment';
import { createTeachingTools } from '../../web/src/keating/browser-tools/teaching';
import { createTool } from '../../web/src/keating/browser-tools/shared';
import { KeatingStorage, type LearnerState } from '../../web/src/keating/storage';
import { buildGoal, type LearnerGoal } from '../../web/src/keating/goals';
import type { BenchmarkCheckInput } from './benchmark_check';

export type AssistantResponse = Exclude<BenchmarkCheckInput['response'], string>;
type GoalFixture = { id: string; title: string; steps: Array<{ id: string; title: string; kind?: LearnerGoal['steps'][number]['kind']; status?: LearnerGoal['steps'][number]['status'] }> };
export interface ToolStepCase extends BenchmarkCheckInput['case'] {
  episode?: { max_assistant_turns?: number; tool_fixtures?: { goals?: GoalFixture[] } };
  expect_v2?: { memory?: { forbidden?: boolean }; [key: string]: unknown };
}
export interface ToolStepInput {
  case: ToolStepCase;
  turns: AssistantResponse[];
  tools?: BenchmarkCheckInput['tools'];
}
type RecordData = Record<string, any>;
const AT = Date.parse('2026-09-07T12:00:00.000Z');
const SAFE = new Set(['feedback', 'remember_learner_profile', 'grade_question_checks', 'grade_quiz', 'set_learner_goal', 'update_goal_step', 'list_learner_goals', 'learner_state']);
function assert(value: unknown, text: string): asserts value { if (!value) throw Error(text); }
function clone<T>(value: T): T { return structuredClone(value); }

/** The real storage domain methods remain in use; only persistence and clocks/IDs are adapted. */
function isolatedStorage(fixture: ToolStepCase) {
  const storage = new KeatingStorage('benchmark-v2-never-opened');
  const internal = storage as unknown as RecordData;
  const tables = new Map<string, Map<string, RecordData>>();
  const effects: Array<{ store: string; id: string }> = [];
  let sequence = 0;
  const nextId = () => `${fixture.id}-isolated-${++sequence}`;
  let learner: LearnerState = internal.defaultLearnerState();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  internal.init = async () => { throw Error('Persistent storage is disabled in benchmark v2.'); };
  internal.getStore = internal.init;
  internal.generateId = nextId;
  internal.getAll = async (name: string) => clone([...table(name).values()]);
  internal.getByTopic = async (name: string, topic: string) => clone([...table(name).values()].filter(item => item.topic === topic));
  internal.put = async (name: string, value: RecordData) => {
    const record = clone(value);
    if ('createdAt' in record) record.createdAt = AT;
    if ('updatedAt' in record) record.updatedAt = AT;
    table(name).set(record.id, record); effects.push({ store: name, id: record.id });
    return record.id;
  };
  storage.getLearnerState = async () => clone(learner);
  internal.updateLearnerState = async (mutate: (state: LearnerState) => unknown) => {
    await mutate(learner);
    learner.lastSessionAt = learner.lastSessionAt ? AT : learner.lastSessionAt;
    learner.profileBeliefs.forEach(belief => { belief.createdAt = AT; belief.updatedAt = AT; });
    learner.feedbackHistory.forEach(entry => { entry.createdAt = AT; });
    effects.push({ store: 'learner-state', id: fixture.id });
    return clone(learner);
  };
  // Derived analytics are outside this bounded tool loop. Domain mutations above remain real.
  internal.refreshDerivedLearnerProfile = async () => clone(learner);
  const saveGoal = storage.saveGoal.bind(storage);
  storage.saveGoal = async (value: LearnerGoal) => {
    const goal = clone(value);
    if (!table('goals').has(goal.id)) {
      goal.id = nextId();
      goal.steps.forEach((step, index) => { step.id = `${goal.id}-step-${index + 1}`; });
      goal.createdAt = AT;
    }
    await saveGoal(goal);
    return clone(table('goals').get(goal.id)) as LearnerGoal;
  };
  for (const seed of fixture.episode?.tool_fixtures?.goals ?? []) {
    assert(seed.id && seed.title && seed.steps.length > 0 && new Set(seed.steps.map(step => step.id)).size === seed.steps.length, 'The authored goal fixture needs a title and distinct supplied step IDs.');
    const goal = buildGoal({ title: seed.title, steps: seed.steps.map(step => ({ title: step.title, kind: step.kind })) });
    goal.id = seed.id; goal.createdAt = AT; goal.updatedAt = AT;
    goal.steps.forEach((step, index) => {
      step.id = seed.steps[index]!.id;
      step.status = seed.steps[index]!.status ?? 'not_started';
    });
    table('goals').set(goal.id, goal);
  }
  for (const required of fixture.expect.required_tools ?? []) {
    if (required.name === 'grade_question_checks') {
      (required.questions ?? []).forEach((question, index) => {
        const id = `${fixture.id}-pending-${index}`;
        table('question-checks').set(id, { id, topic: required.identifiers?.topic, question, answer: 'Fixed submitted answer in conversation', grading: 'pending', createdAt: AT });
      });
    }
    if (required.name === 'grade_quiz' && typeof required.identifiers?.result_id === 'string') {
      const id = required.identifiers.result_id;
      table('quiz-results').set(id, { id, topic: fixture.id, score: 0, total: required.question_ids?.length ?? 0, completedAt: AT, pendingGradeQuestionIds: required.question_ids ?? [], openEndedGrades: [] });
    }
    if (required.name === 'update_goal_step' && typeof required.identifiers?.goal_id === 'string' && typeof required.identifiers?.step_id === 'string' && !table('goals').has(required.identifiers.goal_id)) {
      const goal = buildGoal({ title: 'Fixed learner goal', steps: [{ title: 'Current step', kind: 'practice' }] });
      goal.id = required.identifiers.goal_id; goal.steps[0]!.id = required.identifiers.step_id;
      goal.createdAt = AT; goal.updatedAt = AT;
      table('goals').set(goal.id, goal);
    }
  }
  return { storage, effects, snapshot: () => ({ learner: clone(learner), tables: Object.fromEntries([...tables].map(([name, rows]) => [name, clone([...rows.values()])])) }) };
}

export async function stepBenchmarkTools(input: ToolStepInput) {
  const limit = input.case.episode?.max_assistant_turns ?? 3;
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 3, 'The isolated loop permits one to three assistant turns.');
  assert(Array.isArray(input.turns) && input.turns.length >= 1 && input.turns.length <= limit, `Expected one to ${limit} assistant turns.`);
  const isolated = isolatedStorage(input.case);
  const registry = [...createAssessmentTools(isolated.storage, async () => []), ...createTeachingTools(isolated.storage)];
  const allowed = new Set(input.case.expect.allowed_tools ?? input.case.expect.required_tools?.map(tool => tool.name) ?? []);
  const seen = new Set<string>();
  const execution: Array<{ turn: number; index: number; call_id: string; name: string; status: 'ok' | 'error'; content: string; effects: Array<{ store: string; id: string }> }> = [];
  for (const [turnIndex, turn] of input.turns.entries()) {
    const calls = turn.tool_calls ?? [];
    assert(Array.isArray(calls) && calls.length <= 16, 'At most sixteen native calls may occur in one assistant turn.');
    for (const [index, call] of calls.entries()) {
      const name = call.function?.name ?? call.name ?? '';
      const id = call.id ?? `benchmark-${input.case.id}-turn-${turnIndex + 1}-call-${index + 1}`;
      const before = isolated.effects.length;
      let status: 'ok' | 'error' = 'ok', content = '';
      try {
        assert(!seen.has(id), 'Duplicate native call ID; the call was not executed again.'); seen.add(id);
        assert(!turn.error, 'Provider-error output cannot execute native calls.');
        assert(allowed.has(name), `${name || 'Unnamed tool'} is not permitted in this case.`);
        assert(!(input.case.expect_v2?.memory?.forbidden && name === 'remember_learner_profile'), 'Durable learner memory was explicitly forbidden in this case.');
        assert(SAFE.has(name), `${name} is unavailable in the isolated benchmark; external effects are disabled.`);
        const raw = call.function?.arguments ?? call.arguments;
        assert(typeof raw !== 'string' || raw.length <= 65536, 'Native arguments exceed the isolated-loop limit.');
        const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
        assert(args && typeof args === 'object' && !Array.isArray(args), 'Tool arguments must be a JSON object.');
        const tool = registry.find(item => item.name === name);
        assert(tool, `${name} has no connected real handler.`);
        const exposed = input.tools?.find(item => item.function.name === name)?.function.parameters;
        if (input.tools) assert(exposed, `${name} was not exposed in the frozen tool catalog.`);
        if (exposed) await createTool(name, 'Frozen schema validation', exposed.properties ?? {}, async () => 'Valid.', exposed.required ?? []).execute(id, args);
        if (name === 'grade_question_checks') {
          const pending = (await isolated.storage.getQuestionChecks(String(args.topic))).filter(row => row.grading === 'pending');
          const questions = Array.isArray(args.results) ? args.results.map((row: RecordData) => row?.question) : [];
          assert(questions.length > 0 && new Set(questions).size === questions.length && questions.every((question: unknown) => pending.some(row => row.question === question)), 'Grade only distinct, actually pending comprehension checks.');
        }
        if (name === 'grade_quiz') {
          const result = (await isolated.storage.getQuizResults()).find(row => row.id === args.result_id);
          const ids = Array.isArray(args.grades) ? args.grades.map((row: RecordData) => row?.question_id) : [];
          assert(result && ids.length > 0 && new Set(ids).size === ids.length && ids.every((id: string) => result.pendingGradeQuestionIds?.includes(id)), 'Grade only distinct pending question IDs from the actual submitted result.');
        }
        const result = await tool.execute(id, args);
        content = result.content.filter(item => item.type === 'text').map(item => (item as { text: string }).text).join('\n');
        if (name === 'grade_quiz') {
          // The real handler emits this card update; the app applies it with saveQuizGrades.
          const match = content.match(/<keating-quiz-grade\s+json=("(?:\\.|[^"\\])*")\s*\/>/);
          assert(match, 'The real quiz handler returned no parseable grade update.');
          const payload = JSON.parse(JSON.parse(match[1]!));
          assert(await isolated.storage.saveQuizGrades(payload.resultId, payload.grades), 'The real grade update did not match an isolated result.');
        }
      } catch (error) {
        status = 'error'; content = JSON.stringify({ ok: false, error: { code: 'isolated-tool-error', message: error instanceof Error ? error.message : String(error) }, scope: 'No external tools or persistence are available.' });
      }
      execution.push({ turn: turnIndex + 1, index, call_id: id, name, status, content, effects: isolated.effects.slice(before) });
    }
  }
  return {
    tool_messages: execution.filter(row => row.turn === input.turns.length).map(row => ({ role: 'tool' as const, tool_call_id: row.call_id, name: row.name, content: row.content })),
    execution, state: isolated.snapshot(),
    scope: 'Real teaching/assessment handlers and storage domain mutations in isolated memory. Derived learner analytics, browser persistence and external effects are not exercised.',
  };
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw Error('Usage: bun benchmark_tool_step.ts INPUT.json OUTPUT.json');
  const input = await Bun.file(source).json();
  await Bun.write(destination, JSON.stringify(await stepBenchmarkTools(input), null, 2));
}
