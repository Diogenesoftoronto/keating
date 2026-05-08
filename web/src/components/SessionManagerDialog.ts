import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogContent, DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { i18n } from "@mariozechner/mini-lit";
import { getAppStorage, type SessionMetadata } from "@mariozechner/pi-web-ui";
import { html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { formatUsage } from "@mariozechner/pi-web-ui";

export interface SessionManagerDialogOpenOptions {
  onLoad: (sessionId: string) => void | Promise<void>;
  onDeleted?: (sessionId: string) => void | Promise<void>;
  onRenamed?: (sessionId: string, title: string) => void | Promise<void>;
}

export class SessionManagerDialog extends DialogBase {
  @state() private sessions: SessionMetadata[] = [];
  @state() private loading = true;
  @state() private errorMessage = "";
  @state() private editingSessionId: string | null = null;
  @state() private pendingDeleteSessionId: string | null = null;
  @state() private busySessionId: string | null = null;

  private options?: SessionManagerDialogOpenOptions;
  private renameDraft = "";

  protected modalWidth = "min(760px, 92vw)";
  protected modalHeight = "min(720px, 90vh)";

  static async open(options: SessionManagerDialogOpenOptions) {
    const dialog = new SessionManagerDialog();
    dialog.options = options;
    dialog.open();
    await dialog.loadSessions();
  }

  private async loadSessions() {
    this.loading = true;
    this.errorMessage = "";

    try {
      const storage = getAppStorage();
      if (!storage?.sessions) {
        throw new Error("Session storage is unavailable");
      }
      this.sessions = await storage.sessions.getAllMetadata();
    } catch (error) {
      console.error("Failed to load sessions:", error);
      this.sessions = [];
      this.errorMessage = error instanceof Error ? error.message : "Failed to load sessions";
    } finally {
      this.loading = false;
    }
  }

  private formatDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return i18n("Today");
    if (days === 1) return i18n("Yesterday");
    if (days < 7) return i18n("{days} days ago").replace("{days}", days.toString());
    return date.toLocaleDateString();
  }

  private beginRename(session: SessionMetadata) {
    this.pendingDeleteSessionId = null;
    this.editingSessionId = session.id;
    this.renameDraft = session.title;
    this.errorMessage = "";
  }

  private cancelRename() {
    this.editingSessionId = null;
    this.renameDraft = "";
  }

  private async saveRename(session: SessionMetadata) {
    const nextTitle = this.renameDraft.trim();
    const currentTitle = session.title.trim();

    if (!nextTitle) {
      this.errorMessage = "Session title cannot be empty";
      return;
    }

    if (nextTitle === currentTitle) {
      this.cancelRename();
      return;
    }

    this.busySessionId = session.id;
    this.errorMessage = "";

    try {
      const storage = getAppStorage();
      if (!storage?.sessions) {
        throw new Error("Session storage is unavailable");
      }

      await storage.sessions.updateTitle(session.id, nextTitle);
      await this.loadSessions();
      this.cancelRename();
      await Promise.resolve(this.options?.onRenamed?.(session.id, nextTitle));
    } catch (error) {
      console.error("Failed to rename session:", error);
      this.errorMessage = error instanceof Error ? error.message : "Failed to rename session";
    } finally {
      this.busySessionId = null;
    }
  }

  private requestDelete(sessionId: string) {
    this.editingSessionId = null;
    this.pendingDeleteSessionId = sessionId;
    this.errorMessage = "";
  }

  private cancelDelete() {
    this.pendingDeleteSessionId = null;
  }

  private async confirmDelete(session: SessionMetadata) {
    this.busySessionId = session.id;
    this.errorMessage = "";

    try {
      const storage = getAppStorage();
      if (!storage?.sessions) {
        throw new Error("Session storage is unavailable");
      }

      await storage.sessions.deleteSession(session.id);
      this.pendingDeleteSessionId = null;
      await this.loadSessions();
      await Promise.resolve(this.options?.onDeleted?.(session.id));
    } catch (error) {
      console.error("Failed to delete session:", error);
      this.errorMessage = error instanceof Error ? error.message : "Failed to delete session";
    } finally {
      this.busySessionId = null;
    }
  }

  private handleLoad(sessionId: string) {
    void Promise.resolve(this.options?.onLoad(sessionId)).catch((error) => {
      console.error("Failed to load session:", error);
    });
    this.close();
  }

  private renderRenameEditor(session: SessionMetadata): TemplateResult {
    const inputId = `session-title-${session.id}`;
    return html`
      <div class="mt-3 rounded-md border border-border bg-background/50 p-3">
        <label class="sr-only" for=${inputId}>Session title</label>
        <input
          id=${inputId}
          class="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
          .value=${this.renameDraft}
          ?disabled=${this.busySessionId === session.id}
          autocomplete="off"
          aria-label="Session title"
          @input=${(event: Event) => {
            this.renameDraft = (event.target as HTMLInputElement).value;
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void this.saveRename(session);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              this.cancelRename();
            }
          }}
        />
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          ${Button({
            variant: "ghost",
            size: "sm",
            type: "button",
            disabled: this.busySessionId === session.id,
            onClick: () => this.cancelRename(),
            children: i18n("Cancel"),
          })}
          ${Button({
            variant: "default",
            size: "sm",
            type: "button",
            disabled: this.busySessionId === session.id || !this.renameDraft.trim() || this.renameDraft.trim() === session.title.trim(),
            onClick: () => {
              void this.saveRename(session);
            },
            children: i18n("Save"),
          })}
        </div>
      </div>
    `;
  }

  private renderDeleteConfirmation(session: SessionMetadata): TemplateResult {
    return html`
      <div class="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <p class="text-sm text-foreground">${i18n("Delete this session?")}</p>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          ${Button({
            variant: "ghost",
            size: "sm",
            type: "button",
            disabled: this.busySessionId === session.id,
            onClick: () => this.cancelDelete(),
            children: i18n("Cancel"),
          })}
          ${Button({
            variant: "destructive",
            size: "sm",
            type: "button",
            disabled: this.busySessionId === session.id,
            onClick: () => {
              void this.confirmDelete(session);
            },
            children: i18n("Delete"),
          })}
        </div>
      </div>
    `;
  }

  protected override renderContent(): TemplateResult {
    return html`
      ${DialogContent({
        className: "flex h-full flex-col overflow-hidden",
        children: html`
          ${DialogHeader({
            title: i18n("Sessions"),
            description: "Load, rename, or delete a previous conversation",
          })}

          ${this.errorMessage
            ? html`
                <div
                  class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  role="status"
                  aria-live="polite"
                >
                  ${this.errorMessage}
                </div>
              `
            : nothing}

          <div class="flex-1 overflow-y-auto pr-1">
            ${this.loading
              ? html`<div class="py-8 text-center text-sm text-muted-foreground">${i18n("Loading...")}</div>`
              : this.sessions.length === 0
                ? html`<div class="py-8 text-center text-sm text-muted-foreground">${i18n("No sessions yet")}</div>`
                : html`
                    <ul class="space-y-2" aria-label="Saved sessions">
                      ${this.sessions.map((session) => {
                        const isBusy = this.busySessionId === session.id;
                        const isRenaming = this.editingSessionId === session.id;
                        const isDeleting = this.pendingDeleteSessionId === session.id;
                        return html`
                          <li class="rounded-lg border border-border bg-background p-3">
                            <div class="flex items-start justify-between gap-3">
                              <div class="min-w-0 flex-1">
                                <h3 class="truncate text-sm font-medium text-foreground">${session.title}</h3>
                                <p class="mt-1 text-xs text-muted-foreground">
                                  ${this.formatDate(session.lastModified)} | ${session.messageCount} ${i18n("messages")} | ${formatUsage(session.usage)}
                                </p>
                              </div>

                              <div class="flex shrink-0 flex-wrap justify-end gap-2">
                                ${Button({
                                  variant: "secondary",
                                  size: "sm",
                                  type: "button",
                                  disabled: isBusy,
                                  onClick: () => this.handleLoad(session.id),
                                  children: "Load",
                                })}
                                ${Button({
                                  variant: "ghost",
                                  size: "sm",
                                  type: "button",
                                  disabled: isBusy,
                                  onClick: () => this.beginRename(session),
                                  children: "Rename",
                                })}
                                ${Button({
                                  variant: "ghost",
                                  size: "sm",
                                  type: "button",
                                  disabled: isBusy,
                                  onClick: () => this.requestDelete(session.id),
                                  children: "Delete",
                                })}
                              </div>
                            </div>

                            ${isRenaming ? this.renderRenameEditor(session) : nothing}
                            ${isDeleting ? this.renderDeleteConfirmation(session) : nothing}
                          </li>
                        `;
                      })}
                    </ul>
                  `}
          </div>
        `,
      })}
    `;
  }
}

if (!customElements.get("keating-session-manager-dialog")) {
  customElements.define("keating-session-manager-dialog", SessionManagerDialog);
}
