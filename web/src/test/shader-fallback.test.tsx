import { expect, test, spyOn } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PaperGlassOverlay, ShaderSurface } from "../design-system/shaders";
import { mountOverlay, mountSurface } from "../design-system/shaders/mount";
import { loadKeatingUiSettings, saveKeatingUiSettings, subscribeKeatingUiSettings } from "../keating/ui-settings";
import { reflectVisualEffects, registerPowerTransition, transitionTheme } from "../theme-sync";

function globals(values: Record<string, unknown>, run: () => void) {
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  try {
    for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, value });
    run();
  } finally {
    for (const name of Object.keys(values)) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("missing WebGL leaves both rendered wrappers and their mounted hosts empty", () => {
  const canvas = { setAttribute() {}, getContext: (_type: string) => null };
  const context = spyOn(canvas, "getContext");
  const doc = { documentElement: { dataset: {}, classList: { contains: () => false } }, createElement: () => canvas };
  const children: unknown[] = [];
  const host = { ownerDocument: doc, append: (child: unknown) => children.push(child) } as unknown as HTMLElement;
  globals({ document: doc }, () => {
    expect(renderToStaticMarkup(<><PaperGlassOverlay /><ShaderSurface effect="field" /></>)).not.toContain("<canvas");
    expect(mountOverlay(host)).toBeUndefined();
    expect(mountSurface(host, { effect: "field" })).toBeUndefined();
    expect(context.mock.calls.some(([type]) => type === "webgl")).toBe(true);
    expect(children).toHaveLength(0);
    context.mockClear();
    reflectVisualEffects({ visualEffects: false });
    mountSurface(host, { effect: "ink" });
    expect(context).not.toHaveBeenCalled();
  });
});

test("power waits for its midpoint, honors rapid toggles and bypasses animation under either motion preference", () => {
  let dark = false;
  let osReduced = false;
  const root = { dataset: { fx: "on", reduceMotion: "false" }, classList: { contains: () => dark } };
  const doc = { documentElement: root, defaultView: { matchMedia: () => ({ matches: osReduced }) } };
  globals({ document: doc }, () => {
    const flips: (() => void)[] = [];
    const stop = registerPowerTransition((_dark, apply) => { flips.push(apply); });
    try {
      const toggle = () => transitionTheme(next => { dark = next; });
      toggle();
      expect(dark).toBe(false);
      toggle();
      expect(dark).toBe(true);
      flips[0]();
      flips[1]();
      expect(dark).toBe(false);
      root.dataset.reduceMotion = "true";
      toggle();
      expect(dark).toBe(true);
      root.dataset.reduceMotion = "false";
      osReduced = true;
      toggle();
      expect(dark).toBe(false);
      expect(flips).toHaveLength(2);
      osReduced = false;
      const applyTheme = spyOn({ apply: (next: boolean) => { dark = next; } }, "apply");
      transitionTheme(applyTheme, false);
      expect(applyTheme).toHaveBeenCalledWith(false);
      expect(flips).toHaveLength(2);
      transitionTheme(applyTheme, true);
      expect(dark).toBe(false);
      flips[2]();
      expect(dark).toBe(true);
    } finally { stop(); }
  });
});

test("legacy preferences default on and a persisted opt-out reflects on html", () => {
  let raw = '{"schemaVersion":3}';
  const root = { dataset: {} as Record<string,string>, classList: { contains: () => false } };
  globals({ document: { documentElement: root }, window: new EventTarget(),
    localStorage: { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } } }, () => {
    const settings = loadKeatingUiSettings();
    reflectVisualEffects(settings);
    expect(root.dataset.fx).toBe("on");
    const stop = subscribeKeatingUiSettings(reflectVisualEffects);
    saveKeatingUiSettings({ ...settings, visualEffects: false });
    expect(loadKeatingUiSettings().visualEffects).toBe(false);
    expect(root.dataset.fx).toBe("off");
    let changed = false;
    transitionTheme(dark => { changed = dark; });
    expect(changed).toBe(true);
    stop();
  });
});
