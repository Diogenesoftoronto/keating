/** Benchmark-only, public source material. Never pass an original source record here. */
import { createHash } from 'node:crypto';
import { validateUiDocument, type UiDocument } from '../../src/tui/learner-contracts.js';
import { nativeSurfaceInstruction, type NativeSurface } from './native_surface.js';

export const NATIVE_SOURCE_COMMAND = 'keating-benchmark-v3-source-document';
export const NATIVE_SOURCE_MESSAGE = 'keating-benchmark-source-document-v1';
const MAX_ENVELOPE_BYTES = 196_608;
export interface NativeSourceDelivery { document: UiDocument; opening_message: string; surface: NativeSurface }

/** Allowlist only the bounded choice/text subset, including when forbidden fields are empty. */
export function validateNativeSourceDocument(value: unknown): asserts value is UiDocument {
  try {
    if (!validateUiDocument(value) || value.revision !== 0 || value.lifecycle !== 'ready'
      || !value.supportedSurfaces.includes('terminal') || !value.nodes.length || value.nodes.length > 16
      || Buffer.byteLength(JSON.stringify(value), 'utf8') > 65_536
      || value.nodes.some(node => node.type !== 'question' || !['choice', 'text'].includes(node.kind ?? '')
        || Object.keys(node).some(key => !['type', 'id', 'kind', 'prompt', 'header', 'choices', 'allowText'].includes(key))
        || (node.allowText !== undefined && (node.kind !== 'choice' || node.allowText !== false))
        || (node.kind === 'choice' ? !node.choices?.length : node.choices !== undefined))) throw new Error();
  } catch { throw new Error('native_invalid_source_document'); }
}

export function validateNativeSourceDelivery(value: NativeSourceDelivery): void {
  validateNativeSourceDocument(value?.document);
  nativeSurfaceInstruction(value.surface);
  if (typeof value.opening_message !== 'string' || !value.opening_message.trim()
    || value.opening_message.length > 65_536 || /^\s*[!/]/.test(value.opening_message)) throw new Error('harness_invalid_learner_message');
}

export function nativeSourceMessage(value: NativeSourceDelivery) {
  validateNativeSourceDelivery(value);
  const { document, opening_message, surface } = value;
  const publicText = [document.title, document.description, ...document.nodes.flatMap(node => node.type === 'question'
    ? [node.header, node.prompt, ...(node.choices ?? []).map(choice => `(${choice.id}) ${choice.label}`)] : [])]
    .filter((text): text is string => typeof text === 'string' && !!text).join('\n');
  const fingerprint = createHash('sha256').update(JSON.stringify({ document, opening_message, surface })).digest('hex');
  return { customType: NATIVE_SOURCE_MESSAGE, display: true,
    content: `Learner opening:\n${opening_message}\n\nSource activity:\n${publicText}`,
    details: { origin: 'environment' as const, fingerprint, document, opening_message, surface } };
}

/** Read only an actual Pi custom message; never reinterpret assistant text as a source event. */
export function deliveredNativeSource(value: unknown): ReturnType<typeof nativeSourceMessage> | undefined {
  const message = value as { role?: string; customType?: string; content?: unknown; details?: NativeSourceDelivery & { fingerprint?: string; origin?: string } } | null;
  if (message?.role !== 'custom' || message.customType !== NATIVE_SOURCE_MESSAGE || !message.details) return undefined;
  try {
    const expected = nativeSourceMessage(message.details);
    return message.details.origin === 'environment' && message.details.fingerprint === expected.details.fingerprint
      && message.content === expected.content ? expected : undefined;
  } catch { return undefined; }
}

export function encodeNativeSourceDelivery(value: NativeSourceDelivery): string {
  validateNativeSourceDelivery(value);
  const raw = Buffer.from(JSON.stringify(value), 'utf8');
  if (raw.byteLength > MAX_ENVELOPE_BYTES) throw new Error('harness_source_document_too_large');
  return raw.toString('base64url');
}

export function decodeNativeSourceDelivery(encoded: string): NativeSourceDelivery {
  if (!encoded || encoded.length > Math.ceil(MAX_ENVELOPE_BYTES * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error('harness_invalid_source_document_envelope');
  const raw = Buffer.from(encoded, 'base64url');
  if (raw.byteLength > MAX_ENVELOPE_BYTES) throw new Error('harness_source_document_too_large');
  const value = JSON.parse(raw.toString('utf8')) as NativeSourceDelivery;
  validateNativeSourceDelivery(value);
  return value;
}
