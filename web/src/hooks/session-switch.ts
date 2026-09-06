/** Requests are issued at the click, before an asynchronous target read starts. */
export class SessionSwitchRequests {
  private latest = 0;
  begin(): number { return ++this.latest; }
  get current(): number { return this.latest; }
  isCurrent(request: number): boolean { return request === this.latest; }
  async read<T>(request: number, read: () => Promise<T>): Promise<T | undefined> {
    if (!this.isCurrent(request)) return undefined;
    try {
      const value = await read();
      return this.isCurrent(request) ? value : undefined;
    } catch (error) {
      if (this.isCurrent(request)) throw error;
      return undefined;
    }
  }
}

/** Prepare the next runtime while saving the old one, then commit only the latest request. */
export async function runSessionSwitch<T>(options: {
  isCurrent: () => boolean;
  prepare: () => Promise<T>;
  persist: () => Promise<void>;
  needsFinalSave?: () => boolean;
  commit: (prepared: T) => Promise<void>;
}): Promise<boolean> {
  if (!options.isCurrent()) return false;
  try {
    const [prepared] = await Promise.all([options.prepare(), options.persist()]);
    if (!options.isCurrent()) return false;
    // A learner can edit or begin a turn while runtime preparation is pending.
    // Recheck at the commit boundary; unchanged history needs no extra write.
    while (options.needsFinalSave?.()) {
      await options.persist();
      if (!options.isCurrent()) return false;
    }
    await options.commit(prepared);
    return options.isCurrent();
  } catch (error) {
    if (options.isCurrent()) throw error;
    return false;
  }
}

/** Writes to the same session stay ordered; independent sessions do not block. */
export class SessionSaveQueue {
  private readonly pending = new Map<string, Promise<void>>();
  run(id: string, write: () => Promise<void>): Promise<void> {
    const result = (this.pending.get(id) ?? Promise.resolve()).catch(() => {}).then(write);
    this.pending.set(id, result);
    void result.finally(() => { if (this.pending.get(id) === result) this.pending.delete(id); }).catch(() => {});
    return result;
  }
}

interface SnapshotState {
  messages: readonly unknown[];
  model: unknown;
  thinkingLevel: unknown;
  streamingMessage?: unknown;
  isStreaming?: boolean;
}
interface SnapshotStamp extends SnapshotState {
  revision: number;
  messageCount: number;
}

/** Agent events catch in-place changes; identities catch direct state replacement. */
export class SessionSnapshotTracker {
  private readonly revisions = new WeakMap<object, number>();
  private readonly saved = new WeakMap<object, SnapshotStamp>();
  changed(agent: object): void { this.revisions.set(agent, (this.revisions.get(agent) ?? 0) + 1); }
  capture(agent: object, state: SnapshotState): SnapshotStamp {
    return { messages: state.messages, model: state.model, thinkingLevel: state.thinkingLevel, streamingMessage: state.streamingMessage, messageCount: state.messages.length, revision: this.revisions.get(agent) ?? 0 };
  }
  remember(agent: object, stamp: SnapshotStamp): void { this.saved.set(agent, stamp); }
  needsSave(agent: object, state: SnapshotState): boolean {
    return Boolean(state.isStreaming || (state.messages.length > 0 && !this.isSaved(agent, this.capture(agent, state))));
  }
  isSaved(agent: object, stamp: SnapshotStamp): boolean {
    const previous = this.saved.get(agent);
    return Boolean(previous && previous.revision === stamp.revision && previous.messages === stamp.messages && previous.messageCount === stamp.messageCount && previous.model === stamp.model && previous.thinkingLevel === stamp.thinkingLevel && previous.streamingMessage === stamp.streamingMessage);
  }
}
