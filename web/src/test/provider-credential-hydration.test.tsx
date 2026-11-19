import * as kit from "../design-system/kit";
import { expect, spyOn, test } from "bun:test";
import { ProviderCredentialForm } from "../components/settings/CloudProviderKeysSection";
import * as storage from "../keating/app-storage";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";
import * as verification from "../lib/provider-key-test";
import { MemoryStorage } from "./helpers/memory-storage";
import { mountRoomUi, settle, textOf } from "./helpers/room-ui-mount";

test("a late saved key cannot erase a paste or delete an untouched credential", async () => {
  const olderRead = Promise.withResolvers<string | null>();
  const keys = new storage.ProviderKeysStore();
  const get = spyOn(keys, "get").mockImplementation(id => id === "minimax" ? olderRead.promise : Promise.resolve("already-saved"));
  const save = spyOn(keys, "set").mockResolvedValue(undefined);
  const remove = spyOn(keys, "delete").mockResolvedValue(undefined);
  const store = new storage.AppStorage(new storage.SettingsStore(), keys, new storage.SessionsStore(), new storage.CustomProvidersStore(),
    new IndexedDBStorageBackend({ dbName: "local-key-test", version: 1, stores: [] }));
  const app = spyOn(storage, "getAppStorage").mockReturnValue(store);
  const verify = spyOn(verification, "testProviderKey").mockResolvedValue({ status: "unsupported", detail: "Offline test" });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  // This host has no native dialog. Exercise the form against the confirmation contract.
  const confirmation = spyOn(kit,"ConfirmDialog").mockImplementation(props => props.open ? <div role="alertdialog"><button onClick={props.onCancel}>Cancel</button><button onClick={props.onConfirm}>{props.confirmLabel}</button></div> : <></>);
  const view = mountRoomUi();
  const input = () => view.all("input")[0]!.props;
  const change = async (value: string) => { input().onChange({ target: { value } }); await settle(); };
  const blur = async () => { input().onBlur?.({ target: { value: input().value } }); await settle(); };
  try {
    await view.render(<ProviderCredentialForm provider="minimax" />);
    expect(get).toHaveBeenCalledWith("minimax");
    await blur();
    expect(remove).not.toHaveBeenCalled();
    await change("newly-pasted");
    olderRead.resolve(null);
    await settle();
    expect(input().value).toBe("newly-pasted");
    await blur();
    expect(save).not.toHaveBeenCalled();
    await view.button("Save key").props.onClick(); await settle();
    expect(save).toHaveBeenCalledWith("minimax", "newly-pasted");

    await view.render(<ProviderCredentialForm provider="xai" />);
    expect(input().value).toBe("already-saved");
    await change("");
    await blur();
    expect(remove).not.toHaveBeenCalled();
    const trigger = view.button("Remove key");
    trigger.props.onClick(); await settle();
    expect(remove).not.toHaveBeenCalled();
    view.button("Cancel").props.onClick(); await settle();
    expect(remove).not.toHaveBeenCalled();
    trigger.props.onClick(); await settle();
    view.all("button").filter(b=>textOf(b)==="Remove key").at(-1)!.props.onClick(); await settle();
    expect(remove.mock.calls).toEqual([["xai"]]);

    const checking = Promise.withResolvers<void>();
    const response = Promise.withResolvers<void>();
    verify.mockImplementationOnce(async () => { checking.resolve(); await response.promise; return { status: "ok" }; });
    await change("superseded");
    await checking.promise;
    await change("replacement");
    await view.button("Save key").props.onClick();
    response.resolve();
    await settle();
    expect(save.mock.calls).toEqual([["minimax", "newly-pasted"], ["xai", "replacement"]]);
  } finally {
    await view.unmount();
    confirmation.mockRestore();
    app.mockRestore();
    verify.mockRestore();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
