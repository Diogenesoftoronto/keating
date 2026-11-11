/**
 * Print a self-contained HTML document from a hidden same-origin iframe, so
 * neither the app's global print CSS nor the chat chrome is involved. The
 * frame is sandboxed without `allow-scripts`, so nothing in the document can
 * run; `allow-modals` is what lets the parent open its print dialog.
 */
export function printHtmlDocument(html: string, host: Document = document): Promise<void> {
	return new Promise((resolve, reject) => {
		const frame = host.createElement("iframe");
		frame.setAttribute("sandbox", "allow-same-origin allow-modals");
		frame.setAttribute("aria-hidden", "true");
		frame.setAttribute("tabindex", "-1");
		frame.title = "Print preview";
		Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
		let finished = false;
		const cleanup = () => {
			if (finished) return;
			finished = true;
			// Some browsers return from print() before the dialog closes; keep the frame until then.
			setTimeout(() => frame.remove(), 1_000);
		};
		frame.addEventListener("load", () => {
			const view = frame.contentWindow;
			if (!view) { cleanup(); reject(new Error("Printing is not available in this browser.")); return; }
			view.addEventListener("afterprint", cleanup, { once: true });
			try {
				view.focus();
				view.print();
				resolve();
			} catch (cause) {
				reject(cause instanceof Error ? cause : new Error("Printing is not available in this browser."));
			} finally {
				setTimeout(cleanup, 60_000);
			}
		}, { once: true });
		frame.srcdoc = html;
		host.body.appendChild(frame);
	});
}
