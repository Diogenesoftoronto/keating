import { afterEach, describe, expect, test } from "bun:test";
import { showModelPicker, showProviderLogin } from "../src/tui/host/flows/provider.js";
import { choose, createFlowHarness, type FlowHarness } from "./tui-host-harness.js";

let harness: FlowHarness | undefined;
afterEach(async () => { await harness?.destroy(); harness = undefined; });

const models = [
  { provider: "anthropic", id: "claude-a", name: "Claude A", contextWindow: 200_000, reasoning: true },
  { provider: "anthropic", id: "claude-b", name: "Claude B", contextWindow: 200_000, reasoning: false },
  { provider: "openai", id: "gpt-x", name: "GPT X", contextWindow: 128_000, reasoning: true },
];

describe("showModelPicker", () => {
  test("offers one row per provider plus the connect row, then selects the chosen model", async () => {
    harness = await createFlowHarness({ client: { getAvailableModels: async () => models } });
    harness.script(choose("anthropic"), choose("Claude B"));
    await showModelPicker(harness.ctx);

    const [providerDialog, modelDialog] = harness.dialogs;
    expect(providerDialog!.kind).toBe("select");
    const providerOptions = (providerDialog as { options: string[] }).options;
    expect(providerOptions).toHaveLength(3);
    expect(providerOptions.at(-1)).toBe("+ Connect or repair a provider");
    expect((modelDialog as { title: string }).title).toBe("Model · anthropic");
    expect((modelDialog as { options: string[] }).options).toHaveLength(2);
    expect(harness.calls.controller).toEqual([["setModel", "anthropic", "claude-b"]]);
  });

  test("cancelling the provider list changes nothing and restores the idle status", async () => {
    harness = await createFlowHarness({ client: { getAvailableModels: async () => models } });
    harness.script(undefined);
    await showModelPicker(harness.ctx);
    expect(harness.calls.controller.filter(([name]) => name === "setModel")).toEqual([]);
    expect(harness.status()).toBe(harness.ctx.view.idleStatus());
  });

  test("with no authenticated models it explains, then offers provider login", async () => {
    harness = await createFlowHarness();
    harness.script(undefined);
    await showModelPicker(harness.ctx);
    expect(harness.entryTitles()).toContain("No authenticated models");
    expect(harness.dialogs[0]!.title).toBe("Connect or repair a provider");
  });

  test("a failing catalog is reported without changing the model", async () => {
    harness = await createFlowHarness({ client: { getAvailableModels: async () => { throw new Error("rpc down"); } } });
    await showModelPicker(harness.ctx);
    expect(harness.entryTitles()).toContain("Model picker unavailable");
    expect(harness.calls.controller).toEqual([]);
  });

  test("refuses while a response is streaming", async () => {
    harness = await createFlowHarness();
    harness.state.busy = true;
    await showModelPicker(harness.ctx);
    expect(harness.dialogs).toEqual([]);
    expect(harness.entryTitles()).toEqual(["Model selection unavailable while responding"]);
  });
});

describe("showProviderLogin", () => {
  test("lists providers with their login methods and returns false when cancelled", async () => {
    harness = await createFlowHarness();
    harness.script(undefined);
    expect(await showProviderLogin(harness.ctx)).toBe(false);
    const dialog = harness.dialogs[0]!;
    expect(dialog.title).toBe("Connect or repair a provider");
    expect(dialog.kind === "select" && dialog.options.length).toBeGreaterThan(0);
    expect(dialog.kind === "select" && dialog.presentation.showDescription).toBe(true);
    expect(harness.state.activeProviderLoginAbort).toBeNull();
  });

  test("refuses while busy", async () => {
    harness = await createFlowHarness();
    harness.state.busy = true;
    expect(await showProviderLogin(harness.ctx)).toBe(false);
    expect(harness.dialogs).toEqual([]);
    expect(harness.entryTitles()).toEqual(["Provider connection unavailable while responding"]);
  });
});
