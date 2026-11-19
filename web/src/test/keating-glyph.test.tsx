import { expect, mock, test } from "bun:test";
import type { animate } from "motion";
import { renderToStaticMarkup } from "react-dom/server";
import { GLYPHS, GLYPH_NAMES, KeatingGlyph, playGlyph } from "../design-system/glyphs";
import { bindGlyph } from "../design-system/glyphs/runtime";
import type { GlyphNode } from "../design-system/glyphs/types";
import { motionAllowed } from "../design-system/motion";

test("all 119 glyphs render SVGs and every animated part exists in the drawing", () => {
  expect(GLYPH_NAMES).toHaveLength(119);
  for (const name of GLYPH_NAMES) {
    const { nodes, play, hold, loop, press } = GLYPHS[name];
    const svg = renderToStaticMarkup(<KeatingGlyph name={name} />);
    expect(svg).toStartWith("<svg ");
    expect(svg).toContain(`data-glyph="${name}"`);
    const parts = new Set<string>();
    function visit(node: GlyphNode) {
      if (node.part) parts.add(node.part);
      node.children?.forEach(visit);
    }
    nodes.forEach(visit);
    for (const steps of [play, hold, loop, press]) {
      for (const [targets] of steps ?? []) {
        for (const part of targets.split(",")) {
          expect(parts.has(part), `${name}/${part}`).toBe(true);
          expect(svg).toContain(`data-p="${part}"`);
        }
      }
    }
  }
});

test("size controls stroke weight at each threshold and accepts an override", () => {
  for (const [size, weight] of [[12, 2.1], [13, 2.1], [14, 1.9], [16, 1.9], [17, 1.8], [31, 1.8], [32, 1.7], [40, 1.7]]) {
    const svg = renderToStaticMarkup(<KeatingGlyph name="check" size={size} />);
    expect(svg).toContain(`stroke-width="${weight}"`);
    expect(svg).toContain(`width="${size}"`);
  }
  expect(renderToStaticMarkup(<KeatingGlyph name="send" strokeWidth={3} />)).toContain('stroke-width="3"');
});

test("a label exposes the SVG as an image and decorative glyphs are hidden", () => {
  const labelled = renderToStaticMarkup(<KeatingGlyph name="check" label="Copied" />);
  expect(labelled).toContain('role="img"');
  expect(labelled).toContain('aria-label="Copied"');
  expect(labelled).not.toContain("aria-hidden");
  expect(renderToStaticMarkup(<KeatingGlyph name="check" />)).toContain('aria-hidden="true"');
});

// Bun supplies EventTarget. Model just the element and media-query signals needed by the binding.
class TestElement extends EventTarget {
  attributes = new Map<string, string>();
  host?: TestElement;
  focused = false;
  closest() { return this.host; }
  matches(selector: string) { return selector === ":focus-visible" && this.focused; }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  toggleAttribute(key: string, on: boolean) {
    if (on) this.attributes.set(key, "");
    else this.attributes.delete(key);
  }
  querySelectorAll() { return [this]; }
}

test("OS and learner reduced motion preserve hover, focus, selection and feedback without starting animation", () => {
  const root = new TestElement();
  const host = new TestElement();
  const element = new TestElement();
  element.host = host;
  const svg = element as unknown as SVGSVGElement;
  let osReduced = false;
  let onMutation = () => {};
  const observedWindow = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: osReduced }) });
  const replacements = {
    window: observedWindow, document: { documentElement: root },
    MutationObserver: class {
      constructor(callback: () => void) { onMutation = callback; }
      observe() {}
      disconnect() {}
    },
  };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const stop = mock(() => {});
  const animation = mock(() => ({ stop }));
  let binding: ReturnType<typeof bindGlyph> | undefined;
  const lit = () => element.attributes.has("data-lit");
  try {
    for (const [key, value] of Object.entries(replacements)) {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    binding = bindGlyph(svg, animation as unknown as typeof animate);
    for (const source of ["os", "learner"]) {
      osReduced = source === "os";
      root.attributes.set("data-reduce-motion", String(!osReduced));
      expect(motionAllowed()).toBe(false);
      binding.update("send", motionAllowed(), false);
      host.dispatchEvent(new Event("pointerenter"));
      expect(lit()).toBe(true);
      host.focused = true;
      host.dispatchEvent(new Event("focusin"));
      host.dispatchEvent(new Event("pointerleave"));
      expect(lit()).toBe(true);
      host.focused = false;
      host.dispatchEvent(new Event("focusout"));
      expect(lit()).toBe(false);
      host.dispatchEvent(new Event("pointerdown"));
      expect(lit()).toBe(true);
      observedWindow.dispatchEvent(new Event("pointerup"));
      expect(lit()).toBe(false);
      for (const key of ["aria-selected", "aria-pressed", "aria-current"]) {
        host.attributes.set(key, "true");
        onMutation();
        expect(lit()).toBe(true);
        host.attributes.delete(key);
        onMutation();
        expect(lit()).toBe(false);
      }
      binding.update("send", false, true);
      expect(lit()).toBe(true);
      binding.update("kmark", false, false);
      expect(lit()).toBe(false);
      playGlyph(svg);
      expect(lit()).toBe(true);
      binding.update("check", false, false);
      expect(lit()).toBe(false);
    }
    expect(animation).not.toHaveBeenCalled();
    root.attributes.clear();
    expect(motionAllowed()).toBe(true);
    binding.update("kmark", true, false);
    expect(animation).toHaveBeenCalledTimes(1);
    binding.update("check", true, false);
    expect(stop).toHaveBeenCalledTimes(1);
    host.dispatchEvent(new Event("pointerenter"));
    expect(animation).toHaveBeenCalledTimes(2);
    binding.dispose();
    binding = undefined;
    host.dispatchEvent(new Event("pointerenter"));
    playGlyph(svg);
    expect(animation).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(2);
  } finally {
    binding?.dispose();
    for (const key of Object.keys(replacements)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
