import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { nativeSurfaceInstruction, nativeSurfaceSystemPrompt } from './native_surface.js';

// App-local equivalents of the reviewed projection checks: actual source policy
// plus authored runtime contexts. No research artifacts or learner histories.
const policy = await readFile(new URL('../../SYSTEM.md', import.meta.url), 'utf8');
const heading = '## OpenUI interaction contract\n';
const mandate = 'Author learner-facing interactions and artifacts as OpenUI.';
const closing = 'Supported nodes are `markdown`, `callout`, `question`, `question-group`, `quiz`, `goal`, `deck`, `study-plan`, `artifact`, `concept-map`, `notes`, `image`, `media`, and `handoff`. Use ordinary Markdown only for prose that does not benefit from a component.\n';
const runtimeContext = (id: number) => `\n\n<available_skills>\n<skill>authored-adaptive-teaching-${id}</skill>\n</available_skills>\nCurrent working directory: /tmp/synthetic-projection-${id}\n<keating-learner-context>\n${JSON.stringify({ synthetic: true, learnerStatedBackground: `Current session correction ${id}; prior report remains historical.` })}\n</keating-learner-context>\n`;

for (let id = 1; id <= 12; id++) {
  for (const dated of [false, true]) {
    test(`chat projection preserves complete runtime context ${id}, date footer ${dated}`, () => {
      const source = policy + runtimeContext(id) + (dated ? '\nCurrent date: 2030-01-01\nKeep this footer.\n' : '');
      const start = source.indexOf(heading);
      const end = source.indexOf(closing, start) + closing.length;
      const suffix = source.slice(end);
      expect(start).toBeGreaterThan(0);
      expect(suffix).toContain('<available_skills>');
      expect(suffix).toContain('<keating-learner-context>');
      const expected = (source.slice(0, start) + '## Chat interaction contract\n\n' +
        'Ask focused questions in ordinary text and wait for the learner. This surface has no interactive documents.\n' + suffix)
        .replace(mandate, 'Author learner-facing interactions as ordinary text on this chat surface.') + '\n\n' + nativeSurfaceInstruction('chat');
      const projected = nativeSurfaceSystemPrompt(source, 'chat');
      expect(projected).toBe(expected);
      expect(projected.slice(projected.indexOf(suffix))).toBe(suffix + '\n\n' + nativeSurfaceInstruction('chat'));
      expect(nativeSurfaceSystemPrompt(source, 'interactive')).toBe(source + '\n\n' + nativeSurfaceInstruction('interactive'));
    });
  }
}

const reference = policy + runtimeContext(1);
const malformed: Record<string, string> = {
  missing_heading: reference.replace(heading, '## Renamed section\n'),
  duplicate_heading: reference + '\n' + heading,
  missing_closing: reference.replace(closing, ''),
  duplicate_closing: reference + closing,
  closing_before_heading: closing + reference,
  missing_mandate: reference.replace(mandate, ''),
  duplicate_mandate: reference + mandate,
  mandate_after_heading: reference.replace(mandate, '') + mandate,
  nested_section: reference.replace(heading, heading + '\n## Unexpected policy section\n'),
  changed_closing: reference.replace(closing, closing.replace('component.', 'component!')),
};
for (const [name, input] of Object.entries(malformed)) {
  test(`ambiguous or changed projection boundary fails closed: ${name}`, () => {
    expect(() => nativeSurfaceSystemPrompt(input, 'chat')).toThrow('native_chat_policy_projection_drift');
  });
}

test('legacy date footer and following context remain byte-identical', () => {
  const footer = '\nCurrent date: 2026-10-24\nKeep this context unchanged.';
  expect(nativeSurfaceSystemPrompt(reference + footer, 'chat')).toContain(footer);
});
