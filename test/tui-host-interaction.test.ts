import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  CANCELLING_PROVIDER_STATUS,
  TUI_KEY_STAGES,
  initialTuiInteractionState,
  tuiInteractionReducer,
  type TuiHostCommand,
  type TuiInteractionAction,
  type TuiInteractionState,
  type TuiKey,
  type TuiKeyContext,
} from "../src/tui/host/interaction.js";

const context = (overrides: Partial<TuiKeyContext> = {}): TuiKeyContext => ({
  modalSearchFocused: false,
  providerLoginActive: false,
  sidebarVisible: false,
  composerAllowsLeader: true,
  fileReferenceActive: false,
  onboardingPageCount: 4,
  ...overrides,
});

const press = (state: TuiInteractionState, key: TuiKey | string, ctx: Partial<TuiKeyContext> = {}) =>
  tuiInteractionReducer(state, {
    type: "key",
    key: typeof key === "string" ? { name: key } : key,
    context: context(ctx),
  });

const base = initialTuiInteractionState("emacs");
const withModal = (scrollable = false): TuiInteractionState => ({ ...base, modal: { scrollable } });
const withLeader: TuiInteractionState = { ...base, leaderActive: true };
const withOnboarding: TuiInteractionState = { ...base, onboarding: { active: true, pageIndex: 0 } };
const vimNormal: TuiInteractionState = { ...initialTuiInteractionState("vim"), vimState: "normal" };

describe("tuiInteractionReducer key precedence", () => {
  test("stage order is onboarding > modal > leader > editor > global", () => {
    const order = TUI_KEY_STAGES.map(([name]) => name);
    const at = (name: string) => order.indexOf(name);
    expect(at("onboarding")).toBeLessThan(at("modal"));
    expect(at("modal")).toBeLessThan(at("leader"));
    expect(at("leader")).toBeLessThan(at("vim"));
    expect(at("vim")).toBeLessThan(at("ctrl"));
  });

  test("onboarding swallows keys before an open modal sees them", () => {
    const state = { ...withOnboarding, modal: { scrollable: false } };
    const result = press(state, "escape");
    expect(result.effects).toEqual([{ type: "onboarding-finish", outcome: "skipped" }]);
    expect(result.state.onboarding.active).toBe(false);
    expect(result.suppress).toBe("all");
  });

  test("an open modal outranks an active leader prefix", () => {
    const state = { ...withModal(), leaderActive: true };
    const result = press(state, "escape");
    expect(result.effects).toEqual([{ type: "dialog-cancel" }]);
    expect(result.state.modal).toBeNull();
    expect(result.state.leaderActive).toBe(true);
  });

  test("a modal keeps global Ctrl shortcuts from firing", () => {
    const result = press(withModal(), { name: "s", ctrl: true });
    expect(result.effects).toEqual([]);
    expect(result.suppress).toBe("none");
  });

  test("leader outranks editor and global bindings", () => {
    const result = press({ ...vimNormal, leaderActive: true }, "s");
    expect(result.effects).toEqual([{ type: "leader-end", outcome: { kind: "run", command: "sessions" } }]);
    expect(result.state.leaderActive).toBe(false);
    expect(result.suppress).toBe("all");
  });

  test("vim normal mode outranks Ctrl shortcuts only for plain keys", () => {
    expect(press(vimNormal, "u").effects).toEqual([{ type: "vim-edit", action: "undo" }]);
    expect(press(vimNormal, { name: "u", ctrl: true }).effects).toEqual([{ type: "invoke", command: "ui-actions" }]);
  });

  test("vim insert escape enters normal mode and is swallowed", () => {
    const result = press(initialTuiInteractionState("vim"), "escape");
    expect(result.state.vimState).toBe("normal");
    expect(result.effects).toEqual([{ type: "vim-mode", mode: "normal" }]);
    expect(result.suppress).toBe("all");
  });

  test("vim rules do not apply when the composer is not focused", () => {
    const state = { ...vimNormal, focusArea: "transcript" as const };
    expect(press(state, "i").effects).toEqual([]);
  });

  test("emacs mode never consumes plain keys", () => {
    const result = press(base, "i");
    expect(result).toEqual({ state: base, suppress: "none", effects: [] });
  });
});

