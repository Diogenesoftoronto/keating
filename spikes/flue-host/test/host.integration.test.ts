import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fauxAssistantMessage,
  fauxToolCall,
  type Context,
  type Message,
} from "@earendil-works/pi-ai";
import { getAgentInstance, init } from "@flue/runtime";
import { start } from "@flue/runtime/node";

import app from "../src/app.ts";
import { KeatingTeacher } from "../src/agents/keating-teacher.ts";
import { configureLocalLearningRecordsMcp } from "../src/mcp/local-learning-records.ts";
import { deterministicProvider } from "../src/provider.ts";
import { startLocalMcpServer } from "./support/local-mcp-server.ts";

interface CapturedContext {
  systemPrompt: string | undefined;
  toolNames: string[];
  messages: Message[];
}

function captureContext(context: Context): CapturedContext {
  return {
    systemPrompt: context.systemPrompt,
    toolNames: context.tools?.map((tool) => tool.name) ?? [],
    // Tool definitions contain executable functions and are deliberately not
    // structured-cloneable. Messages are the durable JSON evidence we need.
    messages: structuredClone(context.messages),
  };
}

describe("standalone Flue host", () => {
  it("exports the authored health route", async () => {
    const response = await app.request("http://host.test/health");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      agent: "keating-teacher",
    });
  });

  it("dispatches through the real harness, tool loop, and persistent state", async () => {
    const observedContexts: CapturedContext[] = [];
    deterministicProvider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("build_retrieval_probe", {
          concept: "equivalent fractions",
          misconception: "the larger denominator is always the larger value",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        observedContexts.push(captureContext(context));
        return fauxAssistantMessage("The retrieval probe is ready.");
      },
    ]);

    const runtime = await start({
      agents: [KeatingTeacher],
      providers: [deterministicProvider.provider],
    });

    try {
      const teacher = init(KeatingTeacher, { id: "learner-42" });
      const firstReceipt = await teacher.dispatch(
        "Teach equivalent fractions, then verify retrieval.",
      );
      const firstReply = await teacher.read(firstReceipt);

      assert.equal(firstReply.text, "The retrieval probe is ready.");
      assert.equal(deterministicProvider.state.callCount, 2);
      assert.equal(deterministicProvider.getPendingResponseCount(), 0);
      assert.equal(observedContexts.length, 1);
      assert.ok(
        observedContexts[0].toolNames.includes("build_retrieval_probe"),
      );
      assert.ok(observedContexts[0].toolNames.includes("activate_skill"));
      assert.ok(observedContexts[0].toolNames.includes("task"));

      const afterTool = JSON.stringify(observedContexts[0]);
      assert.match(afterTool, /build_retrieval_probe/);
      assert.match(afterTool, /expectedEvidence/);
      assert.match(afterTool, /Completed retrieval probes in this conversation: 1/);
      assert.match(afterTool, /retrieval-practice/);
      assert.match(afterTool, /lesson-critic/);

      let continuedContext: CapturedContext | undefined;
      deterministicProvider.setResponses([
        (context) => {
          continuedContext = captureContext(context);
          return fauxAssistantMessage("The persisted probe count is still one.");
        },
      ]);

      const secondReceipt = await teacher.dispatch(
        "Continue this same learner conversation.",
      );
      const secondReply = await teacher.read(secondReceipt);

      assert.equal(
        secondReply.text,
        "The persisted probe count is still one.",
      );
      assert.ok(continuedContext);
      assert.match(
        JSON.stringify(continuedContext),
        /Completed retrieval probes in this conversation: 1/,
      );
      assert.ok(await getAgentInstance(KeatingTeacher, "learner-42"));
    } finally {
      await runtime.stop();
    }
  });

  it("activates a skill, reads an allowlisted MCP tool, and delegates a critique", async () => {
    const bearerToken = `ephemeral-${crypto.randomUUID()}`;
    const mcp = await startLocalMcpServer(bearerToken);
    const providerCallsBefore = deterministicProvider.state.callCount;
    let authResolutionCount = 0;
    let runtime: Awaited<ReturnType<typeof start>> | undefined;
    const observedContexts: CapturedContext[] = [];

    configureLocalLearningRecordsMcp({
      url: mcp.url,
      resolveAuth() {
        authResolutionCount += 1;
        return bearerToken;
      },
    });

    deterministicProvider.setResponses([
      (context) => {
        const captured = captureContext(context);
        observedContexts.push(captured);
        assert.ok(
          captured.toolNames.includes(
            "mcp__learner_records__read_learning_record",
          ),
        );
        assert.ok(
          !captured.toolNames.includes(
            "mcp__learner_records__mutate_learning_record",
          ),
        );
        return fauxAssistantMessage(
          fauxToolCall(
            "activate_skill",
            { name: "retrieval-practice" },
            { id: "activate-retrieval" },
          ),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const captured = captureContext(context);
        observedContexts.push(captured);
        assert.match(
          JSON.stringify(captured.messages),
          /Ask the learner to produce an answer without copying the explanation/,
        );
        return fauxAssistantMessage(
          fauxToolCall(
            "mcp__learner_records__read_learning_record",
            { learnerId: "learner-mcp-1" },
            { id: "read-learning-record" },
          ),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const captured = captureContext(context);
        observedContexts.push(captured);
        assert.match(
          JSON.stringify(captured.messages),
          /fractions retrieval score 0\.75/,
        );
        return fauxAssistantMessage(
          fauxToolCall(
            "task",
            {
              agent: "lesson-critic",
              prompt:
                "Critique a fractions lesson that explains equivalence and then asks one retrieval question.",
            },
            { id: "delegate-lesson-critic" },
          ),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const captured = captureContext(context);
        observedContexts.push(captured);
        assert.match(
          captured.systemPrompt ?? "",
          /Review one proposed lesson independently/,
        );
        assert.match(
          JSON.stringify(captured.messages),
          /Critique a fractions lesson/,
        );
        assert.ok(
          !captured.toolNames.includes(
            "mcp__learner_records__read_learning_record",
          ),
        );
        return fauxAssistantMessage(
          "Strength: retrieval follows explanation. Revision: add a misconception distractor.",
        );
      },
      (context) => {
        const captured = captureContext(context);
        observedContexts.push(captured);
        assert.match(
          JSON.stringify(captured.messages),
          /Strength: retrieval follows explanation/,
        );
        return fauxAssistantMessage(
          "The skill, private learner read, and independent critique are complete.",
        );
      },
    ]);

    try {
      runtime = await start({
        agents: [KeatingTeacher],
        providers: [deterministicProvider.provider],
      });
      const teacher = init(KeatingTeacher, { id: "learner-mcp-1" });
      const receipt = await teacher.dispatch(
        "Use retrieval practice, consult my learning record, and independently critique the lesson.",
      );
      const reply = await teacher.read(receipt);

      assert.equal(
        reply.text,
        "The skill, private learner read, and independent critique are complete.",
      );
      assert.equal(
        deterministicProvider.state.callCount - providerCallsBefore,
        5,
      );
      assert.equal(deterministicProvider.getPendingResponseCount(), 0);
      assert.equal(observedContexts.length, 5);
      assert.deepEqual(mcp.evidence.readCalls, [
        { learnerId: "learner-mcp-1" },
      ]);
      assert.equal(mcp.evidence.mutationCalls, 0);
      assert.ok(mcp.evidence.methods.includes("initialize"));
      assert.ok(mcp.evidence.methods.includes("tools/list"));
      assert.ok(mcp.evidence.methods.includes("tools/call"));
      assert.equal(authResolutionCount, mcp.evidence.authHeaders.length);
      assert.ok(authResolutionCount >= 3);
      assert.ok(
        mcp.evidence.authHeaders.every(
          (header) => header === `Bearer ${bearerToken}`,
        ),
      );
      assert.ok(
        mcp.evidence.remoteAddresses.every(
          (address) => address === "127.0.0.1" || address === "::ffff:127.0.0.1",
        ),
      );
      assert.doesNotMatch(JSON.stringify(observedContexts), new RegExp(bearerToken));
    } finally {
      if (runtime) await runtime.stop();
      configureLocalLearningRecordsMcp(undefined);
      await mcp.close();
    }
  });
});
