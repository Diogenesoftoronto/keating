/**
 * In-memory answers for interactive cards.
 *
 * Cards live inside the chat FlatList, which unmounts rows that scroll far off
 * screen. Keeping submitted answers here — keyed by message id and position —
 * means a card the learner already completed comes back completed rather than
 * blank. The submitted answers are also echoed into the transcript as a user
 * turn, so nothing durable is lost when the app restarts.
 */
const store = new Map<string, unknown>();

export function cardKey(messageId: string, index: number): string {
  return `${messageId}:${index}`;
}

export function readCardState<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function writeCardState(key: string, value: unknown): void {
  store.set(key, value);
}

/** Drops every remembered answer; used when local learning data is cleared. */
export function clearCardState(): void {
  store.clear();
}
