import { expect, test } from "bun:test";
import { validateAnswer } from "./validate_openui_sft";

test("all authored examples compile through the real chat parser and document compiler", async () => {
  const data = await Bun.file(new URL("./data/openui-sft.json", import.meta.url)).json();
  for (const row of [...data.train, ...data.validation]) expect(() => validateAnswer(row.assistant, row.id)).not.toThrow();
});

test("rejects incomplete fences, invented components, lifecycle disagreement and answers after questions", () => {
  const good = '```openui lifecycle=ephemeral id=test revision=0\nroot = LearningSurface([q], "Test", "", "ephemeral")\nq = Question([{header:"Reasoning",question:"Why?",type:"text"}], "ephemeral")\n```';
  expect(() => validateAnswer(good, "test")).not.toThrow();
  for (const bad of [good.slice(0, -3), good.replace("q = Question", "q = MagicQuestion"), good.replace("lifecycle=ephemeral", "lifecycle=workspace"), good + "\nThe answer is..."]) {
    expect(() => validateAnswer(bad, "test")).toThrow();
  }
});
