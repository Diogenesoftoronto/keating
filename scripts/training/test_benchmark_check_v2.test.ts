import { expect, test } from 'bun:test';
import { checkBenchmarkV2, type BenchmarkCheckV2Input } from './benchmark_check_v2';
import { stepBenchmarkTools, type AssistantResponse } from './benchmark_tool_step';

const baseCase = { id: 'v2-test', episode: { max_assistant_turns: 3 }, expect: { visible_response: true, allowed_tools: [] as string[] } };
function native(name: string, args: Record<string, unknown>, id = 'call-1'): AssistantResponse {
  return { content: '', tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] };
}
function surface(program: string, retention = 'ephemeral') {
  return `Try this at your pace.\n\n\`\`\`openui id=test-surface lifecycle=${retention}\nroot = LearningSurface([activity], "A short activity", "", "${retention}")\nactivity = ${program}\n\`\`\`\n\nI will wait for your response.`;
}
function questions(choiceCount = 2, explanation = true) {
  return surface(`Question(${JSON.stringify([
    { question: 'Predict what happens.', type: 'choice', choices: Array.from({ length: choiceCount }, (_, index) => `Option ${index + 1}`), allowText: false },
    ...(explanation ? [{ question: 'Explain your prediction.', type: 'text' }] : []),
  ])}, "ephemeral", "Prediction")`);
}
function failed(result: Awaited<ReturnType<typeof checkBenchmarkV2>>) { return result.checks.filter(check => check.status === 'fail'); }

test('two choices plus a separate explanation are checked through compiled canonical nodes', async () => {
  const fixture: BenchmarkCheckV2Input['case'] = { ...baseCase,
    expect: { ...baseCase.expect, openui: { components: [{ type: 'question', count: 2 }], exercise_actions: true } },
    expect_v2: { components: [{ type: 'question', node_count: 1 }], questions: { count: 2, choice_question_count: 1, text_question_count: 1, choices_per_question: 2 } },
  };
  const valid = await checkBenchmarkV2({ case: fixture, response: questions() });
  expect(failed(valid)).toEqual([]);
  expect(valid.openui.actions).toHaveLength(1);
  expect(valid.teaching_quality).toBeNull();
  for (const content of [questions(3), questions(2, false)]) expect((await checkBenchmarkV2({ case: fixture, response: content })).contract_passed).toBe(false);
});

test('valid final response after real feedback succeeds, while a native-only endpoint stays incomplete', async () => {
  const fixture = { ...baseCase, expect: { ...baseCase.expect, allowed_tools: ['feedback'] } };
  const call = native('feedback', { signal: 'confused', topic: 'Closures' });
  const result = await checkBenchmarkV2({ case: fixture, turns: [call, { content: 'Here is a concrete counter example.' }] });
  expect(failed(result)).toEqual([]);
  expect(result.delivery.status).toBe('pass');
  expect(result.episode.tool_execution[0]?.status).toBe('ok');
  expect(result.episode.state?.tables.feedback?.[0]?.signal).toBe('confused');
  const incomplete = await checkBenchmarkV2({ case: fixture, turns: [call] });
  expect(incomplete.delivery.status).toBe('fail');
  expect(failed(incomplete).some(check => check.name === 'episode.follow_through')).toBe(true);
});

test('forbidden calls and malformed early OpenUI cannot disappear behind a valid final answer', async () => {
  const forbidden = await checkBenchmarkV2({ case: baseCase, turns: [native('feedback', { signal: 'up' }), { content: 'A useful final response.' }] });
  expect(failed(forbidden).some(check => check.name.startsWith('turn.1.tools'))).toBe(true);
  const invalid = await checkBenchmarkV2({ case: baseCase, turns: [{ content: '```openui\nroot = Unknown([])\n```' }, { content: 'A useful final response.' }] });
  expect(failed(invalid).some(check => check.name === 'turn.1.openui.compile')).toBe(true);
  const excessive = await checkBenchmarkV2({ case: baseCase, turns: Array.from({ length: 4 }, () => ({ content: 'A response.' })) });
  expect(failed(excessive).some(check => check.name === 'episode.turn_limit')).toBe(true);
});

test('tool errors are honest, have no external execution, and leave no invented success', async () => {
  for (const [name, args] of [['feedback', { signal: 'joyful' }], ['web_search', { query: 'external' }]] as const) {
    const result = await stepBenchmarkTools({ case: { ...baseCase, expect: { allowed_tools: [name] } }, turns: [native(name, args)] });
    expect(result.execution[0]?.status).toBe('error');
    expect(result.execution[0]?.effects).toHaveLength(0);
    expect(JSON.parse(result.tool_messages[0]!.content).ok).toBe(false);
  }
  const noCatalog = await stepBenchmarkTools({ case: { ...baseCase, expect: { allowed_tools: ['feedback'] } }, tools: [], turns: [native('feedback', { signal: 'up' })] });
  expect(noCatalog.execution[0]?.status).toBe('error');
});

