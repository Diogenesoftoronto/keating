import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureProjectScaffold } from "../src/core/project.js";
import hyperteacher from "../src/pi/hyperteacher-extension.js";

interface RegisteredCommand {
  description: string;
  handler: (args: string | string[], ctx: any) => Promise<void>;
}

function createMockPi() {
  const commands = new Map<string, RegisteredCommand>();
  const events = new Map<string, (event: any, ctx: any) => Promise<void>>();

  return {
    commands,
    events,
    registerCommand(name: string, cmd: RegisteredCommand) {
      commands.set(name, cmd);
    },
    on(event: string, handler: (event: any, ctx: any) => Promise<void>) {
      events.set(event, handler);
    }
  };
}

function createMockCtx(cwd: string) {
  const notifications: Array<{ message: string; level: string }> = [];
  let editorText = "";

  return {
    cwd,
    notifications,
    get editorText() {
      return editorText;
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setEditorText(text: string) {
        editorText = text;
      },
      async select(_title: string, options: string[]) {
        return options[0] ?? "";
      }
    }
  };
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "keating-ext-"));
  await ensureProjectScaffold(cwd);
  const pi = createMockPi();
  hyperteacher(pi);
  const ctx = createMockCtx(cwd);
  return { cwd, pi, ctx };
}

test("/plan with string arg produces notification", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("plan")!.handler("derivative" as any, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("derivative")));
  assert.ok(ctx.editorText.length > 0);
});

test("/plan with array arg joins words", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("plan")!.handler(["bayes", "rule"], ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("bayes")));
});

test("/plan with empty string shows usage", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("plan")!.handler("" as any, ctx);
  assert.ok(ctx.notifications[0].message.includes("Usage"));
});

test("/plan with empty array shows usage", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("plan")!.handler([], ctx);
  assert.ok(ctx.notifications[0].message.includes("Usage"));
});

test("/map with string arg produces map", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("map")!.handler("derivative" as any, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("Generated")));
});

test("/animate with string arg produces animation", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("animate")!.handler("entropy" as any, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("Generated")));
});

test("/verify with string arg produces checklist", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("verify")!.handler("derivative" as any, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("checklist")));
});

test("/verify with empty arg shows usage", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("verify")!.handler("" as any, ctx);
  assert.ok(ctx.notifications[0].message.includes("Usage"));
});

test("/feedback records signal", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("feedback")!.handler("up derivative" as any, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("thumbs-up")));
});

test("/feedback with invalid signal shows usage", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("feedback")!.handler("" as any, ctx);
  assert.ok(ctx.notifications[0].message.includes("Usage"));
});

test("/bench with empty args runs suite", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("bench")!.handler("" as any, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("Benchmark score")));
});

test("/policy shows current policy", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("policy")!.handler("" as any, ctx);
  assert.ok(ctx.editorText.includes("Policy:"));
});

test("/trace with empty args works", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("trace")!.handler("" as any, ctx);
  assert.ok(ctx.notifications.length > 0);
});

test("session_start event fires notification", async () => {
  const { pi, ctx } = await setup();
  await pi.events.get("session_start")!({}, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("Keating loaded")));
});
