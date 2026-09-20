/** Versioned experimental affordances, separate from the shared teaching policy. */
export type NativeSurface = 'chat' | 'interactive';

export const NATIVE_SURFACE_INSTRUCTIONS: Readonly<Record<NativeSurface, string>> = {
  chat: 'Native research surface: chat. The learner can read your text and reply in text. Interactive documents and submission controls are unavailable. Present any question, hint, or explanation in ordinary text. Do not promise a visible card, button, or recorded submission. Use only the tools actually listed in this request; a tool result is not a learner response.',
  interactive: 'Native research surface: interactive terminal. The learner can read your text and supported canonical learner documents, and use the available controls. Plain text remains available. Use only the tools and canonical document schema supplied by the runtime. Do not claim that an activity was delivered, submitted, or assessed before its actual receipt. An unavailable activity needs a usable text explanation or repair.',
};

export function nativeSurfaceInstruction(surface: NativeSurface): string {
  if (surface !== 'chat' && surface !== 'interactive') throw new Error('native_invalid_surface');
  return NATIVE_SURFACE_INSTRUCTIONS[surface];
}

/** Project only the rendering contract for a declared chat experiment.
 * The unmodified source policy is still hashed by the harness. Fail on drift
 * instead of leaving contradictory interactive instructions in a chat arm.
 */
export function nativeSurfaceSystemPrompt(source: string, surface: NativeSurface): string {
  const instruction = nativeSurfaceInstruction(surface);
  if (surface === 'interactive') return `${source}\n\n${instruction}`;
  const mandate = 'Author learner-facing interactions and artifacts as OpenUI.';
  const heading = '## OpenUI interaction contract\n';
  const start = source.indexOf(heading);
  const end = source.indexOf('\nCurrent date:', start);
  if (start < 0 || end <= start || source.indexOf(heading, start + 1) !== -1
    || source.split(mandate).length !== 2) throw new Error('native_chat_policy_projection_drift');
  const projected = (source.slice(0, start) + '## Chat interaction contract\n\n'
    + 'Ask focused questions in ordinary text and wait for the learner. This surface has no interactive documents.\n'
    + source.slice(end)).replace(mandate, 'Author learner-facing interactions as ordinary text on this chat surface.');
  return `${projected}\n\n${instruction}`;
}
