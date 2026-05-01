import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { configPath } from "../src/core/config.js";
import { ensureProjectScaffold } from "../src/core/project.js";
import hyperteacher from "../src/pi/hyperteacher-extension.js";

interface RegisteredCommand {
  description: string;
  handler: (args: string | string[], ctx: any) => Promise<void>;
}

interface RegisteredTool {
  name: string;
  execute: (toolCallId: string, params: any) => Promise<any>;
}

function createMockPi() {
  const commands = new Map<string, RegisteredCommand>();
  const events = new Map<string, (event: any, ctx: any) => Promise<void>>();
  const tools = new Map<string, RegisteredTool>();

  return {
    commands,
    events,
    tools,
    registerCommand(name: string, cmd: RegisteredCommand) {
      commands.set(name, cmd);
    },
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    on(event: string, handler: (event: any, ctx: any) => Promise<void>) {
      events.set(event, handler);
    }
  };
}

function createMockCtx(cwd: string) {
  const notifications: Array<{ message: string; level: string }> = [];
  let editorText = "";
  let headerSet = false;
  const widgetKeys = new Set<string>();

  return {
    cwd,
    notifications,
    get editorText() {
      return editorText;
    },
    get widgetKeys() {
      return widgetKeys;
    },
    get headerSet() {
      return headerSet;
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setEditorText(text: string) {
        editorText = text;
      },
      setHeader(content: any) {
        headerSet = Boolean(content);
      },
      setWidget(key: string, content: any, _options?: any) {
        if (content === undefined) {
          widgetKeys.delete(key);
        } else {
          widgetKeys.add(key);
        }
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

test("/speech shows disabled status by default", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("speech")!.handler("" as any, ctx);
  assert.ok(ctx.editorText.includes("speech=disabled"));
  assert.ok(ctx.notifications.some((n) => n.message.includes("Speech is disabled")));
});

test("/trace with empty args works", async () => {
  const { pi, ctx } = await setup();
  await pi.commands.get("trace")!.handler("" as any, ctx);
  assert.ok(ctx.notifications.length > 0);
});

test("session_start event fires notification", async () => {
  const { pi, ctx } = await setup();
  await pi.events.get("session_start")!({}, ctx);
  assert.equal(ctx.notifications.some((n) => n.message.includes("Keating loaded")), false);
  assert.ok(ctx.headerSet, "setHeader should be called for the startup card");
  assert.equal(ctx.widgetKeys.size, 0, "startup card should not occupy persistent widgets");
  assert.equal(pi.tools.has("keating_voice"), false);
});

test("session_start debug console summary fires notification", async () => {
  const { cwd, pi, ctx } = await setup();
  await writeFile(
    configPath(cwd),
    JSON.stringify({
      debug: {
        consoleSummary: true
      }
    }),
    "utf8"
  );
  await pi.events.get("session_start")!({}, ctx);
  assert.ok(ctx.notifications.some((n) => n.message.includes("Keating loaded")));
});

test("session_start registers voice tool when speech is enabled", async () => {
  const { cwd, pi, ctx } = await setup();
  await writeFile(
    configPath(cwd),
    JSON.stringify({
      speech: {
        enabled: true,
        defaultVoice: "coach",
        fastModel: "fast-voice",
        steeringModel: "standard-verifier"
      }
    }),
    "utf8"
  );

  await pi.events.get("session_start")!({}, ctx);
  const tool = pi.tools.get("keating_voice");
  assert.ok(tool, "speech-enabled sessions should register keating_voice");

  const result = await tool.execute("tool-1", {
    text: "What is your next guess?",
    tags: ["question", "verify"],
    affect: "curious"
  });

  assert.equal(result.content[0].text, "[voice voice=coach tags=question,verify pace=normal affect=curious] What is your next guess?");
  assert.equal(result.details.fastModel, "fast-voice");
  assert.equal(result.details.steeringModel, "standard-verifier");
});
