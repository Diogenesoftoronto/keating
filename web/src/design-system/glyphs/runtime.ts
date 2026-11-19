import { animate, hover, stagger, type AnimationOptions, type DOMSegmentWithTransition } from "motion";
import { DURATION, EASE, motionAllowed, SOFT, SPRING } from "../motion";
import { GLYPHS, type GlyphName } from "./data";
import type { GlyphFrames, GlyphProperty, GlyphStep } from "./types";

const hosts = "button,a,[role=tab],[role=menuitem],[role=option],summary,[data-glyph-host]";
const selected = ["aria-selected", "aria-current", "aria-pressed"];
const rest = { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, pathLength: 1 };
const players = new WeakMap<SVGSVGElement, () => void>();

export function playGlyph(svg: SVGSVGElement) {
  players.get(svg)?.();
}

export function bindGlyph(svg: SVGSVGElement, startAnimation = animate) {
  const host = svg.closest(hosts) ?? svg;
  const events = new AbortController();
  const running = new Map<string, ReturnType<typeof animate>[]>();
  let name: GlyphName | undefined;
  let allowed = false;
  let active = false;
  let focused = host.matches(":focus-visible");
  let hovered = host.matches(":hover");
  let pressed = false;
  let feedback: ReturnType<typeof setTimeout> | undefined;
  const engaged = () => hovered || focused || feedback !== undefined;
  const canMove = () => allowed && motionAllowed();

  function light() {
    svg.toggleAttribute("data-lit", active || engaged() || pressed || selected.some(attr => host.getAttribute(attr) === "true"));
  }

  function stop(track: string) {
    running.get(track)?.forEach(animation => animation.stop());
    running.delete(track);
  }

  function parts(names: string) {
    return names.split(",").flatMap(part => Array.from(svg.querySelectorAll<SVGElement>(`[data-p="${part}"]`)));
  }

  function run(track: string, steps: GlyphStep[] = [], base: AnimationOptions = {}, release = false) {
    stop(track);
    if (!steps.length || !canMove()) return;
    const animations = steps.map(([targets, frames, options = {}]) => {
      if (release) {
        const resting: GlyphFrames = {};
        for (const key of Object.keys(frames) as GlyphProperty[]) resting[key] = rest[key];
        return startAnimation(parts(targets), resting, SOFT);
      }
      const { stagger: interval, start, at: _at, ...transition } = options;
      if (interval === undefined) return startAnimation(parts(targets), frames, { ...base, ...transition });
      return startAnimation(parts(targets), frames, { ...base, ...transition, delay: stagger(interval, { startDelay: start }) });
    });
    running.set(track, animations);
  }

  function interact(enter: boolean) {
    if (!name) return;
    const glyph = GLYPHS[name];
    if (enter) {
      stop("release");
      run("play", glyph.play, { duration: DURATION.play, ease: EASE });
      run("hold", glyph.hold, SPRING);
      run("loop", glyph.loop, { duration: DURATION.loop, ease: "easeInOut", repeat: Infinity });
    } else {
      stop("hold");
      stop("loop");
      run("release", [...glyph.hold ?? [], ...glyph.loop ?? []], SOFT, true);
    }
  }

  function change(update: () => void) {
    const before = engaged();
    update();
    light();
    if (before !== engaged()) interact(!before);
  }

  const unhover = hover(host, () => {
    change(() => { hovered = true; });
    return () => change(() => { hovered = false; });
  });
  // A glyph may mount under a pointer that was already over its host.
  if (hovered) host.addEventListener("pointerleave", () => change(() => { hovered = false; }), { once: true, signal: events.signal });
  host.addEventListener("focusin", () => change(() => { focused = host.matches(":focus-visible"); }), events);
  host.addEventListener("focusout", () => change(() => { focused = false; }), events);

  function releasePress() {
    pressed = false;
    light();
    window.removeEventListener("pointerup", releasePress);
    window.removeEventListener("pointercancel", releasePress);
  }
  host.addEventListener("pointerdown", () => {
    pressed = true;
    light();
    window.addEventListener("pointerup", releasePress);
    window.addEventListener("pointercancel", releasePress);
    const steps = name && GLYPHS[name].press;
    if (!steps || !canMove()) return;
    stop("press");
    const sequence: DOMSegmentWithTransition[] = steps.map(([targets, frames, options]) =>
      [parts(targets), frames, { ease: EASE, ...options }]);
    running.set("press", [startAnimation(sequence)]);
  }, events);

  const observer = new MutationObserver(light);
  observer.observe(host, { attributes: true, attributeFilter: selected });
  players.set(svg, () => {
    clearTimeout(feedback);
    feedback = setTimeout(() => change(() => { feedback = undefined; }), 1000);
    light();
    interact(true);
  });

  return {
    update(next: GlyphName, nextAllowed: boolean, nextActive: boolean) {
      active = nextActive;
      if (name !== next || allowed !== nextAllowed) {
        for (const track of running.keys()) stop(track);
        if (name !== next) {
          clearTimeout(feedback);
          feedback = undefined;
        }
        name = next;
        allowed = nextAllowed;
        if (engaged()) interact(true);
        if (name === "kmark" && canMove()) {
          running.set("morse", [startAnimation(parts("px"), { opacity: [1,1,0,0,1,1,0,0,1,1,0,0] }, {
            duration: 2.9, times: [0,.186,.188,.249,.251,.311,.313,.374,.376,.561,.563,1], ease: "linear", repeat: Infinity,
          })]);
        }
      }
      light();
    },
    dispose() {
      unhover();
      events.abort();
      releasePress();
      observer.disconnect();
      clearTimeout(feedback);
      players.delete(svg);
      for (const track of running.keys()) stop(track);
    },
  };
}
