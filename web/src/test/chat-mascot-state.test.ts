import { describe, expect, test } from "bun:test";
import { chatMascotState } from "../components/chat-mascot-state";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const state = (text: string) => chatMascotState({ messages: [user(text)], running: false, recording: false });

describe("chat companion", () => {
  test.each([
    ["chemistry", "Balance this chemistry reaction"],
    ["biology", "Explain cell biology"],
    ["physics", "Explain quantum physics"],
    ["mycology", "The biology of mushrooms"],
    ["electronics", "Physics of transistors"],
    ["palaeontology", "Dinosaur fossils"],
    ["astronomy", "Physics of black holes"],
    ["music", "How do piano chords work?"],
    ["maths", "Help with calculus"],
    ["coding", "Debugging Python"],
    ["reading", "Discuss this novel"],
  ] as const)("uses %s study animation", (expected, text) => expect(state(text)).toBe(expected));
  test("does not match fragments or cling to an earlier topic", () => {
    expect(state("My cellphone is broken")).toBe("idle");
    expect(chatMascotState({ messages: [user("chemistry"), user("hello")], running: false, recording: false })).toBe("idle");
  });
  test("lifecycle takes priority over subject, with speaking only for live visible output", () => {
    const messages = [user("chemistry")];
    expect(chatMascotState({ messages, running: true, recording: false })).toBe("thinking");
    expect(chatMascotState({ messages, running: true, recording: true })).toBe("listening");
    const assistant = { role: "assistant", status: { type: "running" }, content: [{ type: "text", text: "Here is why" }] };
    expect(chatMascotState({ messages: [...messages, assistant], running: true, recording: false })).toBe("speaking");
    expect(chatMascotState({ messages: [...messages, { ...assistant, content: [{ type: "reasoning", text: "Working" }] }], running: true, recording: false })).toBe("thinking");
    expect(chatMascotState({ messages: [assistant, ...messages], running: true, recording: false })).toBe("thinking");
  });
});
