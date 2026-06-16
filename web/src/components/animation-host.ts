/**
 * Build the HTML page that runs a model-authored manim-web scene inside an
 * iframe. The scene is provided as an `async function construct(scene, M)`
 * body where `M` is the full manim-web namespace (so the model never has to
 * know which path the library is served from). The host page loads manim-web
 * from `/manim-web/index.js` (copied there by the Vite plugin in
 * vite.config.ts) and calls `construct` with a fresh `Scene` and the
 * manim-web module.
 */
export function buildManimSceneHtml(source: string, topic: string): string {
	// The model writes ES module code that defines `construct`. We inject it
	// as the body of a module script, with `M` (manim-web) imported at the
	// top. The `construct` function gets called with (scene, M) so the model
	// can use any manim-web primitive without re-importing.
	const safeTopic = escapeHtml(topic);
	const escapedSource = source;
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Keating Animation: ${safeTopic}</title>
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; width: 100%; height: 100%; background: #08111f; color: #f4f1e8;
      font-family: "Iowan Old Style", Georgia, serif; overflow: hidden; }
    #keating-scene { position: absolute; inset: 0; width: 100%; height: 100%; }
    .keating-error {
      position: absolute; inset: 0; display: grid; place-items: center;
      padding: 2rem; box-sizing: border-box; color: #ffb4a2;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem;
      white-space: pre-wrap; overflow: auto;
    }
  </style>
</head>
<body>
  <div id="keating-scene"></div>
  <script type="module">
    import * as M from "/manim-web/index.js";

    const source = ${JSON.stringify(escapedSource)};

    // The model writes an async function construct(scene, M) { ... }.
    // We support either: (a) a top-level construct declaration, or
    // (b) the whole body is a sequence of statements ending in construct(...).
    let construct;
    try {
      const wrapped = \`return (async () => { \${source} \n; if (typeof construct === "function") return construct; throw new Error("No construct() function was defined."); })()\`;
      // eslint-disable-next-line no-new-func
      construct = new Function("M", \`return (async () => { \${source} \n; if (typeof construct === "function") return construct; throw new Error("No construct() function was defined."); })()\`)(M);
    } catch (e) {
      renderError(String(e?.stack ?? e));
      throw e;
    }

    function renderError(message) {
      const el = document.createElement("div");
      el.className = "keating-error";
      el.textContent = message;
      document.body.appendChild(el);
    }

    const container = document.getElementById("keating-scene");
    const scene = new M.Scene(container, {
      width: 1280,
      height: 720,
      backgroundColor: "#08111f",
    });

    try {
      await construct(scene, M);
    } catch (e) {
      renderError("Animation error:\\n\\n" + (e?.stack ?? String(e)));
    }
  </script>
</body>
</html>`;
}

/**
 * Build the HTML page for a hyperframes composition. The model writes a
 * complete HTML document with GSAP timelines — we just wrap it in our
 * chrome (title, error overlay) and serve it via iframe srcDoc.
 */
export function buildHyperframesHtml(source: string, topic: string): string {
	const safeTopic = escapeHtml(topic);
	// If the model wrote a full <!doctype html> document, pass it through.
	// Otherwise wrap the body in a minimal document shell.
	const trimmed = source.trim();
	if (trimmed.toLowerCase().startsWith("<!doctype") || trimmed.toLowerCase().startsWith("<html")) {
		return source;
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
