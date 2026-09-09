import { expect, test } from 'bun:test';
import { checkBenchmark, type BenchmarkExpectation } from './benchmark_check';

const catalog = await Bun.file(new URL('./data/openui-conversations.json', import.meta.url)).json();
function activity(component: string): string {
  for (const conversation of catalog.conversations) {
    const message = conversation.messages.find((entry: {role: string; content?: string}) => entry.role === 'assistant' && entry.content?.includes(`= ${component}(`));
    if (message) return message.content;
  }
  throw Error(`No authored ${component} fixture.`);
}
function native(name: string, args: Record<string, unknown>, content = '') {
  return { content, tool_calls: [{ id: 'benchmark-call', function: { name, arguments: JSON.stringify(args) } }] };
}
function row(expectation: BenchmarkExpectation, response: Parameters<typeof checkBenchmark>[0]['response']) {
  return { case: { id: 'benchmark-test', expect: expectation }, response };
}
function failures(result: Awaited<ReturnType<typeof checkBenchmark>>) { return result.checks.filter(check => check.status === 'fail'); }

test('delivery does not pretend to measure the quality of flexible prose', async () => {
  for (const content of ['An example first: divide one pizza into four equal pieces.', 'Let us compare two approaches. Explain which assumption changes the result.', 'This is an unrelated and pedagogically poor reply.']) {
    const result = await checkBenchmark(row({ visible_response: true }, content));
    expect(result.delivery.status).toBe('pass');
    expect(result.contract_passed).toBe(true);
    expect(result.teaching_quality).toBeNull();
  }
  const empty = await checkBenchmark(row({ visible_response: true }, ''));
  expect(empty.delivery.status).toBe('fail');
  expect(empty.contract_passed).toBe(true); // No claim that a contract-only aggregate measures responsiveness.
});

test('valid OpenUI tolerates alternate prose and every requested activity executes offline', async () => {
  for (const [component, type, count, retention, mode] of [
    ['Question', 'question', 1, undefined, undefined],
    ['Quiz', 'quiz', 4, 'resumable', 'quiz'],
    ['Exam', 'quiz', 20, 'resumable', 'exam'],
    ['Flashcards', 'deck', 4, 'resumable', undefined],
    ['Simulation', 'simulation', undefined, undefined, undefined],
    ['SharedNotes', 'notes', undefined, undefined, undefined],
  ] as const) {
    const result = await checkBenchmark(row({ openui: { components: [{ type, count, mode }], retention, exercise_actions: true } }, `Try this activity at your pace.\n\n${activity(component)}\n\nI will wait for your response.`));
    expect(failures(result)).toEqual([]);
    expect(result.delivery.status).toBe('pass');
    expect(result.openui.documents).toHaveLength(1);
    expect(result.openui.surfaces.every(surface => surface.compiled)).toBe(true);
    if (type !== 'simulation') {
      expect(result.openui.actions.length).toBeGreaterThan(0);
      expect(result.openui.actions.every(action => action.replayed === true)).toBe(true);
    }
    expect(result.teaching_quality).toBeNull();
  }
});

test('broken or merely promised OpenUI fails without rewriting the response', async () => {
  const expectation = { openui: { components: [{ type: 'quiz', count: 4 }] } };
  for (const response of ['I have made your quiz.', '<openui-quiz id="invented" questions="[]" />', '```openui\nroot = MissingComponent([])\n```', '```openui\nroot = LearningSurface([])', '```openui-json\n{"invalid":true}\n```', '```openui-json\nnot JSON\n```']) {
    const result = await checkBenchmark(row(expectation, response));
    expect(result.delivery.status).toBe('pass');
    expect(result.contract_passed).toBe(false);
    expect(result.checks.some(check => check.name === 'openui.compile' && check.status === 'fail')).toBe(true);
  }
});

test('a valid small practice quiz cannot stand in for an exam or wrong item count', async () => {
  for (const component of [{ type: 'quiz', mode: 'exam', count: 20 }, { type: 'quiz', mode: 'quiz', count: 7 }]) {
    const result = await checkBenchmark(row({ openui: { components: [component] } }, activity('Quiz')));
    expect(result.contract_passed).toBe(false);
    expect(failures(result).some(check => check.name.startsWith('openui.component'))).toBe(true);
  }
  const retained = await checkBenchmark(row({ openui: { components: [{ type: 'quiz' }], retention: 'workspace' } }, activity('Quiz')));
  expect(failures(retained).some(check => check.name === 'openui.retention')).toBe(true);
});

test('quiz grading uses only exact pending IDs once and does not enforce a single semantic verdict', async () => {
  const expectation: BenchmarkExpectation = {
    visible_response: false, allowed_tools: ['grade_quiz'],
    required_tools: [{ name: 'grade_quiz', identifiers: { result_id: 'submitted-result-42' }, question_ids: ['pending-a', 'pending-b'] }],
  };
  const grades = [{ question_id: 'pending-a', verdict: 'partial', note: 'A meaningful alternative explanation.' }, { question_id: 'pending-b', verdict: 'correct' }];
  const valid = await checkBenchmark(row(expectation, native('grade_quiz', { result_id: 'submitted-result-42', grades })));
  expect(failures(valid)).toEqual([]);
  expect(valid.delivery.status).toBe('pass');
  for (const args of [
    { result_id: 'invented-result', grades },
    { result_id: 'submitted-result-42', grades: [grades[0], grades[0]] },
    { result_id: 'submitted-result-42', grades: [...grades, { question_id: 'already-auto-graded', verdict: 'correct' }] },
    { result_id: 'submitted-result-42', grades: [{ question_id: 'pending-a' }, grades[1]] },
  ]) expect((await checkBenchmark(row(expectation, native('grade_quiz', args)))).contract_passed).toBe(false);
});

