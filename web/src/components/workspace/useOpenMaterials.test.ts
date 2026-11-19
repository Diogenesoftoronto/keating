import { expect, test } from "bun:test";
import { listenForMaterials, OPEN_MATERIALS_EVENT } from "./useOpenMaterials";

test("the URL opens once, preserves router state and other parameters, and the window event remains reusable", () => {
  const events = new EventTarget();
  let href = "https://example.test/chat?session=s1&materials=1#turn";
  const state = { key: "router-key" };
  const target = Object.assign(events, {
    location: { get href() { return href; } },
    history: { state, replaceState(next: unknown, _: string, url: string) { expect(next).toBe(state); href = url; } },
  }) as unknown as Window;
  let opens = 0;
  const stop = listenForMaterials(target, () => opens++);
  expect(href).toBe("https://example.test/chat?session=s1#turn");
  expect(opens).toBe(1);
  events.dispatchEvent(new Event(OPEN_MATERIALS_EVENT));
  expect(opens).toBe(2);
  stop();
  events.dispatchEvent(new Event(OPEN_MATERIALS_EVENT));
  expect(opens).toBe(2);
  listenForMaterials(target, () => opens++)();
  expect(opens).toBe(2);
});
