import { HYPERFRAMES_BRIDGE_SCRIPT } from "./hyperframes-frame-bridge";

// Guard against the closing-tag sequence appearing literally inside the script
// text, which would otherwise terminate the injected inline <script> early.
function escapeForInlineScript(source: string): string {
	return source.replace(/<\/script/gi, "<\\/script");
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
	if (/<\/body\s*>/i.test(html)) {
		return html.replace(/<\/body\s*>/i, `${bridge}</body>`);
	}
	if (/<\/html\s*>/i.test(html)) {
		return html.replace(/<\/html\s*>/i, `${bridge}</html>`);
	}
	return `${html}${bridge}`;
}