describe("modal keys", () => {
  test("Escape and Ctrl+P close the dialog", () => {
    for (const key of [{ name: "escape" }, { name: "p", ctrl: true }]) {
      const result = press(withModal(), key);
      expect(result.state.modal).toBeNull();
      expect(result.effects).toEqual([{ type: "dialog-cancel" }]);
    }
  });

  test("Escape prevents default only; Ctrl+P also stops propagation", () => {
    expect(press(withModal(), "escape").suppress).toBe("default");
    expect(press(withModal(), { name: "p", ctrl: true }).suppress).toBe("all");
  });

  test("Ctrl+X during provider login aborts, cancels and reports", () => {
    const result = press(withModal(), { name: "x", ctrl: true }, { providerLoginActive: true });
    expect(result.effects).toEqual([
      { type: "abort-provider-login" },
      { type: "dialog-cancel" },
      { type: "status", text: CANCELLING_PROVIDER_STATUS },
    ]);
    expect(result.state.modal).toBeNull();
  });

  test("Ctrl+X without a provider login is ignored by the modal", () => {
    expect(press(withModal(), { name: "x", ctrl: true }).effects).toEqual([]);
  });

  test("PageUp/PageDown scroll only scrollable dialogs", () => {
    expect(press(withModal(true), "pageup").effects).toEqual([{ type: "dialog-scroll", direction: -1 }]);
    expect(press(withModal(true), "pagedown").effects).toEqual([{ type: "dialog-scroll", direction: 1 }]);
    expect(press(withModal(false), "pagedown").effects).toEqual([]);
  });

  test("Tab and Shift+Tab move dialog focus; Down leaves the filter field", () => {
    expect(press(withModal(), "tab").effects).toEqual([{ type: "dialog-focus", direction: "next" }]);
    expect(press(withModal(), { name: "tab", shift: true }).effects).toEqual([{ type: "dialog-focus", direction: "previous" }]);
    expect(press(withModal(), "down", { modalSearchFocused: true }).effects).toEqual([{ type: "dialog-focus", direction: "next" }]);
    expect(press(withModal(), "down").effects).toEqual([]);
  });
});

describe("leader keys", () => {
  test("a colon on an empty composer begins the leader", () => {
    const result = press(base, ":");
    expect(result.state.leaderActive).toBe(true);
    expect(result.effects).toEqual([{ type: "leader-begin" }]);
  });

  test("colon is ignored with composer text, other focus, or modifiers", () => {
    expect(press(base, ":", { composerAllowsLeader: false }).state.leaderActive).toBe(false);
    expect(press({ ...base, focusArea: "transcript" }, ":").state.leaderActive).toBe(false);
    expect(press(base, { name: ":", ctrl: true }).state.leaderActive).toBe(false);
    expect(press(base, { name: ":", meta: true }).state.leaderActive).toBe(false);
  });

  test("leader maps keys to commands, escape cancels, unknown keys report", () => {
    expect(press(withLeader, "p").effects).toEqual([{ type: "leader-end", outcome: { kind: "run", command: "palette" } }]);
    expect(press(withLeader, "u").effects).toEqual([{ type: "leader-end", outcome: { kind: "run", command: "ui-actions" } }]);
    expect(press(withLeader, "f").effects).toEqual([{ type: "leader-end", outcome: { kind: "run", command: "transcript-search" } }]);
    expect(press(withLeader, "escape").effects).toEqual([{ type: "leader-end", outcome: { kind: "cancel" } }]);
    expect(press(withLeader, "Z").effects).toEqual([{ type: "leader-end", outcome: { kind: "unknown", keyName: "z" } }]);
  });

  test("prototype member names are unknown leader keys, not commands", () => {
    expect(press(withLeader, "constructor").effects).toEqual([
      { type: "leader-end", outcome: { kind: "unknown", keyName: "constructor" } },
    ]);
  });
});

describe("global keys", () => {
  test("Ctrl letters invoke their commands", () => {
    const expected: Record<string, TuiHostCommand> = {
      p: "palette", s: "sessions", l: "library", o: "courses", m: "model",
      t: "thinking", n: "new-session", x: "abort", r: "retry", u: "ui-actions", f: "transcript-search",
    };
    for (const [letter, command] of Object.entries(expected)) {
      expect(press(base, { name: letter, ctrl: true }).effects).toEqual([{ type: "invoke", command }]);
    }
  });

  test("Ctrl+Return and the KeyM code select the model", () => {
    expect(press(base, { name: "return", ctrl: true }).effects).toEqual([{ type: "invoke", command: "model" }]);
    expect(press(base, { name: "unknown", ctrl: true, code: "KeyM" }).effects).toEqual([{ type: "invoke", command: "model" }]);
    expect(press(base, { name: "unknown", ctrl: true, baseCode: 109 }).effects).toEqual([{ type: "invoke", command: "model" }]);
  });

  test("Ctrl+X aborts a provider login instead of the response", () => {
    const result = press(base, { name: "x", ctrl: true }, { providerLoginActive: true });
    expect(result.effects).toEqual([{ type: "abort-provider-login" }, { type: "status", text: CANCELLING_PROVIDER_STATUS }]);
  });

  test("unbound Ctrl keys and plain keys fall through untouched", () => {
    expect(press(base, { name: "q", ctrl: true })).toEqual({ state: base, suppress: "none", effects: [] });
    expect(press(base, "a")).toEqual({ state: base, suppress: "none", effects: [] });
  });

  test("Ctrl+B toggles the side panel from any focus", () => {
    expect(press({ ...base, focusArea: "transcript" }, { name: "b", ctrl: true }).effects).toEqual([{ type: "toggle-sidebar" }]);
  });
});

