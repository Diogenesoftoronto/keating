/**
 * Provider connection and model selection: the interactive login flow
 * (method choice, OAuth/device prompts, session refresh) and the two-step model picker.
 */
import { ProviderLoginCancelledError, type ProviderLoginMethod, interactiveProviderChoices, loginProvider } from "../../../runtime/provider-login.js";
import { modelChoices, modelPickerTitle, modelProviderChoices } from "../../model-picker.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { busySurfaceNotice, refreshKnownPiCommands, restoreIdleStatus } from "./common.js";

export type ProviderDeps = Pick<HostContext, "client" | "controller" | "cwd" | "dialogs" | "openExternalUrl" | "state" | "view">;

export async function showProviderLogin(deps: ProviderDeps): Promise<boolean> {
  const { cwd, client, controller, state, dialogs, openExternalUrl } = deps;
  const { appendEntry, idleStatus, status } = deps.view;
  const { presentSelect, presentTextInput } = dialogs;
  if (busySurfaceNotice(deps, "Provider connection")) return false;
  const providers = interactiveProviderChoices();
  const providerLabels = providers.map((provider) => `${provider.name} (${provider.id}) · ${provider.modelCount} models`);
  const selected = await presentSelect("Connect or repair a provider", providerLabels, {
    descriptions: new Map(providers.map((provider, index) => [
      providerLabels[index]!,
      provider.methods.map((method) => provider.methodLabels[method]).filter(Boolean).join(" or "),
    ])),
    showDescription: true,
  });
  if (selected === undefined) return false;
  const provider = providers[providerLabels.indexOf(selected)];
  if (!provider) return false;

  let method: ProviderLoginMethod | undefined = provider.methods[0];
  if (provider.methods.length > 1) {
    const methodLabels = provider.methods.map((candidate) => provider.methodLabels[candidate] ?? candidate);
    const selectedMethod = await presentSelect(`Connect ${provider.name}`, methodLabels, { initialFocus: "list" });
    if (selectedMethod === undefined) return false;
    method = provider.methods[methodLabels.indexOf(selectedMethod)];
  }
  if (!method) return false;

  const loginAbort = new AbortController();
  state.activeProviderLoginAbort = loginAbort;
  status.content = `Connecting ${provider.name}…  ·  Ctrl+X cancels`;
  try {
    await loginProvider(cwd, provider.id, method, {
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const labels = prompt.options.map((option) => option.description
            ? `${option.label} · ${option.description}`
            : option.label);
          const value = await presentSelect(prompt.message, labels, {
            initialFocus: "list",
            signal: prompt.signal,
          });
          return value === undefined ? undefined : prompt.options[labels.indexOf(value)]?.id;
        }
        return presentTextInput(prompt.message, undefined, prompt.placeholder, {
          secret: prompt.type === "secret",
          signal: prompt.signal,
          preserveOnCancel: false,
        });
      },
      notify: (event) => {
        if (event.type === "progress") {
          status.content = `${event.message}  ·  Ctrl+X cancels`;
          return;
        }
        if (event.type === "auth_url") {
          appendEntry({
            id: `provider-auth-url-${Date.now()}`,
            kind: "notice",
            title: `Authorize ${provider.name}`,
            body: `${event.instructions ?? "Complete sign-in in your browser."}\n\n${event.url}`,
          });
          try { openExternalUrl(event.url); } catch {}
          return;
        }
        appendEntry({
          id: `provider-device-code-${Date.now()}`,
          kind: "notice",
          title: `${provider.name} device login`,
          body: `Open ${event.verificationUri}\n\nEnter this one-time code: ${event.userCode}`,
        });
        try { openExternalUrl(event.verificationUri); } catch {}
      },
    }, { signal: loginAbort.signal });

    status.content = `Refreshing ${provider.name} models in this session…`;
    await client.restart({
      sessionPath: controller.getCurrentSessionPath(),
      env: { KEATING_AUTH_MISSING_PROVIDER: "" },
    });
    await controller.initialize();
    await refreshKnownPiCommands(deps);
    const modelCount = (await client.getAvailableModels()).filter((model) => model.provider === provider.id).length;
    appendEntry({
      id: `provider-connected-${Date.now()}`,
      kind: "notice",
      title: `${provider.name} connected`,
      body: `${modelCount} authenticated model${modelCount === 1 ? "" : "s"} available. The current OpenTUI session was preserved and refreshed.`,
    });
    return true;
  } catch (error) {
    if (error instanceof ProviderLoginCancelledError || loginAbort.signal.aborted) {
      status.content = `${provider.name} connection cancelled. No credential was changed.`;
      return false;
    }
    appendEntry({
      id: `provider-login-error-${Date.now()}`,
      kind: "error",
      title: `${provider.name} connection failed`,
      body: `${sanitizeDiagnostic(error)}\n\nNo successful-looking fallback was applied. Retry from the model picker or settings.`,
    });
    return false;
  } finally {
    if (state.activeProviderLoginAbort === loginAbort) state.activeProviderLoginAbort = null;
    if (!state.busy && !dialogs.isOpen() && !state.activeProviderLoginAbort) status.content = idleStatus();
  }
}

export async function showModelPicker(deps: ProviderDeps): Promise<void> {
  const { client, controller, state, dialogs } = deps;
  const { appendEntry, status } = deps.view;
  const { presentSelect } = dialogs;
  if (busySurfaceNotice(deps, "Model selection")) return;
  status.content = "Loading authenticated models…";
  try {
    const models = await client.getAvailableModels();
    if (models.length === 0) {
      appendEntry({
        id: `models-empty-${Date.now()}`,
        kind: "notice",
        title: "No authenticated models",
        body: "No provider credentials are configured yet. Connect one here without leaving OpenTUI.",
      });
      if (await showProviderLogin(deps)) await showModelPicker(deps);
      return;
    }
    const current = models.find((model) => `${model.provider}/${model.id}` === state.headerState.model);
    const providers = modelProviderChoices(models, current?.provider);
    const connectProvider = "+ Connect or repair a provider";
    const providerLabels = [...providers.map((provider) => provider.label), connectProvider];
    const selectedProvider = await presentSelect(modelPickerTitle(models), providerLabels, {
      descriptions: new Map(providers.map((provider) => [provider.label, provider.description])),
      showDescription: true,
      initialFocus: "list",
    });
    if (selectedProvider === undefined) return;
    if (selectedProvider === connectProvider) {
      if (await showProviderLogin(deps)) await showModelPicker(deps);
      return;
    }
    const provider = providers.find((candidate) => candidate.label === selectedProvider);
    if (!provider) return;
    const choices = modelChoices(models.filter((model) => model.provider === provider.provider), current);
    const selected = await presentSelect(`Model · ${provider.provider}`, choices.map((choice) => choice.label), {
      descriptions: new Map(choices.map((choice) => [choice.label, choice.description])),
      showDescription: false,
    });
    if (selected === undefined) return;
    const choice = choices.find((candidate) => candidate.label === selected);
    if (!choice) return;
    await controller.setModel(choice.model.provider, choice.model.id);
  } catch (error) {
    appendEntry({
      id: `models-error-${Date.now()}`,
      kind: "error",
      title: "Model picker unavailable",
      body: `${sanitizeDiagnostic(error)}\n\nNo model was changed. Connect or repair a provider in /settings, then retry.`,
    });
  } finally {
    restoreIdleStatus(deps);
  }
}
