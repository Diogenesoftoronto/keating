import { expect, test } from "bun:test";
import { createMobileTeachingDraftRound } from "../src/lib/judgement/teaching-drafts";
import { acceptingTeachingJudge, EMPTY_LEARNER_DATA } from "./helpers/judgement-fixtures";

test("native final recovery disables tools while preserving selected model and answers the learner", async () => {
  let calls = 0;
  const request = createMobileTeachingDraftRound({ judge: acceptingTeachingJudge, current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    request: async (settings, _key, messages, options) => {
      calls++; expect(settings.model).toBe("selected-teacher"); expect(messages[0]!.content).toBe("What is four factorial?");
      if (options?.tools?.length === 0) {
        expect(options.systemPrompt).toContain("Do not claim actions");
        return { text: "Four factorial is 24.", calls: [], assistantTurn: null, usage: null };
      }
      return { text: "", calls: [{ id: "invalid", name: "unknown_tool", arguments: {} }], assistantTurn: null, usage: null };
    } });
  const result = await request({ provider: "openai", model: "selected-teacher", customBaseUrl: "" }, "key",
    [{ id: "user", role: "user", content: "What is four factorial?", createdAt: 1 }],
    { tools: [{ name: "workspace_inspect", description: "Read", parameters: { type: "object", properties: {} } }] });
  expect(calls).toBe(3); expect(result.text).toBe("Four factorial is 24."); expect(result.calls).toEqual([]);
});