describe("focus", () => {
  test("Tab cycles composer -> transcript -> composer without a panel", () => {
    const first = press(base, "tab");
    expect(first.state.focusArea).toBe("transcript");
    expect(first.effects).toEqual([{ type: "focus-apply", area: "transcript" }]);
    expect(press(first.state, "tab").state.focusArea).toBe("composer");
  });

  test("Tab reaches the sidebar only while it is visible", () => {
    const toTranscript = { ...base, focusArea: "transcript" as const };
    expect(press(toTranscript, "tab", { sidebarVisible: true }).state.focusArea).toBe("sidebar");
    expect(press(toTranscript, "tab", { sidebarVisible: false }).state.focusArea).toBe("composer");
  });

  test("Tab in the composer on a file reference opens the picker", () => {
    const result = press(base, "tab", { fileReferenceActive: true });
    expect(result.effects).toEqual([{ type: "show-file-picker" }]);
    expect(result.state.focusArea).toBe("composer");
  });

  test("Tab inside the sidebar is left to the sidebar", () => {
    expect(press({ ...base, focusArea: "sidebar" }, "tab")).toEqual({
      state: { ...base, focusArea: "sidebar" }, suppress: "none", effects: [],
    });
  });

  test("Escape in the sidebar returns focus to the composer", () => {
    const result = press({ ...base, focusArea: "sidebar" }, "escape");
    expect(result.state.focusArea).toBe("composer");
    expect(result.effects).toEqual([{ type: "focus-apply", area: "composer" }]);
  });

  test("a focus request for a hidden sidebar lands on the composer", () => {
    const result = tuiInteractionReducer(base, { type: "focus-request", area: "sidebar", sidebarVisible: false });
    expect(result.state.focusArea).toBe("composer");
    expect(result.effects).toEqual([{ type: "focus-apply", area: "composer" }]);
  });

  test("an observed focus change records state without re-applying", () => {
    const result = tuiInteractionReducer(base, { type: "focus-observed", area: "transcript" });
    expect(result.state.focusArea).toBe("transcript");
    expect(result.effects).toEqual([]);
  });
});

describe("vim normal mode", () => {
  test("insert, open-line and append return to insert mode", () => {
    for (const key of ["i", "o", "a"]) {
      expect(press(vimNormal, key).state.vimState).toBe("insert");
    }
    expect(press(vimNormal, "a").effects).toEqual([
      { type: "vim-edit", action: "append" },
      { type: "vim-mode", mode: "insert" },
    ]);
  });

  test("movement keys edit without changing mode", () => {
    const result = press(vimNormal, "h");
    expect(result.state.vimState).toBe("normal");
    expect(result.effects).toEqual([{ type: "vim-edit", action: "move-left" }]);
  });

  test("escape in normal mode is consumed", () => {
    expect(press(vimNormal, "escape")).toEqual({ state: vimNormal, suppress: "all", effects: [] });
  });

  test("unmapped normal-mode keys pass through", () => {
    expect(press(vimNormal, "z")).toEqual({ state: vimNormal, suppress: "none", effects: [] });
  });
});

describe("onboarding", () => {
  test("Space advances; the last page completes", () => {
    const next = press(withOnboarding, "space");
    expect(next.state.onboarding).toEqual({ active: true, pageIndex: 1 });
    expect(next.effects).toEqual([{ type: "onboarding-render" }]);
    const last = press({ ...withOnboarding, onboarding: { active: true, pageIndex: 3 } }, "space");
    expect(last.effects).toEqual([{ type: "onboarding-finish", outcome: "completed" }]);
    expect(last.state.onboarding.active).toBe(false);
  });

  test("Backspace goes back and never below page zero", () => {
    expect(press(withOnboarding, "backspace").state.onboarding.pageIndex).toBe(0);
    expect(press({ ...withOnboarding, onboarding: { active: true, pageIndex: 2 } }, "left").state.onboarding.pageIndex).toBe(1);
  });

  test("unrelated keys are not swallowed", () => {
    expect(press(withOnboarding, "q")).toEqual({ state: withOnboarding, suppress: "none", effects: [] });
  });

  test("begin and end actions restart and close the tour", () => {
    const begun = tuiInteractionReducer({ ...base, onboarding: { active: false, pageIndex: 3 } }, { type: "onboarding-begin" });
    expect(begun.state.onboarding).toEqual({ active: true, pageIndex: 0 });
    expect(tuiInteractionReducer(begun.state, { type: "onboarding-end" }).state.onboarding.active).toBe(false);
  });
});

