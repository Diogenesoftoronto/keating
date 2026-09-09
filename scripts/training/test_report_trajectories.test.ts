import { expect, test } from "bun:test";
import { memoryChanges, memoryFacts, messageText } from "../../web/public/reports/learning-to-teach/benchmark-trajectories.js";
import data from "../../web/public/reports/learning-to-teach/benchmark-v3-results.json";

test("recorded preference correction replaces the old observation and survives a new session", () => {
  const steps = data.models.find(model => model.id === 'kimi-k3')!.rows.find(row => row.case_id === 'profile-life-notation-revision')!.trace!.steps;
  const before = memoryFacts(steps[2]), after = memoryFacts(steps[3]);
  const changes = memoryChanges(before, after)!;
  const replaced = changes.find(change => change.state === 'Replaced')!;
  const replacement = changes.find(change => change.fact.supersedesId === replaced.fact.id)!;
  expect(replacement.state).toBe('Added');
  expect(replacement.fact.source).toBe('explicit');
  expect(replacement.fact.evidence).toContain('unfamiliar notation');
  const fresh = steps.find(step => step.kind === 'new_session')!;
  expect(memoryFacts(fresh)).toContainEqual(replacement.fact);
  expect(messageText(fresh, 'assistant')).toBe('');
});

test("failed writes do not become saved facts and malformed snapshots stay unknown", () => {
  const steps = data.models.find(model => model.id === 'inkling-small-base')!.rows.find(row => row.case_id === 'profile-life-notation-revision')!.trace!.steps;
  expect(steps.some(step => step.messages.some(message => message.role === 'toolResult' && message.is_error))).toBe(true);
  expect(memoryFacts(steps.at(-1))).toEqual([]);
  expect(memoryFacts({ learner_memory: ['invalid JSON'] })).toBeNull();
  expect(memoryChanges([], null)).toBeNull();
});

test("walkthrough prose excludes tool arguments and tool output", () => {
  expect(messageText({ messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'A question' }, { type: 'toolCall', name: 'read', arguments: { text: 'not prose' } }] },
    { role: 'toolResult', content: [{ type: 'text', text: 'not a tutor reply' }] },
  ] }, 'assistant')).toBe('A question');
});
