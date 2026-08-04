import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingStorage } from "../storage";
import { resolveTopic } from "../core";
import { getProviderApiKey } from "../../lib/provider-models";
import { proxiedProviderRequestUrl } from "../../lib/provider-proxy";
import { DEFAULT_IMAGE_GENERATOR_ID, getImageGenerator, localImageEndpoint } from "../../lib/image-generators";
import { loadKeatingUiSettings } from "../ui-settings";
import type { StoryboardScene } from "../storyboard";
import {
	createImageRequestId,
	emitImageProgress,
	isEventStream,
	pngDataUrl,
	readImageStream,
} from "../image-stream";
import { createTool } from "./shared";

type ResolvedTopic = ReturnType<typeof resolveTopic>;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Extract agent-authored scenes from a storyboard markdown document. */
export function parseStoryboardScenes(markdown: string): StoryboardScene[] {
	const lines = markdown.split(/\r?\n/);
	const scenes: StoryboardScene[] = [];
	let current: Partial<StoryboardScene> = {};
	for (const line of lines) {
		const titleMatch = line.match(/^#\s+Animation Storyboard:\s*(.+)$/);
		if (titleMatch) continue;
		const sceneMatch = line.match(/^##\s+Scene\s+(\d+):\s*(.+?)\s*\((\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?s)\)\s*$/);
		if (sceneMatch) {
			if (current.title) scenes.push(current as StoryboardScene);
			current = {
				number: Number(sceneMatch[1]),
				title: sceneMatch[2].trim(),
				duration: sceneMatch[3].trim(),
			};
			continue;
		}
		const visualMatch = line.match(/^-\s*\*\*Visual\*\*:\s*(.+)$/);
		if (visualMatch) current.visual = visualMatch[1].trim();
		const audioMatch = line.match(/^-\s*\*\*(?:Audio|Narration)\*\*:\s*(.+)$/);
		if (audioMatch) current.audio = audioMatch[1].trim();
		const transMatch = line.match(/^-\s*\*\*Transition\*\*:\s*(.+)$/);
		if (transMatch) current.transition = transMatch[1].trim();
		const durMatch = line.match(/^-\s*\*\*Duration\*\*:\s*(\d+)s\s*$/);
		if (durMatch) current.duration = `${durMatch[1]}s`;
		const highlightMatch = line.match(/^-\s*\*\*(?:Highlight|Overlay|Step-through)\*\*:\s*(.+)$/);
		if (highlightMatch) current.highlight = highlightMatch[1].trim();
	}
	if (current.title) scenes.push(current as StoryboardScene);
	return scenes;
}

function parseStoryboardDurationSeconds(label: string): number {
	const cleaned = label.trim().replace(/s$/i, "");
	const range = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
	if (range) return Math.max(0.5, Number(range[2]) - Number(range[1]));
	const value = Number(cleaned);
	return Number.isFinite(value) ? Math.max(0.5, value) : 4;
}

function storyboardTitle(markdown: string): string {
	const match = markdown.match(/^#\s+Animation Storyboard:\s*(.+)$/m);
	return match ? match[1].trim() : "";
}

function buildAuthoredAnimationStoryboard(resolved: ResolvedTopic, summary: string): string {
	const premise = summary || resolved.summary;
	return [
		`# Animation Storyboard: ${resolved.title}`,
		"",
		"## Scene 1: Establish the question (0-3s)",
		`- **Visual**: Open with the core structure of ${resolved.title} and make the learner's starting question visible.`,
		`- **Narration**: ${premise}`,
		"- **Highlight**: Name the thing that will change on screen.",
		"",
		"## Scene 2: Show the motion (3-8s)",
		"- **Visual**: Use the authored Hyperframes scene to animate the central relationship, not just a static title card.",
		"- **Narration**: Point to the moving parts and connect them to the learner's intuition.",
		"- **Highlight**: The animation source is stored in the scene field.",
		"",
		"## Scene 3: Lock the takeaway (8-12s)",
		"- **Visual**: End on the key contrast, equation, or diagram state that should remain in memory.",
		"- **Narration**: State the transfer rule the learner can reuse.",
		"- **Transition**: Fade out after the final state is legible.",
		"",
	].join("\n");
}

function buildHyperframesComposition(resolved: ResolvedTopic, storyboard: string): string {
	// Use the agent-authored storyboard so every visible label, body line, and
	// duration reflects actual teaching content — not a generic template.
	const title = storyboardTitle(storyboard) || resolved.title;
	const scenes = parseStoryboardScenes(storyboard);
	const compositionId = `${resolved.slug}-lesson`;

	const clips =
		scenes.length > 0
			? scenes.map((scene, index) => {
				const start = scenes.slice(0, index).reduce((sum, prev) => sum + parseStoryboardDurationSeconds(prev.duration), 0);
				const duration = parseStoryboardDurationSeconds(scene.duration);
				return {
					start,
					duration,
					label: `Scene ${scene.number}`,
					title: scene.title,
					body: scene.visual || scene.highlight || scene.audio || scene.transition || "",
				};
			})
			: [{ start: 0, duration: 6, label: "Lesson", title: resolved.title, body: resolved.summary }];

	const encodedClips = JSON.stringify(clips.map((clip) => ({ selector: `#clip-${clip.start}`, start: clip.start })));

	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #0a0a0a; color: #f4f1e8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: linear-gradient(135deg, #0b0b0b 0%, #161616 55%, #211706 100%); }
    .clip { position: absolute; inset: 96px; display: grid; align-content: center; gap: 28px; opacity: 0; }
    .label { color: #f59e0b; font-size: 34px; letter-spacing: .16em; text-transform: uppercase; }
    h1, h2 { margin: 0; max-width: 1380px; font-size: 112px; line-height: 1; letter-spacing: 0; }
    p { margin: 0; max-width: 1220px; color: #d6d3ca; font-size: 48px; line-height: 1.24; }
    .rule { width: 420px; height: 8px; background: #f59e0b; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${escapeHtml(compositionId)}" data-start="0" data-width="1920" data-height="1080">
${clips.map((clip, index) => `    <section id="clip-${clip.start}" class="clip" data-start="${clip.start}" data-duration="${clip.duration}" data-track-index="${index}">
      <div class="label">${escapeHtml(clip.label)}</div>
      <${index === 0 ? "h1" : "h2"}>${escapeHtml(clip.title)}</${index === 0 ? "h1" : "h2"}>
      <div class="rule"></div>
      <p>${escapeHtml(clip.body)}</p>
    </section>`).join("\n")}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    const clips = ${encodedClips};
    for (const clip of clips) {
      tl.to(clip.selector, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, clip.start);
      tl.to(clip.selector, { opacity: 0, y: -28, duration: 0.35, ease: "power2.in" }, clip.start + 1.65);
    }
    window.__timelines = window.__timelines || {};
    window.__timelines[${JSON.stringify(compositionId)}] = tl;
    tl.play(0);
  </script>
</body>
</html>`;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
	if (!Array.isArray(value)) return fallback;
	return value
		.map((entry) => String(entry ?? "").trim())
		.filter(Boolean)
		.slice(0, 6);
}

/** How many progressive renders to ask for. 2 is enough to feel live. */
const PARTIAL_IMAGE_COUNT = 2;

async function generateImageViaEndpoint(params: {
	endpoint: string;
	apiKey?: string;
	prompt: string;
	model: string;
	size: string;
	quality: string;
	onPartial?: (dataUrl: string, index: number) => void;
}): Promise<{ dataUrl: string; mimeType: string }> {
	const proxied = proxiedProviderRequestUrl(params.endpoint);
	const headers: Record<string, string> = {
		// Accept both so a server that ignores `stream` can still answer JSON.
		accept: "text/event-stream, application/json",
		"content-type": "application/json",
		"x-target-url": proxied.targetBaseUrl,
	};
	if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

	const response = await fetch(proxied.url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: params.model,
			prompt: params.prompt,
			size: params.size,
			quality: params.quality,
			n: 1,
			stream: true,
			partial_images: PARTIAL_IMAGE_COUNT,
		}),
	});

	if (!response.ok) {
		const payload = await response.json().catch(async () => ({
			error: { message: await response.text().catch(() => response.statusText) },
		}));
		const message = payload?.error?.message ?? response.statusText;
		throw new Error(`Image generation failed (${response.status}): ${String(message).slice(0, 500)}`);
	}

	// Streaming path: progressive renders arrive as SSE and are forwarded to the
	// UI as they land.
	if (response.body && isEventStream(response.headers.get("content-type"))) {
		const { b64 } = await readImageStream(response.body, params.onPartial);
		return { dataUrl: pngDataUrl(b64), mimeType: "image/png" };
	}

	// Non-streaming fallback for servers that ignore `stream` (many local ones).
	const payload = await response.json().catch(async () => ({
		error: { message: await response.text().catch(() => response.statusText) },
	}));
	const b64 = payload?.data?.[0]?.b64_json;
	if (!b64 || typeof b64 !== "string") {
		throw new Error("Image generation returned no base64 image data.");
	}

	return { dataUrl: pngDataUrl(b64), mimeType: "image/png" };
}

export function createMediaTools(storage: KeatingStorage): AgentTool[] {
	return [
		createTool(
			"animate",
			"You write the animation itself. The tool renders whatever Hyperframes HTML document you author in a sandboxed iframe inline in the chat. Pass authored `body` as a full HTML document with GSAP timelines. The tool does not synthesize a template. Calling without authored `body` is rejected with the exact shape required.",
			{
				topic: { type: "string", description: "The topic this animation explains" },
				kind: { type: "string", enum: ["hyperframes"], description: "Renderer. Only hyperframes is supported." },
				summary: { type: "string", description: "One-line summary shown above the animation. Recommended." },
				body: { type: "string", description: "REQUIRED. The full Hyperframes HTML document you author — must explain THIS topic with real content, not a placeholder." },
				storyboard: { type: "string", description: "Optional markdown storyboard with `# Animation Storyboard:` and `## Scene N: Title (start-ends)` sections. If omitted, Keating saves a concise generated storyboard around the authored scene." },
			},
			async (params) => {
				const topic = (params.topic as string) || "";

				const kindRaw = typeof params.kind === "string" ? params.kind : "";
				if (kindRaw && kindRaw !== "hyperframes") {
					return [
						"Pick a valid `kind`: hyperframes.",
						"Write a full HTML document with GSAP timelines.",
						"You MUST pass `body` with real content for THIS topic. No template fallback exists.",
					].join("\n");
				}

				const kind = "hyperframes";
				const body = typeof params.body === "string" ? params.body : "";
				const summary = typeof params.summary === "string" ? params.summary.trim() : "";

				if (body.trim().length < 50) {
					const hyperframesExample =
						"<!doctype html><html><body style=\"background:#0a0a0a;color:#f4f1e8;font-family:ui-monospace,monospace;margin:0;\">\n" +
						"  <section id=\"clip-0\" data-start=\"0\" data-duration=\"3\" style=\"opacity:0;\"><h2>Browser cache</h2><p>The OS asks the resolver</p></section>\n" +
						"  <section id=\"clip-3\" data-start=\"3\" data-duration=\"4\" style=\"opacity:0;\"><h2>Recursive resolver</h2><p>The heavy lifting happens here</p></section>\n" +
						"  <script src=\"https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js\"></script>\n" +
						"  <script>\n" +
						"    const tl = gsap.timeline({paused:true});\n" +
						"    tl.to('#clip-0', {opacity:1, duration:0.4}, 0);\n" +
						"    tl.to('#clip-0', {opacity:0, duration:0.3}, 3);\n" +
						"    tl.to('#clip-3', {opacity:1, duration:0.4}, 3);\n" +
						"    tl.play(0);\n" +
						"  </script>\n</body></html>";
					return [
						"Author the Hyperframes animation yourself. Pass `body` as real, non-placeholder HTML for THIS topic (>=50 chars).",
						"",
						"Example body shape:",
						"",
						hyperframesExample,
					].join("\n");
				}

				const resolved = resolveTopic(topic);

				const storyboard =
					typeof params.storyboard === "string" && params.storyboard.trim()
						? params.storyboard.trim()
						: buildAuthoredAnimationStoryboard(resolved, summary);
				const scene = body;
				const renderer = "hyperframes";
				const animationPayload: Record<string, unknown> = {
					topic: resolved.title,
					kind,
					summary: summary || undefined,
					body,
				};

				const manifest = JSON.stringify(
					{
						topic: resolved.title,
						slug: resolved.slug,
						domain: resolved.domain,
						renderer,
						kind,
						sourceBytes: body.length,
						generatedAt: new Date().toISOString(),
					},
					null,
					2,
				);
				const saved = await storage.saveAnimation(topic, storyboard, scene, manifest, renderer);

				return [
					`[artifact://animation/${saved.id}]`,
					"",
					`<keating-animation json=${JSON.stringify(JSON.stringify(animationPayload))} />`,
				].join("\n");
			},
			["topic", "body"],
		),

		createTool(
			"generate_image",
			"Generate a real raster learning image with the image generator the learner has configured in Settings → Image generation (OpenAI, or a local OpenAI-compatible server). You MUST author the content yourself by passing `title`, `subtitle`, and at least 3 `points` describing what the visual should communicate — generic titles like 'Learning visual' or empty point lists are rejected. Use `kind` to shape the prompt: 'anatomy' for labeled structures, 'comparison' for size/category bars, 'process' for ordered step-by-step flows, 'cards' for grouped concepts. If no image generator is configured/available, the tool returns a short message instead of an image — there is no template fallback.",
			{
				title: { type: "string", description: "REQUIRED. Short, specific title for the visual that reflects THIS topic (e.g. 'DNS resolution steps' or 'IgG antibody anatomy'), not 'Learning visual'." },
				subtitle: { type: "string", description: "REQUIRED. One-sentence framing caption that names the specific idea being illustrated." },
				prompt: { type: "string", description: "Optional explicit image-model prompt. If omitted, one is composed from title/subtitle/points/labels/kind/style." },
				kind: { type: "string", description: "cards, anatomy, comparison, or process. Shapes the composed prompt. Use 'process' for ordered step-by-step flows; 'anatomy' for labeled structures; 'comparison' for size/category bars; 'cards' for grouped concepts." },
				imageModel: { type: "string", description: "Optional override for the image model. Defaults to the model selected in Settings → Image generation, then the generator's default." },
				size: { type: "string", description: "Optional size override (e.g. 1024x1024, 1536x1024, 1024x1536). Defaults to the configured size." },
				quality: { type: "string", description: "Optional quality override: low, medium, or high. Defaults to the configured quality." },
				points: {
					type: "array",
					description: "REQUIRED (>=3). Concrete teaching points to visualize. For 'process' these become the steps; for 'anatomy' the label callouts; for 'comparison' the bar values; for 'cards' the card body text. Generic points like 'Core idea' are rejected.",
					items: { type: "string" },
				},
				labels: {
					type: "array",
					description: "Optional labels for the visual blocks (step titles, structure names, etc.).",
					items: { type: "string" },
				},
				style: {
					type: "string",
					description: "Visual style hint added to the prompt: light or dark",
				},
			},
			async (params) => {
				const title = String(params.title ?? "").trim();
				const subtitle = String(params.subtitle ?? "").trim();
				const points = asStringArray(params.points, []);
				const labels = asStringArray(params.labels, []);
				const style = String(params.style ?? "light").toLowerCase() === "dark" ? "dark" : "light";
				const kindRaw = String(params.kind ?? "cards").toLowerCase();
				const kind = ["anatomy", "comparison", "process", "cards"].includes(kindRaw) ? kindRaw : "cards";

				// Reject generic/templated content the same way plan/map/verify/quiz
				// do — the visual must be grounded in real material.
				const genericTitle = !title || title.toLowerCase() === "learning visual";
				const genericSubtitle = !subtitle || subtitle.toLowerCase() === "a compact visual summary for this concept.";
				const genericPoints = points.length < 3 || points.every((p) => /^(core idea|key relationship|learner takeaway)$/i.test(p.trim()));
				if (genericTitle || genericSubtitle || genericPoints) {
					return [
						"Author the image content yourself. The tool will not synthesize a generic visual. Pass:",
						"- `title`: a topic-specific title (e.g. 'How DNS resolves a name', 'IgG Y-shape anatomy') — not 'Learning visual'.",
						"- `subtitle`: a one-sentence framing that names the actual idea.",
						`- \`points\`: >=3 concrete points that will become the visual's content${
							kind === "process"
								? " (for process kind, these are the numbered steps in order)"
								: kind === "anatomy"
									? " (for anatomy kind, these are the labeled-structure callouts)"
									: kind === "comparison"
										? " (for comparison kind, include the value/size in each point, e.g. '150 kDa full Y')"
										: " (real concepts grounded in the material)"
						}.`,
						"- `labels` (optional): per-block labels for the visual.",
						"No template fallback exists.",
					].join("\n");
				}

				const finalTitle = title;
				const finalSubtitle = subtitle;

				// Resolve the configured image generator from the central config +
				// the learner's settings. No template/SVG fallback exists.
				const settings = loadKeatingUiSettings();
				const generator = getImageGenerator(settings.imageGenerator) ?? getImageGenerator(DEFAULT_IMAGE_GENERATOR_ID)!;

				const endpoint = generator.needsBaseUrl
					? localImageEndpoint(settings.localImageBaseUrl)
					: generator.fixedEndpoint ?? "";
				const apiKey = await getProviderApiKey(generator.providerKey);

				// No image generator available → return a plain message, never an image.
				if (generator.needsBaseUrl && !endpoint) {
					return `No image generation model is available. Set a base URL for the local image server in Settings → Image generation (selected generator: ${generator.label}).`;
				}
				if (!generator.needsBaseUrl && !apiKey) {
					return `No image generation model is available. Add an API key for ${generator.label} in Settings → Providers & Models, or pick a different generator in Settings → Image generation.`;
				}

				const imageModel = (settings.imageModel || String(params.imageModel ?? "")).trim() || generator.models[0] || "";
				if (!imageModel) {
					return `No image model is configured for ${generator.label}. Set one in Settings → Image generation.`;
				}

				const sizeCandidate = (String(params.size ?? "") || settings.imageSize).trim();
				const size = generator.sizes.includes(sizeCandidate) ? sizeCandidate : generator.sizes[0];
				const qualityCandidate = (String(params.quality ?? "") || settings.imageQuality).trim().toLowerCase();
				const quality = generator.qualities.includes(qualityCandidate) ? qualityCandidate : generator.qualities[0];

				const prompt = String(params.prompt ?? "").trim() || [
					`Create a clear educational ${kind === "cards" ? "infographic" : `${kind} diagram`} titled "${finalTitle}".`,
					finalSubtitle,
					points.length > 0 ? `Include these ideas: ${points.join("; ")}.` : "",
					labels.length > 0 ? `Use labels: ${labels.join(", ")}.` : "",
					`Use a ${style} visual style.`,
					"Make it legible, accurate, and suitable for a learner studying from the image.",
				].filter(Boolean).join(" ");

				// A genuine request failure (HTTP error, billing/quota, network)
				// propagates so it surfaces through the standard classified-error
				// UI like every other API error. The plain-message returns above
				// are reserved for the "no generator configured" case.
				const requestId = createImageRequestId();
				emitImageProgress({ requestId, title: finalTitle, status: "started" });
				let generated: { dataUrl: string; mimeType: string };
				try {
					generated = await generateImageViaEndpoint({
						endpoint,
						apiKey,
						prompt,
						model: imageModel,
						size,
						quality,
						onPartial: (dataUrl, index) =>
							emitImageProgress({ requestId, title: finalTitle, dataUrl, index, status: "partial" }),
					});
				} catch (error) {
					emitImageProgress({ requestId, title: finalTitle, status: "error" });
					throw error;
				}
				emitImageProgress({ requestId, title: finalTitle, status: "done" });

				const payload = {
					title: finalTitle,
					alt: finalSubtitle,
					dataUrl: generated.dataUrl,
					mimeType: generated.mimeType,
					model: imageModel,
					prompt,
				};

				return [
					`# Generated Image: ${finalTitle}`,
					"",
					finalSubtitle,
					"",
					`<keating-image json=${JSON.stringify(JSON.stringify(payload))} />`,
				].join("\n");
			},
			["title", "subtitle", "points"],
		),

		// verify - Self-check knowledge before teaching
	];
}

export {
	buildHyperframesComposition as __test_buildHyperframesComposition,
	parseStoryboardDurationSeconds as __test_parseStoryboardDurationSeconds,
	storyboardTitle as __test_storyboardTitle,
};
