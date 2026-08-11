export interface TuiPromptClient {
  prompt(message: string): Promise<unknown>;
  followUp(message: string): Promise<unknown>;
}

export type TuiPromptSendOutcome =
  | { ok: true; message: string }
  | { ok: false; message: string; error: unknown }
  | { ok: false; message: null; error: null };

/** Keeps the exact learner draft available until one send is accepted. */
export class TuiPromptRecovery {
  private failedDraft: string | null = null;
  private failedMessage: string | null = null;
  private activeDraft: string | null = null;
  private activeMessage: string | null = null;

  constructor(private readonly client: TuiPromptClient) {}

  get draft(): string | null {
    return this.failedDraft;
  }

  get pendingDraft(): string | null {
    return this.activeDraft;
  }

  async send(draft: string, busy: boolean, message = draft): Promise<TuiPromptSendOutcome> {
    this.activeDraft = draft;
    this.activeMessage = message;
    this.failedDraft = null;
    this.failedMessage = null;
    try {
      if (busy) await this.client.followUp(message);
      else await this.client.prompt(message);
      return { ok: true, message: draft };
    } catch (error) {
      this.activeDraft = null;
      this.activeMessage = null;
      this.failedDraft = draft;
      this.failedMessage = message;
      return { ok: false, message: draft, error };
    }
  }

  /** Commit an accepted send only after Pi reports a successful agent end. */
  completePending(): string | null {
    const draft = this.activeDraft;
    this.activeDraft = null;
    this.activeMessage = null;
    this.failedDraft = null;
    this.failedMessage = null;
    return draft;
  }

  /** Restore the exact accepted draft after an asynchronous provider failure or abort. */
  failPending(): string | null {
    const draft = this.activeDraft;
    if (draft === null) return null;
    this.failedDraft = draft;
    this.failedMessage = this.activeMessage ?? draft;
    this.activeDraft = null;
    this.activeMessage = null;
    return draft;
  }

  async retry(busy: boolean): Promise<TuiPromptSendOutcome> {
    const message = this.failedDraft;
    if (message === null) return { ok: false, message: null, error: null };
    return this.send(message, busy, this.failedMessage ?? message);
  }
}
