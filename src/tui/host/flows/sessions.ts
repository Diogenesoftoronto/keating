/**
 * Browse, resume, rename and fork saved project sessions.
 */
import { SESSION_ACTIONS, forkMessageOption, sessionOption, tuiSessionItems } from "../../session-browser.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { restoreIdleStatus } from "./common.js";

export type SessionsDeps = Pick<HostContext, "controller" | "cwd" | "dialogs" | "listSessions" | "sidebar" | "state" | "view">;

export async function showSessions(deps: SessionsDeps): Promise<void> {
  const { cwd, controller, state, dialogs, sidebar, listSessions } = deps;
  const { appendEntry, status } = deps.view;
  const { presentSelect, presentTextInput } = dialogs;
  if (state.busy) {
    appendEntry({
      id: `sessions-busy-${Date.now()}`,
      kind: "notice",
      title: "Sessions unavailable while responding",
      body: "Stop the active response with Ctrl+X, then open Sessions again. Your conversation remains saved.",
    });
    return;
  }
  status.content = "Loading project sessions…";
  try {
    const items = tuiSessionItems(await listSessions(cwd), controller.getCurrentSessionPath());
    if (items.length === 0) {
      appendEntry({
        id: `sessions-empty-${Date.now()}`,
        kind: "notice",
        title: "No saved sessions",
        body: "This project has no persisted Pi sessions yet. Send a prompt to create one.",
      });
      return;
    }
    const sessionOptions = items.map((item, index) => sessionOption(item, index));
    const selected = await presentSelect("Sessions · active and fork lineage are labelled", sessionOptions);
    if (selected === undefined) return;
    const item = items[sessionOptions.indexOf(selected)];
    if (!item) return;

    const action = await presentSelect(
      `${item.title}${item.parentSessionPath ? " · forked session" : " · original session"}`,
      [...SESSION_ACTIONS],
    );
    if (action === undefined || action === "Cancel") return;
    if (action === "Resume session") {
      await controller.resumeSession(item.path);
      await sidebar.refreshSessions();
      return;
    }
    if (action === "Resume and rename") {
      if (!await controller.resumeSession(item.path)) return;
      const name = await presentTextInput("Rename active session", item.name || item.title, "Session name…");
      if (name !== undefined) await controller.renameCurrentSession(name);
      await sidebar.refreshSessions();
      return;
    }
    if (action === "Fork whole current branch") {
      if (await controller.resumeSession(item.path)) await controller.cloneCurrentSession();
      await sidebar.refreshSessions();
      return;
    }
    if (action === "Fork from an earlier turn") {
      if (!await controller.resumeSession(item.path)) return;
      const messages = await controller.forkMessages();
      if (messages.length === 0) {
        appendEntry({
          id: `fork-empty-${Date.now()}`,
          kind: "notice",
          title: "No forkable turns",
          body: "This session does not yet contain an earlier learner turn that Pi can fork.",
        });
        return;
      }
      const messageOptions = messages.map(forkMessageOption);
      const selectedMessage = await presentSelect("Fork from earlier turn · original remains saved", messageOptions);
      if (selectedMessage === undefined) return;
      const message = messages[messageOptions.indexOf(selectedMessage)];
      if (message) {
        await controller.forkFromMessage(message.entryId);
        await sidebar.refreshSessions();
      }
    }
  } catch (error) {
    appendEntry({
      id: `sessions-error-${Date.now()}`,
      kind: "error",
      title: "Could not load sessions",
      body: `${sanitizeDiagnostic(error)}\n\nThe active session and composer were not changed. Retry or use /shell.`,
    });
  } finally {
    restoreIdleStatus(deps);
  }
}
