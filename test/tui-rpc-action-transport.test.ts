import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENUI_JSON_PARITY_FIXTURE,
  type UiAction,
  type UiActionResult,
  type UiDocument,
} from "@keating/learner-contracts";

import {
  PI_UI_ACTION_COMMAND,
  RpcUiActionDispatcher,
  decodeUiActionEnvelope,
  decodeUiActionResultNotification,
  encodeUiActionEnvelope,
  registerPiUiActionCommand,
} from "../src/tui/ui/rpc-action-transport.js";

function fixture(): { document: UiDocument; action: UiAction } {
  const document = structuredClone(OPENUI_JSON_PARITY_FIXTURE);
  return {
    document,
    action: {
      schemaVersion: 1,
      type: "update-notes",
      documentId: document.id,
      documentRevision: document.revision,
      nodeId: "notes",
      value: "Terminal evidence",
      idempotencyKey: "rpc-notes-1",
    },
  };
}

describe("Pi canonical UI action transport", () => {
  test("round-trips only bounded, correlated shared-contract envelopes", () => {
    const { action, document } = fixture();
    expect(decodeUiActionEnvelope(encodeUiActionEnvelope(action, document))).toEqual({ action, sourceDocument: document });
    expect(() => decodeUiActionEnvelope(Buffer.from("{}", "utf8").toString("base64url"))).toThrow();
    expect(() => decodeUiActionEnvelope("../not-base64")).toThrow();
  });

  test("dispatches through the public prompt/notify path and validates the ACK", async () => {
    const { action, document } = fixture();
    let listener: ((event: unknown) => void) | undefined;
    const prompts: string[] = [];
    const client = {
      onEvent(next: (event: unknown) => void) { listener = next; return () => { listener = undefined; }; },
      async getCommands() { return [{ name: PI_UI_ACTION_COMMAND, source: "extension" }]; },
      async getState() { return { isStreaming: false }; },
      async prompt(message: string) {
        prompts.push(message);
        const encoded = message.slice(message.indexOf(" ") + 1);
        const envelope = decodeUiActionEnvelope(encoded);
        const result: UiActionResult = {
          schemaVersion: 1,
          documentId: envelope.action.documentId,
          sourceRevision: envelope.action.documentRevision,
          actionIdempotencyKey: envelope.action.idempotencyKey,
          status: "accepted",
          documentLifecycle: envelope.sourceDocument.lifecycle,
        };
        const notification = `KEATING_UI_ACTION_RESULT_V1:${Buffer.from(JSON.stringify(result), "utf8").toString("base64url")}`;
        queueMicrotask(() => listener?.({ type: "extension_ui_request", method: "notify", message: notification }));
      },
    };
    const dispatcher = new RpcUiActionDispatcher(client, 50);
    expect(await dispatcher.dispatch(action, document)).toMatchObject({ status: "accepted", actionIdempotencyKey: "rpc-notes-1" });
    expect(prompts[0]).toStartWith(`/${PI_UI_ACTION_COMMAND} `);
    dispatcher.dispose();
  });

  test("returns typed retryable recovery for missing receiver, busy runtime, and ACK timeout", async () => {
    const { action, document } = fixture();
    const missing = new RpcUiActionDispatcher({ onEvent() {}, async getCommands() { return []; }, async prompt() {} }, 5);
    expect(await missing.dispatch(action, document)).toMatchObject({ status: "retryable", retryAfterMs: 0 });

    const busy = new RpcUiActionDispatcher({ onEvent() {}, async getCommands() { return [{ name: PI_UI_ACTION_COMMAND, source: "extension" }]; }, async getState() { return { isStreaming: true }; }, async prompt() {} }, 5);
    expect(await busy.dispatch(action, document)).toMatchObject({ status: "retryable", message: expect.stringContaining("still responding") });

    const timeout = new RpcUiActionDispatcher({ onEvent() {}, async getCommands() { return [{ name: PI_UI_ACTION_COMMAND, source: "extension" }]; }, async prompt() {} }, 2);
    expect(await timeout.dispatch(action, document)).toMatchObject({ status: "retryable", message: expect.stringContaining("did not acknowledge") });
  });

  test("receiver materializes notes, persists a separate idempotent ledger, and replays exactly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-rpc-receiver-"));
    try {
      const commands = new Map<string, { handler(args: string | string[], ctx: any): Promise<void> }>();
      registerPiUiActionCommand({ registerCommand(name, command) { commands.set(name, command); } });
      const notifications: string[] = [];
      const ctx = { cwd, ui: { notify(message: string) { notifications.push(message); } } };
      const { action, document } = fixture();
      const encoded = encodeUiActionEnvelope(action, document);
      await commands.get(PI_UI_ACTION_COMMAND)!.handler(encoded, ctx);
      await commands.get(PI_UI_ACTION_COMMAND)!.handler(encoded, ctx);

      expect(notifications).toHaveLength(2);
      const first = decodeUiActionResultNotification(notifications[0]!);
      const replay = decodeUiActionResultNotification(notifications[1]!);
      expect(first).toMatchObject({ status: "completed", resultingDocument: { revision: document.revision + 1 } });
      expect(first?.resultingDocument?.nodes.find((node) => node.id === "notes")).toMatchObject({ type: "notes", value: "Terminal evidence" });
      expect(replay).toEqual(first);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
