export function withHyperframesBridge(html: string, bridgeScriptUrl: string): string {
	const bridge = `<script src=${JSON.stringify(bridgeScriptUrl)}></script>`;
	if (/<\/body\s*>/i.test(html)) {
		return html.replace(/<\/body\s*>/i, `${bridge}</body>`);
	}
	return `${html}${bridge}`;
}
