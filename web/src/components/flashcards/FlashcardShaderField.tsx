import { useEffect, useRef } from "react";

import { css, cx } from "../../../styled-system/css";
import { useReducedMotion } from "../../hooks/use-media-query";
import type { FlashcardShaderPreset } from "./game";

const VERTEX_SOURCE = `
attribute vec2 aPosition;

void main() {
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uEnergy;
uniform float uSeed;
uniform vec3 uColorA;
uniform vec3 uColorB;

float hash21(vec2 point) {
	return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 point) {
	vec2 cell = floor(point);
	vec2 local = fract(point);
	vec2 curve = local * local * (3.0 - 2.0 * local);
	float a = hash21(cell);
	float b = hash21(cell + vec2(1.0, 0.0));
	float c = hash21(cell + vec2(0.0, 1.0));
	float d = hash21(cell + vec2(1.0, 1.0));
	return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

float fbm(vec2 point) {
	float total = 0.0;
	float amplitude = 0.55;
	for (int octave = 0; octave < 3; octave++) {
		total += valueNoise(point) * amplitude;
		point = point * 2.03 + 0.17;
		amplitude *= 0.5;
	}
	return total;
}

float ring(vec2 point, float radius, float width) {
	return 1.0 - smoothstep(width, width + 0.015, abs(length(point) - radius));
}

void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 uv = gl_FragCoord.xy / resolution;
	float aspect = resolution.x / resolution.y;
	vec2 centered = (uv - 0.5) * vec2(aspect, 1.0);
	vec2 seeded = centered + vec2(sin(uSeed * 1.37), cos(uSeed * 0.91)) * 0.24;
	float energy = clamp(uEnergy, 0.0, 1.0);
	vec3 color = vec3(0.0);
	float alpha = 0.0;

	if (uMode < 0.5) {
		// Phosphor: a warped dot matrix plus one slow vertical refresh band.
		vec2 drift = vec2(uTime * 0.035, uTime * -0.018) + uSeed * 0.07;
		float field = fbm(seeded * 3.2 + drift);
		vec2 cells = fract(gl_FragCoord.xy / 7.0) - 0.5;
		float dots = 1.0 - smoothstep(0.16, 0.48, length(cells));
		float refresh = smoothstep(0.0, 0.14, fract(uv.y - uTime * 0.075))
			* (1.0 - smoothstep(0.14, 0.34, fract(uv.y - uTime * 0.075)));
		alpha = dots * (0.14 + field * (0.42 + energy * 0.12) + refresh * 0.28);
		color = mix(uColorA, uColorB, clamp(field + refresh * 0.35, 0.0, 1.0));
	} else if (uMode < 1.5) {
		// Solar: heat ripples travel away from an off-centre energy source.
		vec2 source = seeded - vec2(-0.26, 0.12);
		float radius = length(source);
		float turbulence = fbm(seeded * 3.4 + vec2(uTime * 0.055, 0.0));
		float bands = 0.5 + 0.5 * sin(radius * 27.0 - uTime * 1.65 + turbulence * 4.2);
		float flare = exp(-radius * (2.85 - energy * 0.45));
		float horizon = exp(-abs(centered.y + sin(centered.x * 2.4 + uTime * 0.22) * 0.08) * 9.0);
		alpha = clamp(flare * 0.38 + bands * flare * (0.38 + energy * 0.1) + horizon * 0.2, 0.0, 0.86);
		color = mix(uColorA, uColorB, clamp(bands * 0.68 + turbulence * 0.32, 0.0, 1.0));
	} else if (uMode < 2.5) {
		// Orbit: sparse stars and instrument rings. Motion is intentionally slow.
		vec2 starGrid = seeded * 21.0;
		vec2 starCell = floor(starGrid);
		vec2 starLocal = fract(starGrid) - 0.5;
		float starSeed = hash21(starCell + uSeed);
		float stars = step(0.92 - energy * 0.035, starSeed)
			* (1.0 - smoothstep(0.025, 0.14, length(starLocal)))
			* (0.52 + 0.48 * sin(uTime * 0.9 + starSeed * 12.0));

		float angle = uTime * 0.09 + uSeed * 0.15;
		mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
		vec2 orbitPoint = rotation * centered;
		float rings = ring(orbitPoint * vec2(1.0, 1.42), 0.31, 0.012)
			+ ring(orbitPoint * vec2(1.0, 1.42), 0.48, 0.009);
		float crosshair = (1.0 - smoothstep(0.0, 0.006, abs(centered.x)))
			* (1.0 - smoothstep(0.2, 0.58, abs(centered.y)));
		alpha = clamp(stars * 0.76 + rings * (0.3 + energy * 0.12) + crosshair * 0.12, 0.0, 0.8);
		color = mix(uColorA, uColorB, clamp(length(centered) * 1.4, 0.0, 1.0));
	} else if (uMode < 3.5) {
		// Prism: hard mirrored shards with angular wipes, unlike the organic fields.
		float radius = length(seeded);
		float angle = atan(seeded.y, seeded.x);
		float mirrored = abs(fract(angle / 6.2831853 * 6.0 + uTime * 0.035) * 2.0 - 1.0);
		float spoke = 1.0 - smoothstep(0.035, 0.12, abs(sin(angle * 6.0 + radius * 8.0 - uTime * 0.65)));
		float facets = step(0.58, fract(mirrored * 3.0 + radius * 2.3 + uTime * 0.08));
		float wipe = 1.0 - smoothstep(0.025, 0.1, abs(fract(radius * 5.0 - uTime * 0.18) - 0.5));
		alpha = clamp(spoke * (0.25 + facets * 0.48) + wipe * (0.08 + energy * 0.18), 0.0, 0.82);
		color = mix(uColorA, uColorB, clamp(mirrored * 0.7 + facets * 0.3, 0.0, 1.0));
	} else if (uMode < 4.5) {
		// Current: two travelling filaments, interference nodes, and brief sparks.
		float turbulence = fbm(vec2(seeded.x * 2.2 - uTime * 0.18, seeded.y * 3.4 + uSeed));
		float pathA = 0.22 * sin(seeded.x * 7.0 + uTime * 1.2 + turbulence * 3.1);
		float pathB = -0.24 * sin(seeded.x * 5.2 - uTime * 0.94 + turbulence * 2.7);
		float filamentA = 1.0 - smoothstep(0.018, 0.07, abs(seeded.y - pathA));
		float filamentB = 1.0 - smoothstep(0.018, 0.075, abs(seeded.y - pathB));
		float nodes = filamentA * filamentB * (0.55 + 0.45 * sin(uTime * 5.0 + seeded.x * 19.0));
		vec2 sparkGrid = fract((seeded + vec2(uTime * 0.28, 0.0)) * vec2(17.0, 12.0)) - 0.5;
		float sparks = step(0.965 - energy * 0.025, hash21(floor((seeded + uTime * 0.03) * 14.0) + uSeed))
			* (1.0 - smoothstep(0.02, 0.14, length(sparkGrid)));
		alpha = clamp((filamentA + filamentB) * (0.3 + energy * 0.13) + nodes * 0.45 + sparks * 0.75, 0.0, 0.86);
		color = mix(uColorA, uColorB, clamp(filamentB + nodes, 0.0, 1.0));
	} else {
		// Contour: quantised fBm becomes a scrolling topographic map.
		float height = fbm(seeded * 4.1 + vec2(uTime * 0.05, -uTime * 0.035));
		float fineHeight = fbm(seeded * 8.2 - vec2(uTime * 0.025, uTime * 0.018));
		float elevation = height * 0.78 + fineHeight * 0.22;
		float contourDistance = abs(fract(elevation * (9.0 + energy * 3.0)) - 0.5);
		float contours = 1.0 - smoothstep(0.035, 0.11, contourDistance);
		float indexLine = 1.0 - smoothstep(0.018, 0.065, abs(fract(elevation * 3.0) - 0.5));
		alpha = clamp(contours * 0.48 + indexLine * 0.25, 0.0, 0.74);
		color = mix(uColorA, uColorB, smoothstep(0.25, 0.82, elevation));
	}

	float vignette = 1.0 - smoothstep(0.45, 0.9, length(centered));
	gl_FragColor = vec4(color * alpha, alpha * (0.42 + vignette * 0.58));
}
`;

