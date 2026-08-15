import { describe, expect, test } from "bun:test";
import { InputRenderable, InputRenderableEvents } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

describe("OpenTUI composer keyboard contract", () => {
  test("submits on Enter and exposes colon as a distinct leader event", async () => {
    const setup = await createTestRenderer({ width: 40, height: 8, kittyKeyboard: true, exitOnCtrlC: false });
    const { renderer, mockInput } = setup;
    const input = new InputRenderable(renderer, { id: "composer-input", width: 30, value: "" });
    renderer.root.add(input);
    input.focus();
    let submitted = "";
    const keyEvents: Array<{ name: string; ctrl: boolean }> = [];
    input.on(InputRenderableEvents.ENTER, () => { submitted = input.value; });
    renderer.keyInput.on("keypress", (key) => keyEvents.push({ name: key.name, ctrl: key.ctrl }));
    renderer.start();
    try {
      await mockInput.typeText("hello");
      mockInput.pressEnter();
      input.value = "";
      mockInput.pressKey(":");
      await setup.flush();
      expect(submitted).toBe("hello");
      expect(keyEvents).toContainEqual({ name: ":", ctrl: false });
    } finally {
      renderer.destroy();
    }
  });
});
