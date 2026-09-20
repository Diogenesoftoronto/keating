/** Explicit OpenAI-compatible simulator transport; not an unverified Persimmon SDK. */
import { createHash } from 'node:crypto';
import { nativeHash, type AdaptiveLearner, type LearnerObservation, type LearnerContext } from './native_learner.js';

export const LEARNER_PROMPT = `Continue the learner in the supplied initial_material: the person who asked for help and made the recorded attempt. You are speaking TO the tutor. Respond to what the tutor actually delivered with your own next attempt, uncertainty, correction, question, or decision to stop.
Do not switch roles: do not teach another student, prescribe what a student should do, grade the conversation, or write the tutor's next message. A brief first-person reply is usually enough. You may make progress or remain confused; do not force either success or failure.
initial_material is the shared task and prior source conversation. profile_evidence contains observations about your earlier work; assumptions are explicitly authored scenario hypotheses, not observed traits. Unknown traits stay unknown. Subsequent user messages contain the tutor's delivered observation; assistant messages are YOUR earlier learner intents. Continue your learner role. Use the actual question and available controls in observation, not a guessed activity. If an activity could not be presented, ask for a usable explanation or choose to stop; do not claim to have submitted it.
Return one JSON object: no Markdown fences, explanation outside the object, or additional fields. Use double-quoted JSON keys and strings. Keep message text to one to three short first-person sentences in plain text; use simple mathematical notation. Escape any quotation marks inside a JSON string.
Valid shapes, with illustrative content that you must replace with your own response:
{"kind":"message","text":"I think the pieces have different sizes. Can I try another step?"}
{"kind":"stop"}
{"kind":"reopen"}
{"kind":"new_session"}
{"kind":"ui_action","actionId":"listed-action-id","payload":{"answer":"My attempt"}}
{"kind":"ui_action","actionId":"listed-action-id","payload":{"optionIds":["listed-choice-id"]}}
{"kind":"ui_action","actionId":"listed-action-id","payload":{"value":"My note"}}
For ui_action, copy an actionId from the current observation.availableActions. If that list is empty, use a message for your answer or choose stop; do not invent a control. Use answer only for submit-answer, optionIds only for choose-option, or value only for update-notes. Copy choice IDs from that action's choices. The examples are formats, not actions available to you. Never produce scores, tool receipts or successful learning claims without observable evidence.`;

export interface JsonLearnerConfig {
  endpoint: string; api_key_env: string; model: string; revision: string;
  temperature?: number; max_tokens?: number;
  json_mode?: 'response_format' | 'prompt_only';
}

/** Retain actual speaker roles instead of embedding the full dialogue in one user message. */
export function learnerMessages(observation: LearnerObservation, context: LearnerContext) {
  if (typeof context.initial_material !== 'string' || !context.initial_material.trim()
    || !Array.isArray(context.history)) throw new Error('native_missing_learner_initial_material');
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: LEARNER_PROMPT },
  ];
  const initial = { initial_material: context.initial_material, profile_evidence: context.profile_evidence,
    assumptions: context.assumptions };
  for (const [index, turn] of context.history.entries()) {
    messages.push({ role: 'user', content: JSON.stringify({ observation: turn.observation,
      ...(index === 0 ? { context: initial } : {}) }) });
    messages.push({ role: 'assistant', content: JSON.stringify(turn.intent) });
  }
  messages.push({ role: 'user', content: JSON.stringify({ observation,
    ...(!context.history.length ? { context: initial } : {}),
    ...(context.repair ? { repair: { reason: context.repair,
      instruction: 'Return valid JSON for your own next learner intent. You are still the learner speaking to the tutor.' } } : {}) }) });
  return messages;
}
export class JsonChatLearner implements AdaptiveLearner {
  readonly provenance: AdaptiveLearner['provenance'];
  constructor(private readonly config: JsonLearnerConfig, private readonly request: typeof fetch = fetch) {
    const url = new URL(config.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !/^[A-Z][A-Z0-9_]*$/.test(config.api_key_env) || !config.model || !config.revision
      || (config.json_mode !== undefined && config.json_mode !== 'response_format' && config.json_mode !== 'prompt_only')
      || !Number.isFinite(config.temperature ?? 1) || (config.temperature ?? 1) < 0 || (config.temperature ?? 1) > 2
      || !Number.isInteger(config.max_tokens ?? 1024) || (config.max_tokens ?? 1024) < 1 || (config.max_tokens ?? 1024) > 4096) throw new Error('native_invalid_simulator_config');
    this.config = Object.freeze({ ...config });
    this.provenance = Object.freeze({ kind: 'model', model: config.model, revision: config.revision,
      prompt_sha256: createHash('sha256').update(LEARNER_PROMPT).digest('hex'), request_contract_sha256: nativeHash({
        version: 5, history_encoding: 'tutor-user-learner-assistant-v1', model: config.model, revision: config.revision,
        temperature: config.temperature ?? 1, max_tokens: config.max_tokens ?? 1024,
        json_mode: config.json_mode ?? 'response_format', prompt: LEARNER_PROMPT }) });
  }
  async next(observation: LearnerObservation, context: LearnerContext, signal: AbortSignal): Promise<unknown> {
    const key = process.env[this.config.api_key_env];
    if (!key) throw new Error('native_missing_simulator_key');
    const messages = learnerMessages(observation, context);
    const response = await this.request(this.config.endpoint, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: this.config.model, temperature: this.config.temperature ?? 1,
        max_tokens: this.config.max_tokens ?? 1024,
        // Prompt-only mode requests JSON in the same prompt without asking the
        // provider for constrained decoding or changing the sampling settings.
        ...(this.config.json_mode === 'prompt_only' ? {} : { response_format: { type: 'json_object' } }), messages }) });
    if (!response.ok) throw new Error(`native_simulator_http_${response.status}`);
    const body = await response.json() as any;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { invalid_output: 'missing_text_content' };
    if (content.length > 65_536) return { invalid_output: 'oversized_text_content', characters: content.length };
    // Invalid structured output belongs to the controller's recorded one-repair
    // path. HTTP/transport failures remain provider failures.
    try { return JSON.parse(content); } catch { return content; }
  }
}
