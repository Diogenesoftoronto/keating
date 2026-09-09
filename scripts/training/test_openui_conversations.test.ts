import { expect, test } from "bun:test";
import { validateConversations } from "./validate_openui_conversations";
import { createAssessmentTools } from "../../web/src/keating/browser-tools/assessment";
import { createTeachingTools } from "../../web/src/keating/browser-tools/teaching";
import type { KeatingStorage } from "../../web/src/keating/storage";
const catalog = await Bun.file(new URL("./data/openui-conversations.json", import.meta.url)).json();
const storage = {} as KeatingStorage;
const tools = [...createAssessmentTools(storage,async()=>[]),...createTeachingTools(storage)]
  .map(t=>({function:{name:t.name,parameters:t.parameters}}));

test("long sessions preserve native calls, submitted answers and current exam grammar", async () => {
  const result = await validateConversations(catalog, tools);
  expect(result.conversations).toBe(12);
  expect(result.tool_counts.deck).toBeUndefined();
  expect(result.tool_counts.quiz).toBeUndefined();
  expect(result.quizzes).toBe(12);
  expect(result.flashcards).toBe(12);
  expect(result.exams).toBe(6);
  expect(result.message_range[0]).toBeGreaterThan(40);
});

test("rejects leakage, orphan tool results, unknown tools and grading unsubmitted work", async () => {
  const mutations = [
    (d:any) => { d.conversations[0].messages.find((m:any)=>m.tool_calls).tool_calls[0].function.name = "deck"; },
    (d:any) => { d.conversations[0].messages.find((m:any)=>m.tool_calls).tool_calls[0].function.name = "quiz"; },
    (d:any) => { d.conversations[1].split = "validation"; },
    (d:any) => { d.conversations[0].messages.find((m:any)=>m.role==="tool").tool_call_id = "unknown"; },
    (d:any) => { d.conversations[0].messages.find((m:any)=>m.tool_calls).tool_calls[0].function.name = "ask_user_question"; },
    (d:any) => { const c=d.conversations[0].messages.find((m:any)=>m.tool_calls).tool_calls[0]; const a=JSON.parse(c.function.arguments);a.results[0].question="Not submitted";c.function.arguments=JSON.stringify(a); },
  ];
  for (const mutate of mutations) {
    const copy=structuredClone(catalog);mutate(copy);
    await expect(validateConversations(copy,tools)).rejects.toThrow();
  }
});
