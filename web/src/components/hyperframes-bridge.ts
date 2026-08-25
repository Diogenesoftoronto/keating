import { HYPERFRAMES_BRIDGE_SCRIPT } from "./hyperframes-frame-bridge";

const GSAP_SRC = "https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js";
const GSAP_SCRIPT_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*gsap[^"']*["'][^>]*>\s*<\/script>/gi;

// Guard against the closing-tag sequence appearing literally inside the script
// text, which would otherwise terminate the injected inline <script> early.
function escapeForInlineScript(source: string): string {
	return source.replace(/<\/script/gi, "<\\/script");
}

/**
 * Generated scenes are allowed to be complete HTML documents, but the model
 * occasionally omits the GSAP dependency or places it after an inline script.
 * Normalize that dependency before any scene script can execute. Removing
 * authored GSAP tags first also prevents duplicate library instances.
 */
function ensureGsapScript(html: string): string {
	const withoutGsapScripts = html.replace(GSAP_SCRIPT_PATTERN, "");
	const script = `<script src="${GSAP_SRC}"></script>`;
	const head = withoutGsapScripts.match(/<head\b[^>]*>/i);
	if (head?.index !== undefined) {
		const insertAt = head.index + head[0].length;
		return `${withoutGsapScripts.slice(0, insertAt)}\n  ${script}${withoutGsapScripts.slice(insertAt)}`;
	}
	const body = withoutGsapScripts.match(/<body\b[^>]*>/i);
	if (body?.index !== undefined) {
		const insertAt = body.index + body[0].length;
		return `${withoutGsapScripts.slice(0, insertAt)}\n  ${script}${withoutGsapScripts.slice(insertAt)}`;
	}
	return `${script}\n${withoutGsapScripts}`;
}

/**
 * Inject the Hyperframes control bridge into a generated animation document.
 *
 * The bridge is inlined as an inline <script> (rather than referenced as an
 * external asset) so it runs reliably under `sandbox="allow-scripts"` in both
 * dev and production builds — see hyperframes-frame-bridge.ts for why.
 */
export function withHyperframesBridge(html: string): string {
	const bridge = `<script>${escapeForInlineScript(HYPERFRAMES_BRIDGE_SCRIPT)}</script>`;
	const withGsap = ensureGsapScript(html);
	if (/<\/body\s*>/i.test(withGsap)) {
		return withGsap.replace(/<\/body\s*>/i, `${bridge}</body>`);
	}
	if (/<\/html\s*>/i.test(withGsap)) {
		return withGsap.replace(/<\/html\s*>/i, `${bridge}</html>`);
	}
	return `${withGsap}${bridge}`;
}
