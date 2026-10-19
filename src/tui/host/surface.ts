/**
 * `HostSurface` for the OpenTUI host: the contract `HostController` drives.
 * Each method updates shared `HostState` and asks the view to repaint; nothing
 * here touches a widget directly.
 */
import type { HostSurface } from "../host-controller.js";
import type { TuiDialogs } from "./dialogs.js";
import type { HostState } from "./state.js";
import type { HostView } from "./view.js";

export interface HostSurfaceDeps {
  state: HostState;
  view: HostView;
  dialogs: Pick<TuiDialogs, "presentSelect" | "presentTextInput">;
}

export function createHostSurface(deps: HostSurfaceDeps): HostSurface {
  const { state, view, dialogs } = deps;
  const { presentSelect, presentTextInput } = dialogs;
  return {
    hydrateEntries(next) { state.entries.splice(0, state.entries.length, ...next); view.renderTranscript(); },
    appendEntry: view.appendEntry,
    setStreaming(entry) {
      state.streaming = entry;
      if (entry) {
        state.activityPhase = "responding";
        state.activityDetail = undefined;
      }
      view.renderTranscript();
      view.paintIndicator();
    },
    setStatus(text) { view.status.content = text; },
    setHeaderState(next) {
      state.headerState = { ...state.headerState, ...next };
      const wasBusy = state.busy;
      state.busy = state.headerState.busy;
      if (state.busy && !wasBusy) {
        state.busyStartedAt = Date.now();
        state.activityPhase = "thinking";
        state.activityDetail = undefined;
        state.spinnerFrame = 0;
      } else if (!state.busy) {
        state.busyStartedAt = null;
        state.activityDetail = undefined;
      }
      view.refreshSidebarIdentity();
      view.renderHeader();
      view.renderTranscript();
      view.status.content = state.busy
        ? "Keating is thinking…  ·  Enter queues a follow-up  ·  Ctrl+X stops  ·  Ctrl+U document actions"
        : view.idleStatus();
      view.paintIndicator();
    },
    setEditorText(text) { view.composer.value = text; },
    setWidget(key, lines, placement) {
      if (lines?.length) view.appendEntry({
        id: `widget-${key}-${Date.now()}`,
        kind: "artifact",
        title: key,
        body: lines.join("\n"),
        detail: placement,
      });
    },
    setTitle(title) { state.headerLabel = title || "KEATING"; view.renderHeader(); },
    setUiDocument(document, controls) {
      state.activeUiDocument = document;
      state.activeUiControls = [...controls];
      if (!state.busy) view.status.content = document
        ? `Document ready: ${document.title || document.id}. Ctrl+U opens ${state.activeUiControls.length} action${state.activeUiControls.length === 1 ? "" : "s"}.`
        : view.idleStatus();
    },
    presentSelect,
    presentConfirm(title, message) { return presentSelect(title, ["Yes", "No"], { message }).then((value) => value === undefined ? undefined : value === "Yes"); },
    presentInput(title, placeholder) { return presentTextInput(title, undefined, placeholder); },
    presentEditor(title, prefill) { return presentTextInput(title, prefill, "Edit response…"); },
  };
}