test('real memory normalization is used, and explicit no-memory instructions block writes', async () => {
  const fixture = { ...baseCase, expect: { allowed_tools: ['remember_learner_profile'], visible_response: true } };
  const call = native('remember_learner_profile', { category: 'learning-preference', value: '  Concrete examples  ', source: 'observed', confidence: 1, evidence: 'They repeatedly ask for examples.' });
  const normal = await stepBenchmarkTools({ case: fixture, turns: [call] });
  expect(normal.state.learner.profileBeliefs[0]?.confidence).toBe(.65);
  expect(normal.state.learner.profileBeliefs[0]?.value).toBe('Concrete examples');
  const blocked = await checkBenchmarkV2({ case: { ...fixture, expect_v2: { memory: { forbidden: true } } }, turns: [call, { content: 'Here is an example.' }] });
  expect(failed(blocked).some(check => check.name === 'memory.forbidden')).toBe(true);
  expect(blocked.episode.state?.learner.profileBeliefs).toHaveLength(0);
});

test('quiz verdicts use fixed pending IDs, persist real partial credit, and still need follow-through', async () => {
  const fixture: BenchmarkCheckV2Input['case'] = { ...baseCase,
    expect: { visible_response: true, allowed_tools: ['grade_quiz'], required_tools: [{ name: 'grade_quiz', identifiers: { result_id: 'result-42' }, question_ids: ['open-a', 'open-b'] }] },
    expect_v2: { grading: [{ tool: 'grade_quiz', verdicts: { 'open-a': 'partial', 'open-b': 'correct' } }] },
  };
  const args = { result_id: 'result-42', grades: [{ question_id: 'open-a', verdict: 'partial' }, { question_id: 'open-b', verdict: 'correct' }] };
  const valid = await checkBenchmarkV2({ case: fixture, turns: [native('grade_quiz', args), { content: 'Your first explanation identifies the cause but omits the consequence.' }] });
  expect(failed(valid)).toEqual([]);
  expect(valid.episode.state?.tables['quiz-results']?.[0]?.pendingGradeQuestionIds).toEqual([]);
  expect(valid.episode.state?.tables['quiz-results']?.[0]?.openEndedGrades[0].verdict).toBe('partial');
  for (const changed of [{ ...args, result_id: 'wrong-result' }, { ...args, grades: [args.grades[0], args.grades[0]] }, { ...args, grades: args.grades.map(grade => ({ ...grade, verdict: 'correct' })) }]) {
    expect((await checkBenchmarkV2({ case: fixture, turns: [native('grade_quiz', changed), { content: 'Feedback.' }] })).contract_passed).toBe(false);
  }
});

test('diagnostic grading excludes preference rows and updates actual pending records', async () => {
  const fixture: BenchmarkCheckV2Input['case'] = { ...baseCase,
    expect: { visible_response: true, allowed_tools: ['grade_question_checks'], required_tools: [{ name: 'grade_question_checks', identifiers: { topic: 'Momentum' }, questions: ['What changes during a collision?'] }] },
    expect_v2: { grading: [{ tool: 'grade_question_checks', verdicts: { 'What changes during a collision?': 'partial' } }] },
  };
  const valid = await checkBenchmarkV2({ case: fixture, turns: [native('grade_question_checks', { topic: 'Momentum', results: [{ question: 'What changes during a collision?', verdict: 'partial' }] }), { content: 'You identified velocity; now distinguish the object from the whole system.' }] });
  expect(failed(valid)).toEqual([]);
  expect(valid.episode.state?.tables['question-checks']?.[0]?.score).toBe(.5);
  const invalid = await checkBenchmarkV2({ case: fixture, turns: [native('grade_question_checks', { topic: 'Momentum', results: [{ question: 'Do you prefer diagrams?', verdict: 'incorrect' }] }), { content: 'Feedback.' }] });
  expect(invalid.contract_passed).toBe(false);
});

test('tool replay is isolated and stable, including generated goal identifiers', async () => {
  const fixture = { ...baseCase, expect: { allowed_tools: ['set_learner_goal', 'update_goal_step'] } };
  const first = native('set_learner_goal', { title: 'Build a rain gauge', steps: [{ title: 'Calibrate it', kind: 'practice' }] });
  const initial = await stepBenchmarkTools({ case: fixture, turns: [first] });
  const goal = initial.state.tables.goals![0]!;
  const next = native('update_goal_step', { goal_id: goal.id, step_id: goal.steps[0].id, status: 'done' }, 'call-2');
  const replay = await stepBenchmarkTools({ case: fixture, turns: [first, next] });
  expect(replay.execution.every(row => row.status === 'ok')).toBe(true);
  expect(replay.tool_messages).toHaveLength(1);
  expect(replay.state.tables.goals![0]!.steps[0].status).toBe('done');
  const repeated = await stepBenchmarkTools({ case: fixture, turns: [first] });
  expect(repeated.state).toEqual(initial.state);
  const duplicate = await stepBenchmarkTools({ case: fixture, turns: [first, first] });
  expect(duplicate.execution[1]?.status).toBe('error');
  expect(duplicate.execution[1]?.effects).toHaveLength(0);
});