describe("modal lifecycle actions", () => {
  test("open and close track scrollability", () => {
    const opened = tuiInteractionReducer(base, { type: "modal-open", scrollable: true });
    expect(opened.state.modal).toEqual({ scrollable: true });
    expect(tuiInteractionReducer(opened.state, { type: "modal-close" }).state.modal).toBeNull();
  });
});

// ---- properties --------------------------------------------------------

const keyNames = [
  "escape", "tab", "return", "enter", "space", "backspace", "left", "right", "up", "down",
  "pageup", "pagedown", "delete", "end", ":", "colon", "constructor", "__proto__", "toString",
  ..."abcdefghijklmnopqrstuvwxyz0$".split(""),
  "A", "X", "P", "", "unknown",
];
const keyArb: fc.Arbitrary<TuiKey> = fc.record({
  name: fc.oneof(fc.constantFrom(...keyNames), fc.string({ maxLength: 8 })),
  ctrl: fc.boolean(),
  meta: fc.boolean(),
  shift: fc.boolean(),
  code: fc.option(fc.constantFrom("KeyM", "keym", "KeyA"), { nil: undefined }),
  baseCode: fc.option(fc.constantFrom(109, 97), { nil: undefined }),
});
const contextArb: fc.Arbitrary<TuiKeyContext> = fc.record({
  modalSearchFocused: fc.boolean(),
  providerLoginActive: fc.boolean(),
  sidebarVisible: fc.boolean(),
  composerAllowsLeader: fc.boolean(),
  fileReferenceActive: fc.boolean(),
  onboardingPageCount: fc.integer({ min: 0, max: 8 }),
});
const focusArb = fc.constantFrom("composer", "transcript", "sidebar" as const);
const stateArb: fc.Arbitrary<TuiInteractionState> = fc.record({
  focusArea: focusArb,
  editorMode: fc.constantFrom("emacs", "vim" as const),
  vimState: fc.constantFrom("insert", "normal" as const),
  leaderActive: fc.boolean(),
  onboarding: fc.record({ active: fc.boolean(), pageIndex: fc.integer({ min: 0, max: 7 }) }),
  modal: fc.option(fc.record({ scrollable: fc.boolean() }), { nil: null }),
});
const actionArb: fc.Arbitrary<TuiInteractionAction> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ type: fc.constant("key" as const), key: keyArb, context: contextArb }) },
  fc.record({ type: fc.constant("focus-request" as const), area: focusArb, sidebarVisible: fc.boolean() }),
  fc.record({ type: fc.constant("focus-observed" as const), area: focusArb }),
  fc.record({ type: fc.constant("vim-mode" as const), mode: fc.constantFrom("insert", "normal" as const) }),
  fc.record({ type: fc.constant("modal-open" as const), scrollable: fc.boolean() }),
  fc.constant({ type: "modal-close" as const }),
  fc.constant({ type: "onboarding-begin" as const }),
  fc.constant({ type: "onboarding-end" as const }),
);

