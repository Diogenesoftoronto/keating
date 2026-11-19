import { motionReduced } from "../../lib/motion";
import { registerPowerTransition } from "../../theme-sync";
import { paperUniforms, surfaceUniforms, type Point, type SurfaceProps } from "./logic";
import { registerSurface, type SurfaceSpec } from "./manager";

function canvasFor(host: HTMLElement) {
  const canvas = host.ownerDocument.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "keating-fx-canvas";
  return canvas;
}

function track(host: HTMLElement | Window, bounds: HTMLElement, signal: AbortSignal) {
  const pointer: Point = [.5, .5];
  let over = false;
  const move = (event: Event) => {
    if (motionReduced()) return;
    const { clientX, clientY } = event as PointerEvent;
    const rect = bounds.getBoundingClientRect();
    if (rect.width && rect.height) {
      pointer[0] = (clientX - rect.left) / rect.width;
      pointer[1] = (clientY - rect.top) / rect.height;
      over = true;
    }
  };
  host.addEventListener("pointermove", move, { passive: true, signal });
  const leave = host instanceof HTMLElement ? host : document.documentElement;
  leave.addEventListener("pointerleave", () => { over = false; }, { signal });
  return { pointer, heat: () => over && !motionReduced() ? 1 : 0 };
}

export function mountSurface(host: HTMLElement, props: SurfaceProps) {
  const canvas = canvasFor(host);
  const events = new AbortController();
  let pointer: ReturnType<typeof track> | undefined;
  let heat = 0;
  const field = props.effect === "field";
  const surface = registerSurface(canvas, { effect: props.effect, fps: 30, texture: field ? "doodles" : "marble",
    uniforms(frame) {
      heat += ((pointer?.heat() ?? 0) - heat) * .07;
      return surfaceUniforms(props, frame, document.documentElement.classList.contains("dark"), heat, pointer?.pointer ?? [.5, .5]);
    },
  });
  if (!surface) return;
  host.append(canvas);
  if (field && host.parentElement) pointer = track(host.parentElement, host, events.signal);
  return () => { events.abort(); surface.remove(); canvas.remove(); };
}

export function mountOverlay(host: HTMLElement) {
  const canvas = canvasFor(host);
  const events = new AbortController();
  const signal = events.signal;
  const root = document.documentElement;
  const dark = () => root.classList.contains("dark");
  let pointer: ReturnType<typeof track>;
  let heat = 0;
  const trail: Point = [.5, .5];
  const glass: SurfaceSpec = { effect: "crt", fps: 30, uniforms() {
    heat += (pointer.heat() - heat) * .08;
    trail[0] += (pointer.pointer[0] - trail[0]) * .06;
    trail[1] += (pointer.pointer[1] - trail[1]) * .06;
    return { a: [heat, 0, 0, 0], b: [...trail, heat, 0], pointer: pointer.pointer };
  } };
  const paper: SurfaceSpec = { effect: "paper", fps: 0, texture: "paper", uniforms: paperUniforms };
  const surface = registerSurface(canvas, dark() ? glass : paper);
  if (!surface) return;
  canvas.dataset.dark = String(dark());
  host.dataset.fxReady = "";
  host.append(canvas);
  pointer = track(window, canvas, signal);

  const lamp = document.createElement("i");
  lamp.className = "keating-fx-lamp";
  host.append(lamp);
  function lampMove(event: PointerEvent) {
    if (dark() || motionReduced() || host.dataset.power !== undefined) return;
    const hour = new Date().getHours();
    lamp.classList.toggle("warm", hour >= 19 || hour < 6);
    lamp.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
    lamp.style.opacity = "1";
  }
  window.addEventListener("pointermove", lampMove, { passive: true, signal });
  root.addEventListener("pointerleave", () => { lamp.style.opacity = "0"; }, { signal });

  let finish: (() => void) | undefined;
  const restore = () => surface.update(dark() ? glass : paper);
  const unregister = registerPowerTransition((next, apply) => {
    finish?.();
    if (!surface.ready()) { apply(); return; }
    const start = performance.now();
    let applied = false;
    const flip = () => {
      if (!applied) { applied = true; apply(); }
    };
    const end = window.setTimeout(() => finish?.(), 850);
    finish = () => {
      window.clearTimeout(end);
      flip();
      finish = undefined;
      delete host.dataset.power;
      restore();
    };
    surface.update({ effect: "power", fps: 60, uniforms({ now }) {
      host.dataset.power = "";
      const progress = Math.min(1, (now - start) / 850);
      if (progress >= .5) flip();
      return { a: [(1 - Math.cos(progress * Math.PI)) / 2, 0, 0, 0],
        b: next ? [.29, .89, .53, 1] : [.98, .95, .86, 1] };
    } });
  });
  const sync = () => {
    if (motionReduced() || document.hidden || root.dataset.fx === "off") finish?.();
    if (!finish && canvas.dataset.dark !== String(dark())) {
      canvas.dataset.dark = String(dark());
      restore();
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ["class", "data-reduce-motion", "data-fx"] });
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener("change", sync, { signal });
  document.addEventListener("visibilitychange", sync, { signal });
  return () => {
    unregister(); finish?.(); observer.disconnect(); events.abort(); surface.remove();
    lamp.remove(); canvas.remove(); delete host.dataset.fxReady;
  };
}
