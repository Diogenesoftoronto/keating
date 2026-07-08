/**
 * Build the HTML page for a hyperframes composition. The model writes a
 * complete HTML document with GSAP timelines — we just wrap it in our
 * chrome (title, error overlay) and serve it via iframe srcDoc.
 */
export function buildHyperframesHtml(source: string, topic: string): string {
	const safeTopic = escapeHtml(topic);
	const trimmed = source.trim();
	if (trimmed.toLowerCase().startsWith("<!doctype") || trimmed.toLowerCase().startsWith("<html")) {
		return trimmed;
	}
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Keating Animation: ${safeTopic}</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #0a0a0a; color: #f4f1e8;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; }
    .keating-error { position: absolute; inset: 0; display: grid; place-items: center;
      padding: 2rem; box-sizing: border-box; color: #ffb4a2; font-size: 0.85rem;
      white-space: pre-wrap; overflow: auto; }
  </style>
</head>
<body>
${source}
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