test('existing goal feedback preserves the authored title and step instead of inventing state', async () => {
  const fixture = { id: 'existing-goal', expect: { allowed_tools: ['update_goal_step'], required_tools: [{ name: 'update_goal_step', identifiers: { goal_id: 'actual-goal', step_id: 'keyboard-step', status: 'in_progress' } }] },
    episode: { max_assistant_turns: 3, tool_fixtures: { goals: [{ id: 'actual-goal', title: 'Recipe page', steps: [{ id: 'keyboard-step', title: 'Test keyboard navigation' }] }] } } };
  const result = await stepBenchmarkTools({ case: fixture, turns: [native('update_goal_step', { goal_id: 'actual-goal', step_id: 'keyboard-step', status: 'in_progress' })] });
  expect(result.execution[0]?.status).toBe('ok');
  expect(result.tool_messages[0]?.content).toContain('Recipe page');
  expect(result.tool_messages[0]?.content).toContain('Test keyboard navigation');
  expect(result.state.tables.goals![0]!.steps[0].status).toBe('in_progress');
});

test('length checks accept arbitrary alternative wording without claiming pedagogical quality', async () => {
  const fixture = { ...baseCase, expect_v2: { visible_text: { max_words: 6, max_characters: 50 } } };
  for (const response of ['Compare these two examples.', 'I do not understand this topic.']) {
    const result = await checkBenchmarkV2({ case: fixture, response });
    expect(failed(result)).toEqual([]); expect(result.teaching_quality).toBeNull();
  }
  expect((await checkBenchmarkV2({ case: fixture, response: 'This response has far too many words for the explicitly stated limit.' })).contract_passed).toBe(false);
});

test('finite but scientifically wrong readouts fail fixed numerical probes', async () => {
  const fixture: BenchmarkCheckV2Input['case'] = { ...baseCase,
    expect: { ...baseCase.expect, openui: { components: [{ type: 'simulation' }], exercise_actions: true } },
    expect_v2: { simulation: { readouts: [{ id: 'distance', probes: [{ values: { speed: 3, time: 4 }, expected: 12 }, { values: { speed: 0, time: 4 }, expected: 0 }] }] } },
  };
  const program = (expr: string) => surface(`Simulation("motion", "Distance", [{id:"speed",label:"Speed",min:0,max:10,value:3},{id:"time",label:"Time",min:0,max:10,value:4}], [{id:"distance",label:"Distance",expr:${JSON.stringify(expr)}}], "ephemeral", "Compare distance at two speeds.")`);
  expect(failed(await checkBenchmarkV2({ case: fixture, response: program('speed * time') }))).toEqual([]);
  const wrong = await checkBenchmarkV2({ case: fixture, response: program('speed + time') });
  expect(wrong.checks.find(check => check.name === 'openui.simulation.activity')?.status).not.toBe('fail');
  expect(failed(wrong).some(check => check.name === 'simulation.readout.distance')).toBe(true);
});

test('quiz kind mix, exact choice counts, and answer-key presence stay separate contracts', async () => {
  const fixture: BenchmarkCheckV2Input['case'] = { ...baseCase,
    expect: { ...baseCase.expect, openui: { components: [{ type: 'quiz', count: 2 }] } },
    expect_v2: { quiz: { question_kinds: { multiple_choice: 1, short_answer: 1 }, choices_per_question_by_kind: { multiple_choice: 2 }, all_answer_keys: true, answer_keys: { 'activity-q1': 'activity-q1-choice-2' } } },
  };
  const program = (choices: string[], answer = '4') => surface(`Quiz("test-quiz", "Numbers", ${JSON.stringify([{ id: 'q1', type: 'multiple_choice', question: 'What is two plus two?', options: choices, correctAnswer: answer }, { id: 'q2', type: 'short_answer', question: 'Explain one way to check.', correctAnswer: 'Count two pairs.' }])}, "resumable")`, 'resumable');
  expect(failed(await checkBenchmarkV2({ case: fixture, response: program(['3', '4']) }))).toEqual([]);
  for (const response of [program(['2', '3', '4']), program(['3', '4'], '3')]) expect((await checkBenchmarkV2({ case: fixture, response })).contract_passed).toBe(false);
});