test('diagnostic grading really updates the distinct pending fixture records', async () => {
  const expectation: BenchmarkExpectation = {
    visible_response: false, allowed_tools: ['grade_question_checks'],
    required_tools: [{ name: 'grade_question_checks', identifiers: { topic: 'Cache invalidation' }, questions: ['Why can a hit be stale?', 'What changes on a write?'] }],
  };
  const results = [{ question: 'Why can a hit be stale?', verdict: 'partial' }, { question: 'What changes on a write?', verdict: 'correct' }];
  const valid = await checkBenchmark(row(expectation, native('grade_question_checks', { topic: 'Cache invalidation', results })));
  expect(failures(valid)).toEqual([]);
  expect(valid.checks.find(check => check.name === 'tools.execution.0')?.evidence).toContain('2 storage mutation');
  for (const args of [
    { topic: 'Unrelated topic', results },
    { topic: 'Cache invalidation', results: [results[0], results[0]] },
    { topic: 'Cache invalidation', results: [{ question: 'Unsubmitted question', verdict: 'correct' }, results[1]] },
  ]) expect((await checkBenchmark(row(expectation, native('grade_question_checks', args)))).contract_passed).toBe(false);
});

test('real feedback and memory schemas reject malformed arguments without exact prose targets', async () => {
  const feedback: BenchmarkExpectation = { visible_response: false, required_tools: [{ name: 'feedback', identifiers: { signal: 'confused', topic: 'Electric circuits' } }] };
  expect((await checkBenchmark(row(feedback, native('feedback', { signal: 'confused', topic: 'Electric circuits' })))).contract_passed).toBe(true);
  expect((await checkBenchmark(row(feedback, native('feedback', { signal: 'joyful', topic: 'Electric circuits' })))).contract_passed).toBe(false);
  const memory: BenchmarkExpectation = { visible_response: false, required_tools: [{ name: 'remember_learner_profile', identifiers: { source: 'explicit' } }] };
  for (const value of ['Use cooking examples before introducing notation.', 'Prefers examples from cooking, then equations.']) {
    const result = await checkBenchmark(row(memory, native('remember_learner_profile', { category: 'learning-preference', source: 'explicit', value, evidence: 'Please explain with cooking examples first.' })));
    expect(failures(result)).toEqual([]);
  }
  expect((await checkBenchmark(row(memory, native('remember_learner_profile', { category: 'learning-preference', source: 'explicit', value: 'Missing evidence' })))).contract_passed).toBe(false);
});

test('goal tools use real schema and fixture IDs while exact authored curriculum wording is unrestricted', async () => {
  const create: BenchmarkExpectation = { visible_response: false, required_tools: [{ name: 'set_learner_goal' }] };
  expect((await checkBenchmark(row(create, native('set_learner_goal', { title: 'Build a home energy budget', steps: [{ title: 'Measure usage', kind: 'practice' }] })))).contract_passed).toBe(true);
  const update: BenchmarkExpectation = { visible_response: false, required_tools: [{ name: 'update_goal_step', identifiers: { goal_id: 'actual-goal-1', step_id: 'actual-step-2', status: 'done' } }] };
  const valid = await checkBenchmark(row(update, native('update_goal_step', { goal_id: 'actual-goal-1', step_id: 'actual-step-2', status: 'done' })));
  expect(failures(valid)).toEqual([]);
  expect((await checkBenchmark(row(update, native('update_goal_step', { goal_id: 'invented-goal', step_id: 'actual-step-2', status: 'done' })))).contract_passed).toBe(false);
});

test('required call announcements, duplicate calls, and unnecessary legacy creation calls fail', async () => {
  const expectation: BenchmarkExpectation = { visible_response: false, required_tools: [{ name: 'feedback' }] };
  expect((await checkBenchmark(row(expectation, 'Recorded your feedback.'))).contract_passed).toBe(false);
  const call = native('feedback', { signal: 'up' });
  call.tool_calls.push(call.tool_calls[0]!);
  expect((await checkBenchmark(row(expectation, call))).contract_passed).toBe(false);
  expect((await checkBenchmark(row({ visible_response: true }, native('quiz', { topic: 'Fractions', questions: [] }, 'Quiz ready.')))).contract_passed).toBe(false);
});

test('the frozen exposed tool list is authoritative and provider errors remain delivery failures', async () => {
  const result = await checkBenchmark({ ...row({ required_tools: [{ name: 'feedback' }] }, native('feedback', { signal: 'up' })), tools: [] });
  expect(result.contract_passed).toBe(false);
  expect(failures(result).some(check => check.evidence.includes('not exposed'))).toBe(true);
  expect((await checkBenchmark(row({}, { content: 'Partial output', error: 'Provider timeout' }))).delivery.status).toBe('fail');
});
