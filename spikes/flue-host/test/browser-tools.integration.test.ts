import assert from "node:assert/strict";
import { it } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { init, useModel, useSkill, useSubagent, useTool } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import * as v from "valibot";

import { PORTABLE_TOOL_NAMES } from "../../../packages/agent-runtime/src/tool-names.ts";
import { deterministicProvider } from "../src/provider.ts";
import { retrievalPractice } from "../src/skills/retrieval-practice.ts";
import { lessonCritic } from "../src/subagents/lesson-critic.ts";

const executions: string[] = [];

function BrowserToolsTeacher() {
  useModel("keating-faux/teacher");
  // Exercise coexistence with Flue's own skill and delegation tools.
  useSkill(retrievalPractice);
  useSubagent(lessonCritic);
  for (const name of Object.values(PORTABLE_TOOL_NAMES)) {
    useTool({
      name,
      description: `Portable browser host operation: ${name}`,
      input: v.object({ request: v.string() }),
      output: v.object({ completed: v.string() }),
      run({ data }) {
        executions.push(`${name}:${data.request}`);
        return { output: { completed: name } };
      },
    });
  }
  return "Exercise the portable browser tools alongside the native Flue tools.";
}
BrowserToolsTeacher.agentName = "portable-browser-tools-regression";

it("registers and executes portable browser tool names through the real Flue harness", async () => {
  executions.length = 0;
  const names = Object.values(PORTABLE_TOOL_NAMES);
  let observedResults = false;
  deterministicProvider.setResponses([
    (context) => {
      const registered = context.tools?.map((tool) => tool.name) ?? [];
      for (const name of names) assert.ok(registered.includes(name), `${name} registered`);
      assert.ok(registered.includes("activate_skill"), "native skill tool remains registered");
      assert.ok(registered.includes("task"), "native delegation tool remains registered");
      return fauxAssistantMessage(
        names.map((name) => fauxToolCall(name, { request: "execute" })),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const results = context.messages.filter((message) => message.role === "toolResult");
      for (const name of names) {
        const result = results.find((message) => message.toolName === name);
        assert.ok(result, `${name} result reached the provider`);
        assert.equal(result.isError, false);
        assert.match(JSON.stringify(result.content), new RegExp(name));
      }
      observedResults = true;
      return fauxAssistantMessage("All portable browser tools executed.");
    },
  ]);
  const runtime = await start({
    agents: [BrowserToolsTeacher],
    providers: [deterministicProvider.provider],
  });
  try {
    const teacher = init(BrowserToolsTeacher, { id: "portable-browser-tool-names" });
    const receipt = await teacher.dispatch("Run each portable browser operation.");
    const reply = await teacher.read(receipt);
    assert.equal(reply.text, "All portable browser tools executed.");
    assert.equal(observedResults, true);
    assert.deepEqual([...executions].sort(), names.map((name) => `${name}:execute`).sort());
    assert.equal(deterministicProvider.getPendingResponseCount(), 0);
  } finally {
    await runtime.stop();
  }
});
