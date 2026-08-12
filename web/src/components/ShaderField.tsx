import { useEffect, useRef } from "react";
import { css, cx } from "../../styled-system/css";
import { useReducedMotion } from "../hooks/use-media-query";

/**
 * Animated halftone texture rendered with a single WebGL fragment shader.
 *
 * The field is a domain-warped fBm sampled through a rotated dot screen, so it
 * reads as CRT phosphor on dark surfaces and as printed screen tone on paper —
 * the two halves of the Keating look, drawn by the same maths. A slow bright
 * band sweeps down the field like a refresh scan.
 *
 * It is deliberately cheap: the canvas renders at a fraction of layout size and
 * is capped in absolute pixels, the loop only runs while the element is on
 * screen and the tab is visible, and reduced-motion draws one static frame.
 */

const VERT_SOURCE = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uCell;
uniform float uRadial;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    total += amp * valueNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return total;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 skewed = vec2(uv.x * aspect, uv.y);

  // Domain warp: sample the field through an offset copy of itself so the
  // density drifts and curls instead of sliding as a flat plane.
  vec2 drift = vec2(uTime * 0.014, uTime * -0.009);
  vec2 warp = vec2(
    fbm(skewed * 1.7 + drift),
    fbm(skewed * 1.7 + drift + vec2(4.7, 2.3))
  );
  float field = fbm(skewed * 2.3 + warp * 1.35 + drift * 2.0);

  // Refresh sweep: a soft band travelling down the field.
  float sweep = fract(uv.y * 0.75 - uTime * 0.05);
  field += 0.2 * smoothstep(0.0, 0.12, sweep) * (1.0 - smoothstep(0.12, 0.3, sweep));

  // Fade toward the edges so the texture never collides with the frame.
  float edge = 1.0 - smoothstep(0.62, 1.02, length((uv - 0.5) * vec2(aspect, 1.0)) * 1.45);
  float falloff = mix(1.0, edge, uRadial);

  // Rotated dot screen. The grid is stepped in pixels, not in uv, so the dots
  // stay round whatever shape the element is, and the classic halftone angle
  // keeps them off the page's own horizontals and verticals.
  float ca = cos(0.4);
  float sa = sin(0.4);
  float cellPx = max(uRes.x / uCell, 2.0);
  vec2 px = gl_FragCoord.xy / cellPx;
  vec2 screenUv = vec2(px.x * ca - px.y * sa, px.x * sa + px.y * ca);
  float dist = length(fract(screenUv) - 0.5);

  float radius = 0.52 * smoothstep(0.18, 0.92, field) * uIntensity * falloff;
  float alpha = 1.0 - smoothstep(radius - 0.14, radius, dist);

  gl_FragColor = vec4(uColor * alpha, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** `#rrggbb` (or `#rgb`) → normalised rgb triple. Falls back to phosphor green. */
function parseHex(value: string): [number, number, number] {
  const hex = value.trim().replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (full.length < 6) return [0.29, 0.89, 0.53];
  const int = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(int)) return [0.29, 0.89, 0.53];
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

export interface ShaderFieldProps {
  /** CSS custom property the dot colour is read from, so themes carry through. */
  colorVar?: string;
  /** Dots across the element's width — higher means a finer screen. */
  density?: number;
  /** Peak dot coverage, 0–1. */
  intensity?: number;
  /** Fade the field toward the edges (on by default). */
  radial?: boolean;
  /** Overall strength of the layer. */
  opacity?: number;
  className?: string;
}

export function ShaderField({
  colorVar = "--accent-green",
  density = 74,
  intensity = 1,
  radial = true,
  opacity = 0.45,
  className,
}: ShaderFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    }) as WebGLRenderingContext | null;
    // No WebGL (or a blocked context): leave the canvas transparent.
    if (!context) return;
    // Rebound as a non-nullable const so the hoisted helpers below keep the narrowing.
    const gl: WebGLRenderingContext = context;

    const vert = compile(gl, gl.VERTEX_SHADER, VERT_SOURCE);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG_SOURCE);
    const program = vert && frag ? gl.createProgram() : null;
    if (!vert || !frag || !program) return;

    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One oversized triangle covers the viewport with no index buffer.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uColor = gl.getUniformLocation(program, "uColor");
    const uIntensity = gl.getUniformLocation(program, "uIntensity");
    const uCell = gl.getUniformLocation(program, "uCell");
    const uRadial = gl.getUniformLocation(program, "uRadial");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(uIntensity, intensity);
    gl.uniform1f(uCell, density);
    gl.uniform1f(uRadial, radial ? 1 : 0);

    function applyColor() {
      const raw = getComputedStyle(canvas as HTMLCanvasElement).getPropertyValue(colorVar);
      const [r, g, b] = parseHex(raw || "#4be388");
      gl.uniform3f(uColor, r, g, b);
    }
    applyColor();

    let width = 0;
    let height = 0;
    function resize() {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Render small: this is soft texture, and the dot screen survives upscaling.
      const scale = Math.min(0.5, 900 / Math.max(rect.width, 1));
      const next = { w: Math.max(1, Math.round(rect.width * scale)), h: Math.max(1, Math.round(rect.height * scale)) };
      if (next.w === width && next.h === height) return;
      width = next.w;
      height = next.h;
      el.width = width;
      el.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
    }

    let frame = 0;
    let start = 0;
    let onScreen = true;
    let running = false;

    function draw(time: number) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function tick(now: number) {
      if (!running) return;
      if (!start) start = now;
      resize();
      draw((now - start) / 1000);
      frame = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    function sync() {
      const shouldRun = onScreen && !document.hidden && !reducedMotion;
      if (shouldRun === running) return;
      if (shouldRun) {
        running = true;
        frame = requestAnimationFrame(tick);
      } else {
        stop();
      }
    }

    // Reduced motion still gets the texture — just frozen.
    resize();
    draw(0);

    const observer =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            ([entry]) => {
              onScreen = entry.isIntersecting;
              sync();
            },
            { rootMargin: "120px" },
          )
        : null;
    observer?.observe(canvas);
    if (!observer) sync();

    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);

    const resizeObserver =
      "ResizeObserver" in window
        ? new ResizeObserver(() => {
            resize();
            if (!running) draw(0);
          })
        : null;
    resizeObserver?.observe(canvas);

    // Repaint with the new ink when the theme flips.
    const themeObserver = new MutationObserver(() => {
      applyColor();
      if (!running) draw(0);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    if (document.body) {
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }

    return () => {
      stop();
      observer?.disconnect();
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, [colorVar, density, intensity, radial, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ opacity }}
      className={cx(
        css({
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }),
        className,
      )}
    />
  );
}
