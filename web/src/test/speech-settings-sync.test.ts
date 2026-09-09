import { afterEach, expect, test } from "bun:test";
import { loadWebSpeechSettings, saveWebSpeechSettings, subscribeWebSpeechSettings } from "../keating/speech";
import { useKeatingAgentStore } from "../stores/keating-agent-store";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  for (const [key, descriptor] of [["window", originalWindow], ["localStorage", originalStorage]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("observing speech settings never writes them back; one edit causes one notification", () => {
  const events = new EventTarget();
  const values = new Map<string, string>();
  let writes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; values.set(key, value); },
  } });
  const sync = useKeatingAgentStore.getState().syncSpeechSettings;
  let notifications = 0;
  const unsubscribe = subscribeWebSpeechSettings(settings => {
    if (++notifications > 5) throw new Error("Speech settings feedback loop");
    sync(settings);
  });
  try {
    sync(loadWebSpeechSettings());
    expect(writes).toBe(0);
    expect(notifications).toBe(0);
    saveWebSpeechSettings({ ...loadWebSpeechSettings(), voiceName: "regression-voice" });
    expect(writes).toBe(1);
    expect(notifications).toBe(1);
    expect(useKeatingAgentStore.getState().speechSettings.voiceName).toBe("regression-voice");
    const snapshot = useKeatingAgentStore.getState();
    // Reopening a section reads a fresh but equivalent object.
    for (let i = 0; i < 20; i++) sync(loadWebSpeechSettings());
    expect(useKeatingAgentStore.getState()).toBe(snapshot);
    expect(writes).toBe(1);
    expect(notifications).toBe(1);
  } finally { unsubscribe(); }
});