const PRESET_CONFIG: Record<Exclude<FlashcardShaderPreset, "still">, {
	mode: number;
	speed: number;
	primaryVar: string;
	secondaryVar: string;
	primaryFallback: string;
	secondaryFallback: string;
}> = {
	phosphor: {
		mode: 0,
		speed: 0.8,
		primaryVar: "--accent-green",
		secondaryVar: "--phosphor",
		primaryFallback: "#1e9b50",
		secondaryFallback: "#4be388",
	},
	solar: {
		mode: 1,
		speed: 0.72,
		primaryVar: "--amber",
		secondaryVar: "--red",
		primaryFallback: "#e8a33d",
		secondaryFallback: "#d95f4f",
	},
	orbit: {
		mode: 2,
		speed: 0.62,
		primaryVar: "--accent-green",
		secondaryVar: "--amber",
		primaryFallback: "#4be388",
		secondaryFallback: "#e8a33d",
	},
	prism: {
		mode: 3,
		speed: 0.92,
		primaryVar: "--red",
		secondaryVar: "--phosphor",
		primaryFallback: "#d95f4f",
		secondaryFallback: "#4be388",
	},
	current: {
		mode: 4,
		speed: 1.08,
		primaryVar: "--phosphor",
		secondaryVar: "--flashcard-cyan",
		primaryFallback: "#4be388",
		secondaryFallback: "#67d7e8",
	},
	contour: {
		mode: 5,
		speed: 0.56,
		primaryVar: "--amber",
		secondaryVar: "--accent-green",
		primaryFallback: "#e8a33d",
		secondaryFallback: "#4be388",
	},
};