describe("tuiInteractionReducer properties", () => {
  test("is total: never throws and always returns well-formed output", () => {
    fc.assert(fc.property(stateArb, fc.array(actionArb, { maxLength: 40 }), (initial, actions) => {
      let state = initial;
      for (const action of actions) {
        const result = tuiInteractionReducer(state, action);
        expect(["none", "default", "all"]).toContain(result.suppress);
        expect(Array.isArray(result.effects)).toBe(true);
        expect(["composer", "transcript", "sidebar"]).toContain(result.state.focusArea);
        state = result.state;
      }
    }), { numRuns: 300 });
  });

  test("is pure: the input state is never mutated and results repeat", () => {
    fc.assert(fc.property(stateArb, actionArb, (state, action) => {
      const snapshot = structuredClone(state);
      const first = tuiInteractionReducer(state, action);
      expect(state).toEqual(snapshot);
      expect(tuiInteractionReducer(state, action)).toEqual(first);
    }), { numRuns: 300 });
  });

  test("Escape closes any open modal within one press", () => {
    fc.assert(fc.property(stateArb, contextArb, (state, ctx) => {
      const open = { ...state, modal: { scrollable: false }, onboarding: { ...state.onboarding, active: false } };
      const result = tuiInteractionReducer(open, { type: "key", key: { name: "escape" }, context: ctx });
      expect(result.state.modal).toBeNull();
      expect(result.effects).toContainEqual({ type: "dialog-cancel" });
    }), { numRuns: 200 });
  });

  test("a bounded run of Escapes always reaches a state with no modal and no onboarding", () => {
    fc.assert(fc.property(stateArb, contextArb, (state, ctx) => {
      // Onboarding page count is at most 8, and Escape skips the tour at once.
      let current = state;
      for (let presses = 0; presses < 3; presses += 1) {
        current = tuiInteractionReducer(current, { type: "key", key: { name: "escape" }, context: ctx }).state;
      }
      expect(current.modal).toBeNull();
      expect(current.onboarding.active).toBe(false);
    }), { numRuns: 300 });
  });

  test("the leader never survives a key press while it is active", () => {
    fc.assert(fc.property(stateArb, keyArb, contextArb, (state, key, ctx) => {
      const active = { ...state, leaderActive: true, modal: null, onboarding: { ...state.onboarding, active: false } };
      const result = tuiInteractionReducer(active, { type: "key", key, context: ctx });
      // Ctrl+B and the sidebar Escape run before the leader and leave it armed;
      // every other key consumes it.
      const bypass = (state.focusArea === "sidebar" && key.name.toLowerCase() === "escape")
        || (key.ctrl === true && key.name.toLowerCase() === "b");
      if (!bypass) expect(result.state.leaderActive).toBe(false);
    }), { numRuns: 300 });
  });

  test("the leader only ever starts from a bare colon in the focused composer", () => {
    fc.assert(fc.property(stateArb, keyArb, contextArb, (state, key, ctx) => {
      const before = { ...state, leaderActive: false };
      const result = tuiInteractionReducer(before, { type: "key", key, context: ctx });
      if (result.state.leaderActive) {
        expect(before.focusArea).toBe("composer");
        expect(key.ctrl).not.toBe(true);
        expect(key.meta).not.toBe(true);
        expect(ctx.composerAllowsLeader).toBe(true);
      }
    }), { numRuns: 300 });
  });

  test("a modal swallows every key that is not a modal key", () => {
    fc.assert(fc.property(stateArb, keyArb, contextArb, (state, key, ctx) => {
      const open = { ...state, modal: { scrollable: true }, onboarding: { ...state.onboarding, active: false } };
      const result = tuiInteractionReducer(open, { type: "key", key, context: ctx });
      for (const effect of result.effects) {
        expect(["dialog-cancel", "dialog-scroll", "dialog-focus", "abort-provider-login", "status"]).toContain(effect.type);
      }
      expect(result.state.focusArea).toBe(open.focusArea);
      expect(result.state.vimState).toBe(open.vimState);
      expect(result.state.leaderActive).toBe(open.leaderActive);
    }), { numRuns: 300 });
  });

  test("an active tour only ever emits onboarding effects", () => {
    fc.assert(fc.property(stateArb, keyArb, contextArb, (state, key, ctx) => {
      const touring = { ...state, onboarding: { active: true, pageIndex: state.onboarding.pageIndex } };
      const result = tuiInteractionReducer(touring, { type: "key", key, context: ctx });
      for (const effect of result.effects) {
        expect(["onboarding-render", "onboarding-finish"]).toContain(effect.type);
      }
    }), { numRuns: 300 });
  });

  test("focus never rests on a hidden sidebar after a focus request", () => {
    fc.assert(fc.property(stateArb, focusArb, (state, area) => {
      const result = tuiInteractionReducer(state, { type: "focus-request", area, sidebarVisible: false });
      expect(result.state.focusArea).not.toBe("sidebar");
    }), { numRuns: 100 });
  });

  test("onboarding page index stays inside the page count", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom("space", "backspace", "right", "left", "pageup", "pagedown"), { maxLength: 30 }), fc.integer({ min: 1, max: 8 }), (names, count) => {
      let state: TuiInteractionState = { ...base, onboarding: { active: true, pageIndex: 0 } };
      for (const name of names) {
        state = tuiInteractionReducer(state, { type: "key", key: { name }, context: context({ onboardingPageCount: count }) }).state;
        if (!state.onboarding.active) break;
        expect(state.onboarding.pageIndex).toBeGreaterThanOrEqual(0);
        expect(state.onboarding.pageIndex).toBeLessThan(count);
      }
    }), { numRuns: 200 });
  });
});
