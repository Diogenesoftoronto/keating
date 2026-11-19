import { motionReduced } from "../../lib/motion";
import { caps, frameDelay, renderSize, type Frame, type Uniforms } from "./logic";
import type { Effect } from "./programs";
import { createRenderer, type Texture } from "./renderer";

export interface SurfaceSpec {
  effect: Effect;
  fps: number;
  texture?: Texture;
  uniforms(frame: Frame): Uniforms;
}

interface Target {
  spec: SurfaceSpec;
  context: CanvasRenderingContext2D;
  seed: number;
  visible: boolean;
  dirty: boolean;
  last: number;
}

function createManager() {
  const backing = document.createElement("canvas");
  const context = backing.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!context) return null;
  const gl = context;
  const targets = new Map<HTMLCanvasElement, Target>();
  const invalidateTexture = (name: Texture) => {
    for (const target of targets.values()) if (target.spec.texture === name) target.dirty = true;
    schedule();
  };
  let renderer = createRenderer(gl, backing, invalidateTexture);
  if (!renderer) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  let activeAt = performance.now();
  let raf = 0;
  let timer = 0;
  let reduced = motionReduced();
  const events = new AbortController();
  const listener = { signal: events.signal };
  const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    for (const entry of entries) {
      const target = targets.get(entry.target as HTMLCanvasElement);
      if (target) target.visible = entry.isIntersecting;
    }
    schedule();
  });
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    for (const entry of entries) {
      const target = targets.get(entry.target as HTMLCanvasElement);
      if (target) target.dirty = true;
    }
    schedule();
  });

  function delay(t: Target, now: number) {
    const idle = t.spec.effect === "crt" && now - activeAt >= 20_000;
    return frameDelay(t.visible, t.dirty, t.spec.fps, reduced || idle, now - t.last);
  }
  function cancel() {
    window.cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    raf = timer = 0;
  }
  function schedule() {
    cancel();
    if (!renderer || document.hidden || document.documentElement.dataset.fx === "off") return;
    const now = performance.now();
    let next = Infinity;
    for (const t of targets.values()) next = Math.min(next, delay(t, now));
    if (!Number.isFinite(next)) return;
    if (next <= 16) raf = window.requestAnimationFrame(frame);
    else timer = window.setTimeout(() => { raf = window.requestAnimationFrame(frame); }, next - 12);
  }
  function frame(now: number) {
    if (!renderer || document.hidden || document.documentElement.dataset.fx === "off") return;
    for (const [canvas, target] of targets) {
      if (delay(target, now) > 0.5) continue;
      const spec = target.spec;
      const bounds = canvas.getBoundingClientRect();
      const size = renderSize(bounds.width, bounds.height, window.devicePixelRatio, caps[spec.effect]);
      target.dirty = false;
      target.last = now;
      if (!size.width || !size.height) continue;
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      const texture = renderer.texture(spec.texture);
      const uniforms = spec.uniforms({ now, scale: size.scale, textured: Boolean(texture) });
      renderer.draw(target.context, spec.effect, uniforms, reduced ? 0 : now / 1000, target.seed, texture);
    }
    schedule();
  }
  function dirtyAll() {
    reduced = motionReduced();
    for (const target of targets.values()) target.dirty = true;
    schedule();
  }
  function activity() {
    const wasIdle = performance.now() - activeAt >= 20_000;
    activeAt = performance.now();
    if (wasIdle) schedule();
  }
  window.addEventListener("pointermove", activity, listener);
  window.addEventListener("pointerdown", activity, listener);
  window.addEventListener("keydown", activity, listener);
  window.addEventListener("resize", dirtyAll, listener);
  document.addEventListener("visibilitychange", schedule, listener);
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener("change", dirtyAll, listener);
  const preferences = new MutationObserver(dirtyAll);
  preferences.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-reduce-motion", "data-fx"] });

  backing.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    cancel();
    renderer?.dispose();
    renderer = null;
    for (const [canvas, target] of targets) {
      target.context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.parentElement?.removeAttribute("data-fx-ready");
    }
  }, listener);
  backing.addEventListener("webglcontextrestored", () => {
    renderer = createRenderer(gl, backing, invalidateTexture);
    if (renderer) {
      for (const canvas of targets.keys()) canvas.parentElement?.setAttribute("data-fx-ready", "");
      dirtyAll();
    }
  }, listener);

  function dispose() {
    cancel();
    events.abort();
    io?.disconnect();
    resize?.disconnect();
    preferences.disconnect();
    renderer?.dispose();
    renderer = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    shared = null;
  }
  return {
    get empty() { return targets.size === 0; },
    dispose,
    add(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, spec: SurfaceSpec) {
      const target: Target = { spec, context, seed: Math.random(), visible: !io, dirty: true, last: 0 };
      targets.set(canvas, target);
      io?.observe(canvas);
      resize?.observe(canvas);
      schedule();
      return {
        ready: () => !!renderer && target.visible && !gl.isContextLost(),
        update(next: SurfaceSpec) { target.spec = next; target.dirty = true; schedule(); },
        remove() {
          io?.unobserve(canvas);
          resize?.unobserve(canvas);
          targets.delete(canvas);
          if (!targets.size) dispose();
          else schedule();
        },
      };
    },
  };
}
let shared: ReturnType<typeof createManager> = null;

export function registerSurface(canvas: HTMLCanvasElement, spec: SurfaceSpec) {
  if (document.documentElement.dataset.fx === "off") return null;
  shared ??= createManager();
  if (!shared) return null;
  const context = canvas.getContext("2d");
  if (!context) {
    if (shared.empty) shared.dispose();
    return null;
  }
  return shared.add(canvas, context, spec);
}