const PRESET_BACKGROUNDS: Record<FlashcardShaderPreset, string> = {
	phosphor: "radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent-green) 15%, transparent), transparent 62%), var(--crt)",
	solar: "radial-gradient(circle at 18% 35%, color-mix(in srgb, var(--amber) 24%, transparent), transparent 54%), var(--crt)",
	orbit: "radial-gradient(circle at 65% 45%, color-mix(in srgb, var(--accent-green) 13%, transparent), transparent 56%), var(--crt)",
	prism: "conic-gradient(from 210deg at 48% 48%, color-mix(in srgb, var(--red) 15%, var(--crt)), var(--crt) 30%, color-mix(in srgb, var(--phosphor) 12%, var(--crt)) 64%, var(--crt))",
	current: "linear-gradient(160deg, color-mix(in srgb, #67d7e8 11%, var(--crt)), var(--crt) 44%, color-mix(in srgb, var(--phosphor) 11%, var(--crt)))",
	contour: "radial-gradient(ellipse at 42% 52%, color-mix(in srgb, var(--amber) 12%, transparent), transparent 62%), var(--crt)",
	still: "linear-gradient(145deg, color-mix(in srgb, var(--crt) 92%, var(--accent-green)), var(--crt))",
};

function compileShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string,
): WebGLShader | null {
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

function parseCssColor(value: string, fallback: string): [number, number, number] {
	const candidate = value.trim() || fallback;
	const hex = candidate.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
	if (hex) {
		const full = hex.length === 3
			? hex.split("").map((character) => character + character).join("")
			: hex;
		const integer = Number.parseInt(full, 16);
		return [
			((integer >> 16) & 255) / 255,
			((integer >> 8) & 255) / 255,
			(integer & 255) / 255,
		];
	}
	const rgb = candidate.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
	if (rgb) {
		return [
			Math.min(255, Number(rgb[1])) / 255,
			Math.min(255, Number(rgb[2])) / 255,
			Math.min(255, Number(rgb[3])) / 255,
		];
	}
	return parseCssColor(fallback, "#4be388");
}

export interface FlashcardShaderFieldProps {
	preset: FlashcardShaderPreset;
	/** 0..1 visual response to the current recall streak. */
	energy?: number;
	/** Stable per-deck/card offset so repeated presets do not render identically. */
	seed?: number;
	className?: string;
}

export function FlashcardShaderField({
	preset,
	energy = 0,
	seed = 0,
	className,
}: FlashcardShaderFieldProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const reducedMotion = useReducedMotion();

	useEffect(() => {
		if (preset === "still") return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("webgl", {
			alpha: true,
			antialias: false,
			depth: false,
			premultipliedAlpha: true,
			powerPreference: "low-power",
		}) as WebGLRenderingContext | null;
		if (!context) return;
		const gl = context;
		const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
		const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
		if (!vertex || !fragment) {
			if (vertex) gl.deleteShader(vertex);
			if (fragment) gl.deleteShader(fragment);
			return;
		}
		const program = gl.createProgram();
		if (!program) {
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
			return;
		}
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			gl.deleteProgram(program);
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
			return;
		}
		gl.useProgram(program);

		const vertices = gl.createBuffer();
		if (!vertices) {
			gl.deleteProgram(program);
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
			return;
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 3, -1, -1, 3]),
			gl.STATIC_DRAW,
		);
		const position = gl.getAttribLocation(program, "aPosition");
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		const resolution = gl.getUniformLocation(program, "uResolution");
		const time = gl.getUniformLocation(program, "uTime");
		const mode = gl.getUniformLocation(program, "uMode");
		const energyUniform = gl.getUniformLocation(program, "uEnergy");
		const seedUniform = gl.getUniformLocation(program, "uSeed");
		const colorA = gl.getUniformLocation(program, "uColorA");
		const colorB = gl.getUniformLocation(program, "uColorB");
		const config = PRESET_CONFIG[preset];
		gl.uniform1f(mode, config.mode);
		gl.uniform1f(energyUniform, Math.max(0, Math.min(1, energy)));
		gl.uniform1f(seedUniform, Number.isFinite(seed) ? seed : 0);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

		const applyColors = () => {
			const computed = getComputedStyle(canvas);
			const primary = parseCssColor(
				computed.getPropertyValue(config.primaryVar),
				config.primaryFallback,
			);
			const secondary = parseCssColor(
				computed.getPropertyValue(config.secondaryVar),
				config.secondaryFallback,
			);
			gl.uniform3f(colorA, primary[0], primary[1], primary[2]);
			gl.uniform3f(colorB, secondary[0], secondary[1], secondary[2]);
		};
		applyColors();

		let width = 0;
		let height = 0;
		const resize = () => {
			const bounds = canvas.getBoundingClientRect();
			if (bounds.width <= 0 || bounds.height <= 0) return;
			const scale = Math.min(0.55, 760 / Math.max(bounds.width, 1));
			const nextWidth = Math.max(1, Math.round(bounds.width * scale));
			const nextHeight = Math.max(1, Math.round(bounds.height * scale));
			if (nextWidth === width && nextHeight === height) return;
			width = nextWidth;
			height = nextHeight;
			canvas.width = width;
			canvas.height = height;
			gl.viewport(0, 0, width, height);
			gl.uniform2f(resolution, width, height);
		};

		const draw = (seconds: number) => {
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.uniform1f(time, seconds * config.speed);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		};

		let animationFrame = 0;
		let startedAt = 0;
		let visible = true;
		let running = false;
		const stop = () => {
			running = false;
			if (animationFrame) cancelAnimationFrame(animationFrame);
			animationFrame = 0;
		};
		const tick = (now: number) => {
			if (!running) return;
			if (!startedAt) startedAt = now;
			resize();
			draw((now - startedAt) / 1000);
			animationFrame = requestAnimationFrame(tick);
		};
		const sync = () => {
			const shouldRun = visible && !document.hidden && !reducedMotion;
			if (shouldRun === running) return;
			if (shouldRun) {
				running = true;
				animationFrame = requestAnimationFrame(tick);
			} else {
				stop();
			}
		};

		resize();
		draw(reducedMotion ? 8 : 0);

		const intersectionObserver = "IntersectionObserver" in window
			? new IntersectionObserver(([entry]) => {
					visible = entry?.isIntersecting ?? false;
					sync();
				}, { rootMargin: "96px" })
			: null;
		intersectionObserver?.observe(canvas);
		if (!intersectionObserver) sync();

		const resizeObserver = "ResizeObserver" in window
			? new ResizeObserver(() => {
					resize();
					if (!running) draw(reducedMotion ? 8 : 0);
				})
			: null;
		resizeObserver?.observe(canvas);

		const themeObserver = typeof MutationObserver === "undefined"
			? null
			: new MutationObserver(() => {
					applyColors();
					if (!running) draw(reducedMotion ? 8 : 0);
				});
		themeObserver?.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		const handleVisibility = () => sync();
		document.addEventListener("visibilitychange", handleVisibility);

		return () => {
			stop();
			intersectionObserver?.disconnect();
			resizeObserver?.disconnect();
			themeObserver?.disconnect();
			document.removeEventListener("visibilitychange", handleVisibility);
			gl.deleteBuffer(vertices);
			gl.deleteProgram(program);
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
		};
	}, [energy, preset, reducedMotion, seed]);

	return (
		<div
			aria-hidden="true"
			data-shader-preset={preset}
			className={cx(
				"flashcard-shader-field",
				css({
					position: "absolute",
					inset: 0,
					overflow: "hidden",
					pointerEvents: "none",
					background: PRESET_BACKGROUNDS[preset],
				}),
				className,
			)}
		>
			{preset === "still" ? null : (
				<canvas
					ref={canvasRef}
					className={css({
						display: "block",
						width: "100%",
						height: "100%",
						opacity: 0.82,
					})}
				/>
			)}
		</div>
	);
}
